import { join } from "node:path";
import { appendFiring, recentFirings } from "#ambient/log.ts";
import { matching, type Firing } from "#ambient/match.ts";
import { readRules } from "#ambient/rules.ts";
import { Seen } from "#ambient/seen.ts";
import { gather, readingAction } from "#connect/read.ts";
import { spanAround, type Source } from "#connect/source.ts";
import type { Gate } from "#permission/gate.ts";
import type { Transport } from "#transport.ts";

/// How long after starting before the first look, so that connections and permissions from the
/// last session have settled, and how many things are remembered as already surfaced.
const SETTLE = 20_000;
const REMEMBERED = 2_000;

export type Looked = {
  at: string;
  enabled: boolean;
  firings: Firing[];
  read: string[];
  notAllowed: string[];
  trouble?: string;
};

/// Kyuren noticing things on its own. It looks every few minutes at the sources the rules file
/// names, and only those: naming a source there is the standing permission to read it unattended,
/// and nothing else grants one. It surfaces only what a rule the user wrote says it may, and every
/// firing is written down with the rule that caused it, so a week of the log answers whether it
/// interrupted anyone it should not have.
export class Ambient {
  private readonly transport: Transport;
  private readonly gate: Gate;
  private readonly sources: Source[];
  private timer: NodeJS.Timeout | undefined;
  private lastLook: Date | undefined;
  private lastLooked: Looked | undefined;
  private readonly seen: Seen;
  private readonly rulesPath: string;
  private readonly logPath: string;

  constructor(transport: Transport, gate: Gate, sources: Source[], root: string) {
    this.transport = transport;
    this.gate = gate;
    this.sources = sources;
    this.rulesPath = join(root, "ambient.json");
    this.logPath = join(root, "ambient.log");
    this.seen = new Seen(join(root, "ambient-seen.json"), REMEMBERED);
  }

  start(): void {
    this.stop();
    this.timer = setTimeout(() => void this.round(), SETTLE);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async round(): Promise<void> {
    const rules = readRules(this.rulesPath).rules;
    try {
      await this.look();
    } finally {
      this.timer = setTimeout(() => void this.round(), rules.every * 60_000);
      this.timer.unref();
    }
  }

  /// One look. Reads only what is already permitted, fires what the rules allow, and reports what
  /// it did, which is also what a person trying a rule out wants to be told.
  async look(now: Date = new Date()): Promise<Looked> {
    const { rules, trouble } = readRules(this.rulesPath);
    const looked: Looked = { at: now.toISOString(), enabled: rules.enabled, firings: [], read: [], notAllowed: [], trouble };
    if (!rules.enabled || rules.rules.length === 0) {
      this.lastLooked = looked;
      return looked;
    }

    const named = this.sources.filter((source) => rules.read.includes(source.name));
    const unknown = rules.read.filter((name) => !this.sources.some((source) => source.name === name));
    if (unknown.length) {
      looked.trouble = [looked.trouble, `no source is called ${unknown.join(", ")}`].filter(Boolean).join("; ");
    }
    // The file is the user's own hand: a source written in it has been allowed, and is remembered
    // as allowed the way an answer at the keyboard would be.
    for (const source of named) this.gate.remember(readingAction(source), "allow");

    const gathered = await gather(named, spanAround(now, 1, 1), this.gate);
    looked.read = gathered.read;
    looked.notAllowed = gathered.refused;
    for (const failure of gathered.failed) {
      looked.trouble = [looked.trouble, `${failure.source}: ${failure.reason}`].filter(Boolean).join("; ");
    }

    looked.firings = matching(rules.rules, gathered.items, now, this.lastLook, (key) => this.seen.has(key));
    for (const firing of looked.firings) this.surface(firing);

    this.lastLook = now;
    this.lastLooked = looked;
    // Every look is announced, fired or not, so the record shows the looking as well as the
    // finding: a week of silence is only reassuring if the log shows it was not a week of nothing.
    this.transport.send({
      event: "ambient.looked",
      data: { at: looked.at, read: looked.read, notAllowed: looked.notAllowed, fired: looked.firings.length, trouble: looked.trouble ?? null },
    });
    return looked;
  }

  private surface(firing: Firing): void {
    this.seen.add(firing.key);
    appendFiring(this.logPath, firing);
    this.transport.send({ event: "ambient.notice", data: firing });
  }

  state(): Record<string, unknown> {
    const { rules, trouble } = readRules(this.rulesPath);
    const last = this.lastLooked;
    return {
      file: this.rulesPath,
      enabled: rules.enabled,
      every: rules.every,
      read: rules.read,
      rules: rules.rules.map((one) => ({ id: one.id, when: one.when, voice: one.voice })),
      trouble,
      lastLook: last
        ? { at: last.at, fired: last.firings.length, read: last.read, notAllowed: last.notAllowed, trouble: last.trouble }
        : undefined,
    };
  }

  /// The most recent firings, newest first, from the log: what the rules noticed and what the
  /// schedules ran, together.
  recent(limit: number): Firing[] {
    return recentFirings(this.logPath, limit);
  }
}
