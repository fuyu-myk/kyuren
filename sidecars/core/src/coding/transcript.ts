import { type FileHandle, open, readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fields, record, text } from "#coding/said.ts";
import { type StepDetail, stepDetail } from "#coding/step.ts";
import { type Detail, type Span, Timeline } from "#coding/timeline.ts";
import { folderOf } from "#coding/where.ts";

const SESSION = /^[A-Za-z0-9-]{1,100}$/;
const STEP = /^[A-Za-z0-9_-]{1,100}$/;
const AGENT = /^[A-Za-z0-9]{1,64}$/;
/// Read a megabyte at a time, so a long session's transcript is never held whole.
const CHUNK = 1 << 20;
const NEWLINE = 0x0a;
/// The only lines a timeline takes anything from: a step, its outcome, the task, and the word
/// that work left in the background has ended.
const WANTED = [Buffer.from('"tool_'), Buffer.from('"last-prompt"'), Buffer.from("<task-notification>"), Buffer.from("<agent-message")];
/// What marks a line as something the agent itself said, rather than a subagent aside.
const SPOKE = [Buffer.from('"type":"assistant"'), Buffer.from('"type":"text"')];
const ASIDE = Buffer.from('"isSidechain":true');
/// The most of what the agent said last that is shown.
const SAID = 4000;

/// Where Claude Code keeps a session's transcript: in its project's folder, named for the session.
/// A project renamed leaves the session's earlier transcript in the old folder, so the one written
/// last is taken.
export async function transcriptOf(projects: string, session: string): Promise<string | undefined> {
  if (!SESSION.test(session)) return undefined;
  const folders = await readdir(projects, { withFileTypes: true }).catch(() => []);
  let newest: { path: string; written: number } | undefined;
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const path = join(projects, folder.name, `${session}.jsonl`);
    const written = await stat(path).then(
      (info) => info.mtimeMs,
      () => undefined,
    );
    if (written !== undefined && (newest === undefined || written > newest.written)) newest = { path, written };
  }
  return newest?.path;
}

/// A transcript followed as it grows: read once, then only for what was added since. A file cut
/// short or put in its place is read afresh.
class Followed {
  readonly path: string;
  readonly #fresh: () => Timeline;
  timeline: Timeline;
  /// Where the line holding what the agent said last lies, found as the file is read.
  said: Span | null = null;
  #offset = 0;
  #file: number | null = null;
  #turn: Promise<boolean> = Promise.resolve(true);

  constructor(path: string, fresh: () => Timeline) {
    this.path = path;
    this.#fresh = fresh;
    this.timeline = fresh();
  }

  /// One reading at a time, since each goes on from where the last left off.
  catchUp(): Promise<boolean> {
    this.#turn = this.#turn.then(
      () => this.#read(),
      () => this.#read(),
    );
    return this.#turn;
  }

  async #read(): Promise<boolean> {
    const handle = await open(this.path, "r").catch(() => undefined);
    if (!handle) return false;
    try {
      const { size, ino } = await handle.stat();
      if (size < this.#offset || (this.#file !== null && ino !== this.#file)) {
        this.#offset = 0;
        this.timeline = this.#fresh();
        this.said = null;
      }
      this.#file = ino;
      await this.#readTo(handle, size);
      return true;
    } finally {
      await handle.close();
    }
  }

  async #readTo(handle: FileHandle, size: number): Promise<void> {
    let want = CHUNK;
    while (this.#offset < size) {
      const length = Math.min(want, size - this.#offset);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, this.#offset);
      const end = bytesRead > 0 ? buffer.lastIndexOf(NEWLINE, bytesRead - 1) : -1;
      if (end < 0) {
        // The last line is still being written, or is longer than what was read for it.
        if (this.#offset + length >= size) return;
        want *= 2;
        continue;
      }
      this.#feed(buffer, end);
      this.#offset += end + 1;
      want = CHUNK;
    }
  }

  #feed(buffer: Buffer, end: number): void {
    let start = 0;
    while (start <= end) {
      const next = buffer.indexOf(NEWLINE, start);
      const line = buffer.subarray(start, next);
      const span = { at: this.#offset + start, length: next - start };
      if (WANTED.some((mark) => line.includes(mark))) this.timeline.feed(line.toString("utf8"), span);
      if (SPOKE.every((mark) => line.includes(mark)) && !line.includes(ASIDE)) this.said = span;
      start = next + 1;
    }
  }
}

