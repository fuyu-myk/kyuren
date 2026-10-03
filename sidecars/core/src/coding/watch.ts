import { watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fromActivity, IDLE_FOR, type Trail } from "#coding/activity.ts";
import type { Ask } from "#coding/asked.ts";
import { processAlive } from "#coding/alive.ts";
import { claudeSessions, type Alive } from "#coding/claude.ts";
import { ordered, type Coding } from "#coding/session.ts";
import { Turns } from "#coding/turns.ts";
import { folderOf } from "#coding/where.ts";
import type { Transport } from "#transport.ts";

/// How often states are looked at again without anything having been written, so a session that
/// stops writing is seen to go idle, and how long writes are let settle before the island is told.
const SWEEP = 5_000;
const SETTLE = 250;
/// A project folder that could not be read back is tried again after this, not given up on.
const RETRY = 5 * 60_000;

/// The harnesses known only by their files being written to. Claude Code is here for sessions its
/// own record does not cover, from versions that keep none.
export function trailsIn(home: string): Trail[] {
  return [
    { harness: "claude", root: join(home, ".claude", "projects"), depth: 1, file: /\.jsonl$/, lingers: false },
    { harness: "codex", root: join(home, ".codex", "sessions"), depth: 3, file: /^rollout-.*\.jsonl$/ },
    { harness: "gemini", root: join(home, ".gemini", "tmp"), depth: 2, file: /\.jsonl?$/ },
    { harness: "antigravity", root: join(home, ".gemini", "antigravity", "conversations"), depth: 0, file: /./ },
    { harness: "pi", root: join(home, ".pi", "agent", "sessions"), depth: 1, file: /\.jsonl$/ },
  ];
}

/// What the island would show differently. A last-active time moving on alone is not news.
function signature(sessions: Coding[]): string {
  return JSON.stringify(sessions.map((one) => [one.id, one.state, one.waitingFor, one.title, one.project]));
}

/// Keeps the coding sessions running on this Mac and tells the island when they change, and when a
/// Claude Code session's turn has ended after working a while, with how it went. It reads Claude
/// Code's record of its sessions, and otherwise only when files were written; of what is in them,
/// only the end of a turn, for its counts.
export class CodingWatch {
  private readonly transport: Transport;
  private readonly alive: Alive;
  private readonly trails: Trail[];
  private readonly registry: string;
  /// The questions agents are waiting on the island for an answer to.
  private readonly asks: () => Ask[];
  private readonly clock: () => number;
  private readonly turns: Turns;
  private readonly recent = new Map<string, number>();
  private readonly projects = new Map<string, string>();
  private readonly unread = new Map<string, number>();
  /// Every session the record has shown since watching began. Its file is gone once it ends, and
  /// its transcript, written to at the end, must not bring it back.
  private readonly recorded = new Set<string>();
  /// What is watched, by folder: harnesses installed later, or a watcher that failed, are taken up
  /// again on the next sweep.
  private readonly watchers = new Map<string, FSWatcher>();
  private timer: NodeJS.Timeout | undefined;
  private pending: NodeJS.Timeout | undefined;
  private sessions: Coding[] = [];
  private sent = "";

  constructor(transport: Transport, home: string = homedir(), alive: Alive = processAlive(), asks: () => Ask[] = () => [], clock: () => number = Date.now) {
    this.transport = transport;
    this.alive = alive;
    this.asks = asks;
    this.clock = clock;
    this.turns = new Turns(join(home, ".claude", "projects"));
    this.trails = trailsIn(home);
    this.registry = join(home, ".claude", "sessions");
  }

  start(): void {
    this.stop();
    this.followAll();
    this.timer = setInterval(() => {
      this.followAll();
      void this.refresh();
    }, SWEEP);
    this.timer.unref();
    void this.refresh();
  }

  stop(): void {
    for (const one of this.watchers.values()) one.close();
    this.watchers.clear();
    if (this.timer) clearInterval(this.timer);
    if (this.pending) clearTimeout(this.pending);
  }

  list(): Coding[] {
    return this.sessions;
  }

  async refresh(): Promise<void> {
    const now = this.clock();
    for (const [path, at] of this.recent) if (now - at > IDLE_FOR) this.recent.delete(path);
    const recorded = await claudeSessions(this.registry, this.alive);
    for (const one of recorded) this.recorded.add(one.id);
    await this.learnProjects();
    // A session whose question is held on the island waits on the user, whatever its own record
    // says while the question is held from its prompt.
    const asking = new Map(this.asks().map((ask) => [ask.session, ask]));
    const found = [...recorded, ...fromActivity(this.trails, this.recent, now, this.projects, this.recorded)];
    const sessions = ordered(
      found.map((one) => {
        const ask = asking.get(one.id);
        return ask ? { ...one, state: "waiting" as const, waitingFor: `permission to ${ask.verb}` } : one;
      }),
    );
    this.sessions = sessions;
    const ended = await this.turns.seen(sessions, now);
    const said = signature(sessions);
    if (said !== this.sent) {
      this.sent = said;
      this.transport.send({ event: "coding.sessions", data: { sessions } });
    }
    for (const one of ended) this.transport.send({ event: "coding.done", data: one });
  }

  /// Something changed that the sessions are shown with, such as a question held or let go.
  nudge(): void {
    this.soon();
  }

  /// A file written to just now, as a watcher saw it.
  saw(path: string, at: number): void {
    this.recent.set(path, at);
    this.soon();
  }

  private followAll(): void {
    this.follow(this.registry, false, () => this.soon());
    for (const trail of this.trails) {
      if (this.follow(trail.root, true, (file) => void this.written(join(trail.root, file)))) void this.scan(trail.root, trail.depth);
    }
  }

  /// Watches a folder not watched yet, saying whether it began to.
  private follow(dir: string, recursive: boolean, changed: (file: string) => void): boolean {
    if (this.watchers.has(dir)) return false;
    try {
      const watcher = watch(dir, { recursive, persistent: false }, (_kind, file) => {
        if (file) changed(file.toString());
      });
      watcher.on("error", () => {
        watcher.close();
        this.watchers.delete(dir);
      });
      this.watchers.set(dir, watcher);
      return true;
    } catch {
      // A harness that is not installed has nothing to watch, until it is.
      return false;
    }
  }

  private soon(): void {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = undefined;
      void this.refresh();
    }, SETTLE);
    this.pending.unref();
  }

  private async written(path: string): Promise<void> {
    const seen = await stat(path).catch(() => undefined);
    if (seen?.isFile()) this.saw(path, seen.mtimeMs);
  }

  /// The files already written to lately when watching begins, found by walking down to where a
  /// harness keeps its session files.
  private async scan(dir: string, depth: number): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (depth > 0 && entry.isDirectory()) await this.scan(path, depth - 1);
      if (depth === 0 && entry.isFile()) {
        const seen = await stat(path).catch(() => undefined);
        if (seen && Date.now() - seen.mtimeMs <= IDLE_FOR) this.recent.set(path, seen.mtimeMs);
      }
    }
    this.soon();
  }

  /// Folders named after a project's path are read back once each, and one that could not be is
  /// tried again later, since the folder it names may be made yet.
  private async learnProjects(): Promise<void> {
    const now = Date.now();
    for (const path of this.recent.keys()) {
      const folder = dirname(path);
      if (this.projects.has(folder) || now - (this.unread.get(folder) ?? -Infinity) < RETRY) continue;
      const found = await folderOf(basename(folder));
      if (found) {
        this.projects.set(folder, found);
        this.unread.delete(folder);
      } else {
        this.unread.set(folder, now);
      }
    }
  }
}
