import { open, stat } from "node:fs/promises";
import type { Coding, State } from "#coding/session.ts";
import { timelineOf } from "#coding/timeline.ts";
import { transcriptOf } from "#coding/transcript.ts";

/// A turn shorter than this was likely watched as it came, so its end is not worth a glance.
export const MIN_TURN = 30_000;
/// The most of a turn read for how it went: the end of a longer one, where its tests last ran.
const MOST = 16 << 20;

/// How a turn went, in counts alone, since only they are told of it.
export type Outcome = { tests: { passed: number | null; failed: number | null; ok: boolean } | null; files: number };
export type Finished = { session: string; project: string; title?: string; worked: number; outcome: Outcome | null };

type Began = { at: number; offset: number | undefined };

async function outcomeOf(path: string, offset: number): Promise<Outcome | null> {
  const handle = await open(path, "r").catch(() => undefined);
  if (!handle) return null;
  try {
    const { size } = await handle.stat();
    if (size < offset) return null;
    const start = Math.max(offset, size - MOST);
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8", 0, bytesRead).split("\n").filter(Boolean);
    const read = timelineOf(start > offset ? lines.slice(1) : lines).detail(0);
    const tests = read.tests ? { passed: read.tests.passed, failed: read.tests.failed, ok: read.tests.ok } : null;
    return { tests, files: read.files.length };
  } finally {
    await handle.close();
  }
}

/// Claude Code sessions' turns, from leaving idle to coming back to it. Where a session's
/// transcript stands while it is idle is noted, so that as a turn ends only what it wrote in that
/// turn is read, and only for counts: how its tests went and how many files it changed.
export class Turns {
  readonly #projects: string;
  readonly #states = new Map<string, State>();
  readonly #began = new Map<string, Began>();
  readonly #idle = new Map<string, number>();
  readonly #paths = new Map<string, string>();

  constructor(projects: string) {
    this.#projects = projects;
  }

  /// The sessions as now seen, and the turns among them that have just ended, with how they went.
  /// What changed is settled before anything is read, so two looks at once never end a turn twice.
  async seen(sessions: Coding[], now: number): Promise<Finished[]> {
    const listed = new Set(sessions.map((one) => one.id));
    for (const id of [...this.#states.keys()]) if (!listed.has(id)) this.#forget(id);
    const unseen: string[] = [];
    const ending: Array<{ one: Coding; began: Began | undefined }> = [];
    for (const one of sessions) {
      if (one.harness !== "claude") continue;
      const was = this.#states.get(one.id);
      this.#states.set(one.id, one.state);
      if (one.state !== "idle" && (was === undefined || was === "idle")) {
        const offset = was === "idle" ? this.#idle.get(one.id) : undefined;
        this.#began.set(one.id, { at: now, offset });
        if (offset === undefined) unseen.push(one.id);
      }
      if (one.state === "idle" && was !== undefined && was !== "idle") {
        ending.push({ one, began: this.#began.get(one.id) });
        this.#began.delete(one.id);
      }
    }
    // A turn already under way when first seen is read from where its transcript stood then.
    for (const id of unseen) {
      const began = this.#began.get(id);
      if (began) this.#began.set(id, { ...began, offset: await this.#size(id) });
    }
    for (const one of sessions) {
      if (one.harness !== "claude" || one.state !== "idle") continue;
      const size = await this.#size(one.id);
      if (size !== undefined) this.#idle.set(one.id, size);
    }
    const finished: Finished[] = [];
    for (const { one, began } of ending) {
      const worked = began ? now - began.at : 0;
      if (worked < MIN_TURN) continue;
      const path = this.#paths.get(one.id);
      const outcome = path && began?.offset !== undefined ? await outcomeOf(path, began.offset) : null;
      finished.push({ session: one.id, project: one.project, ...(one.title ? { title: one.title } : {}), worked, outcome });
    }
    return finished;
  }

  #forget(id: string): void {
    this.#states.delete(id);
    this.#began.delete(id);
    this.#idle.delete(id);
    this.#paths.delete(id);
  }

  /// A session not yet asked a thing has no transcript, so not finding one is not remembered.
  async #size(id: string): Promise<number | undefined> {
    const path = this.#paths.get(id) ?? (await transcriptOf(this.#projects, id));
    if (!path) return undefined;
    const size = await stat(path).then(
      (info) => info.size,
      () => undefined,
    );
    if (size === undefined) this.#paths.delete(id);
    else this.#paths.set(id, path);
    return size;
  }
}