async function lineAt(path: string, span: Span): Promise<string | undefined> {
  const handle = await open(path, "r").catch(() => undefined);
  if (!handle) return undefined;
  try {
    const buffer = Buffer.alloc(span.length);
    const { bytesRead } = await handle.read(buffer, 0, span.length, span.at);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}

type Opened = { session: string; root: string | null; followed: Followed; agents: Map<string, string>; said?: { at: number; text: string | null } };

/// What a line the agent wrote said in words, its text blocks together, cut between characters.
function wordsOf(line: string | undefined): string | null {
  const content = fields(record(line ?? "")?.message).content;
  if (!Array.isArray(content)) return null;
  const words = content
    .map(fields)
    .filter((block) => block.type === "text")
    .map((block) => text(block, "text"))
    .join("\n\n")
    .trim();
  if (!words) return null;
  const characters = Array.from(words);
  return characters.length > SAID ? `${characters.slice(0, SAID - 1).join("")}…` : words;
}

/// Sessions' details as the island asks for them, every few seconds while one is open. Only the
/// open session is followed, and the subagent last looked into, since the island asks for no other,
/// and what is held of the user's work goes as soon as another is opened.
export class SessionDetails {
  readonly #projects: string;
  #open: Opened | undefined;
  #agent: Followed | undefined;

  constructor(projects: string) {
    this.#projects = projects;
  }

  async of(session: string, since = 0, epoch?: string): Promise<(Detail & { said: string | null }) | null> {
    const opened = await this.#opened(session);
    if (!opened) return null;
    const timeline = opened.followed.timeline;
    return { ...timeline.detail(epoch === timeline.epoch ? since : 0), said: await this.#said(opened) };
  }

  /// What the agent said last, read again only once it has said something newer.
  async #said(opened: Opened): Promise<string | null> {
    const span = opened.followed.said;
    if (!span) return null;
    if (opened.said?.at === span.at) return opened.said.text;
    const said = wordsOf(await lineAt(opened.followed.path, span));
    opened.said = { at: span.at, text: said };
    return said;
  }

  async step(session: string, id: string, agent?: string, whole = false): Promise<StepDetail | null> {
    if (!STEP.test(id) || (agent !== undefined && !AGENT.test(agent))) return null;
    const opened = await this.#opened(session);
    if (!opened) return null;
    const followed = agent === undefined ? opened.followed : await this.#subagent(opened, agent);
    const spans = followed?.timeline.spans(id);
    if (!followed || !spans) return null;
    const use = await lineAt(followed.path, spans.use);
    const result = spans.result ? await lineAt(followed.path, spans.result) : undefined;
    const found = use === undefined ? null : stepDetail(id, use, result, followed.timeline.base(), whole);
    const settled = followed.timeline.okOf(id);
    const detail = found && settled !== undefined ? { ...found, ok: settled } : found;
    if (detail?.kind !== "agent") return detail;
    const taker = detail.agent ?? (await this.#agentFor(opened, id));
    const inner = taker && AGENT.test(taker) ? await this.#subagent(opened, taker) : undefined;
    return { ...detail, agent: inner && taker ? taker : null, steps: inner ? inner.timeline.detail(0).steps : [] };
  }

  async #opened(session: string): Promise<Opened | undefined> {
    if (!SESSION.test(session)) return undefined;
    const held = this.#open?.session === session ? this.#open : undefined;
    const opened = held ?? (await this.#find(session));
    if (!opened) return undefined;
    if (await opened.followed.catchUp()) return opened;
    this.#open = undefined;
    return held ? this.#opened(session) : undefined;
  }

  async #find(session: string): Promise<Opened | undefined> {
    const path = await transcriptOf(this.#projects, session);
    if (!path) return undefined;
    const root = (await folderOf(basename(dirname(path))).catch(() => undefined)) ?? null;
    const opened = { session, root, followed: new Followed(path, () => new Timeline(root)), agents: new Map<string, string>() };
    this.#open = opened;
    this.#agent = undefined;
    return opened;
  }

  /// A subagent's transcript, beside its parent's in a folder of its own.
  async #subagent(opened: Opened, agent: string): Promise<Followed | undefined> {
    const path = join(dirname(opened.followed.path), opened.session, "subagents", `agent-${agent}.jsonl`);
    if (this.#agent?.path !== path) this.#agent = new Followed(path, () => new Timeline(opened.root, true));
    const followed = this.#agent;
    return (await followed.catchUp()) ? followed : undefined;
  }

  /// Which agent took a step, from what each agent keeps of the step that started it: known before
  /// the step itself has an outcome naming it.
  async #agentFor(opened: Opened, step: string): Promise<string | undefined> {
    const known = opened.agents.get(step);
    if (known) return known;
    const folder = join(dirname(opened.followed.path), opened.session, "subagents");
    const seen = new Set(opened.agents.values());
    for (const name of await readdir(folder).catch(() => [] as string[])) {
      const agent = /^agent-([A-Za-z0-9]{1,64})\.meta\.json$/.exec(name)?.[1];
      if (!agent || seen.has(agent)) continue;
      const meta = record(await readFile(join(folder, name), "utf8").catch(() => ""));
      const started = typeof meta?.toolUseId === "string" ? meta.toolUseId : undefined;
      if (started) opened.agents.set(started, agent);
      if (started === step) return agent;
    }
    return undefined;
  }
}
