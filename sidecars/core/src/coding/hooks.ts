import { randomUUID } from "node:crypto";
import { chmod, mkdir, unlink } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { z } from "zod";
import { claudeAnswer, claudeAsk, type Ask, type Decision } from "#coding/asked.ts";
import type { Transport } from "#transport.ts";

/// How long a question waits on the island before Claude Code asks it itself. Claude Code holds its
/// own prompt back while a hook decides, so this is the longest anyone at the terminal waits.
export const ASK_FOR = 45_000;
/// Answered this long before the relay stops listening, so the answer always reaches it.
const MARGIN = 3_000;
/// A question the island has not said it has, by now, is one nobody can answer there: the island
/// may not be loaded. It goes back to the agent rather than keeping it waiting for nothing.
const SEEN_WITHIN = 3_000;
/// More questions than this at once is not agents at work but something flooding the line.
const MOST_HELD = 16;
/// A tool's input can be a whole file; the relay sends at most this much of it.
const MOST = (4 << 20) + 4096;
/// A relay that has not finished saying what it came to say by now is not going to, however slowly
/// it keeps sending.
const SAYING = 5_000;

const HEADER = z.object({
  harness: z.string(),
  event: z.string(),
  parent: z.number(),
  wait: z.number().min(0),
  size: z.number().int().min(0).max(MOST),
});

type Held = { ask: Ask; socket: Socket; timers: NodeJS.Timeout[]; seen: boolean };

type Options = { askFor?: number; seenWithin?: number; mostHeld?: number; saying?: number; changed?: () => void };

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/// Whether something answers on this line already: the core of another Kyuren, still running.
function answered(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect(path);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });
}

/// Hears coding agents' hooks, through the relay their settings run, on a socket only this user can
/// reach. A permission question is held for the island to answer; anything else is let go at once.
export class HookListener {
  readonly path: string;
  private readonly transport: Transport;
  private readonly askFor: number;
  private readonly seenWithin: number;
  private readonly mostHeld: number;
  private readonly saying: number;
  private readonly changed: () => void;
  private readonly held = new Map<string, Held>();
  private server: Server | undefined;

  constructor(transport: Transport, path: string, options: Options = {}) {
    this.transport = transport;
    this.path = path;
    this.askFor = options.askFor ?? ASK_FOR;
    this.seenWithin = options.seenWithin ?? SEEN_WITHIN;
    this.mostHeld = options.mostHeld ?? MOST_HELD;
    this.saying = options.saying ?? SAYING;
    this.changed = options.changed ?? (() => {});
  }

  /// Listens in a folder of its own that only this user can look into, so the line is never open
  /// to anyone else, even for the moment before the socket's own permissions are set.
  async start(): Promise<void> {
    if (this.server) return;
    const folder = dirname(this.path);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await chmod(folder, 0o700);
    if (await answered(this.path)) return;
    await unlink(this.path).catch(() => {});
    const server = createServer({ allowHalfOpen: true }, (socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.path, () => resolve());
    });
    server.on("error", () => {});
    try {
      await chmod(this.path, 0o600);
    } catch (failure) {
      server.close();
      throw failure;
    }
    this.server = server;
  }

  listening(): boolean {
    return this.server !== undefined;
  }

  /// Hands every held question back, so no agent is left waiting on a Kyuren that has gone.
  async stop(): Promise<void> {
    for (const id of [...this.held.keys()]) this.answer(id, "ask");
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await unlink(this.path).catch(() => {});
  }

  pending(): Ask[] {
    return [...this.held.values()].map((one) => one.ask);
  }

  /// The island has the question in front of the user, so it is held for its whole wait.
  seen(id: string): boolean {
    const held = this.held.get(id);
    if (!held) return false;
    held.seen = true;
    return true;
  }

  answer(id: string, decision: Decision): boolean {
    const held = this.held.get(id);
    if (!held) return false;
    held.socket.end(claudeAnswer(decision));
    this.release(id, decision);
    return true;
  }

  private release(id: string, decision: Decision | "gone"): void {
    const held = this.held.get(id);
    if (!held) return;
    for (const timer of held.timers) clearTimeout(timer);
    this.held.delete(id);
    this.transport.send({ event: "coding.permission.done", data: { id, decision } });
    this.changed();
  }

  /// A header line saying how long the event is, then the event. The relay keeps the line open
  /// while it waits for an answer, so its closing is the agent no longer waiting.
  private accept(socket: Socket): void {
    let buffered = Buffer.alloc(0);
    let done = false;
    const saying = setTimeout(() => {
      if (!done) socket.destroy();
    }, this.saying);
    socket.once("close", () => clearTimeout(saying));
    socket.on("error", () => socket.destroy());
    // Gone before saying anything whole, such as another Kyuren looking to see whether this one runs.
    socket.once("end", () => {
      if (!done) socket.destroy();
    });
    socket.on("data", (chunk: Buffer) => {
      if (done) return;
      buffered = Buffer.concat([buffered, chunk]);
      const newline = buffered.indexOf(0x0a);
      if (newline < 0) {
        if (buffered.length > 4096) socket.destroy();
        return;
      }
      const header = HEADER.safeParse(parsed(buffered.subarray(0, newline).toString("utf8")));
      if (!header.success) {
        done = true;
        socket.end();
        return;
      }
      if (buffered.length - newline - 1 < header.data.size) return;
      done = true;
      clearTimeout(saying);
      const payload = buffered.subarray(newline + 1, newline + 1 + header.data.size).toString("utf8");
      this.heard(socket, header.data, payload);
    });
  }

  private heard(socket: Socket, header: z.infer<typeof HEADER>, payload: string): void {
    const wait = Math.max(0, Math.min(this.askFor, header.wait * 1000 - MARGIN));
    const asking = header.harness === "claude" && header.event === "PermissionRequest" && wait > 0;
    const room = this.held.size < this.mostHeld;
    const ask = asking && room ? claudeAsk(parsed(payload), randomUUID(), Date.now(), wait) : undefined;
    if (!ask) {
      socket.end();
      return;
    }
    const timers = [
      setTimeout(() => this.answer(ask.id, "ask"), wait),
      setTimeout(() => {
        if (!this.held.get(ask.id)?.seen) this.answer(ask.id, "ask");
      }, Math.min(this.seenWithin, wait)),
    ];
    this.held.set(ask.id, { ask, socket, timers, seen: false });
    const gone = () => {
      socket.destroy();
      this.release(ask.id, "gone");
    };
    socket.once("end", gone);
    socket.once("close", gone);
    this.transport.send({ event: "coding.permission", data: ask });
    this.changed();
  }
}
