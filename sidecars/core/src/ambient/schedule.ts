import { join } from "node:path";
import { dueBetween, keyOf, nextDue, type Due } from "#ambient/due.ts";
import { appendFiring } from "#ambient/log.ts";
import type { Firing } from "#ambient/match.ts";
import { readRules, type Schedule } from "#ambient/rules.ts";
import { Seen } from "#ambient/seen.ts";
import type { Transport } from "#transport.ts";

/// How long after starting before the first look, as with the looking: connections and
/// permissions from the last session settle first. Then once a minute, which is the grain of
/// a time of day.
const SETTLE = 20_000;
const TICK = 60_000;
const REMEMBERED = 400;

/// How a run came out, in a few words for the notice.
export type Started = { ok: boolean; why: string };

/// Runs a playbook for a schedule, unattended, and says how it went.
export type Starting = (schedule: Schedule, due: Date) => Promise<Started>;

export type Ticked = {
  at: string;
  ran: Firing[];
  trouble?: string;
};

export type Standing = {
  id: string;
  playbook: string;
  at: string;
  on?: string[];
  next: string;
  last?: { at: string; why: string };
};

/// Playbooks run at their time. Once a minute it reads the rules file and starts whatever came
/// due since the last look, once each, and every run is written into the presence log as a
/// firing of the schedule that caused it, so the log shows the running as it shows the noticing.
/// A schedule starts its own playbook and nothing else.
export class Scheduler {
  private readonly transport: Transport;
  private readonly starting: Starting;
  private readonly rulesPath: string;
  private readonly logPath: string;
  private readonly seen: Seen;
  private readonly lastRan = new Map<string, { at: string; why: string }>();
  private timer: NodeJS.Timeout | undefined;
  private last: Date | undefined;

  constructor(transport: Transport, root: string, starting: Starting) {
    this.transport = transport;
    this.starting = starting;
    this.rulesPath = join(root, "ambient.json");
    this.logPath = join(root, "ambient.log");
    this.seen = new Seen(join(root, "schedules-ran.json"), REMEMBERED);
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

  // The next look is set only once this one is over, so a run that takes a while is never joined
  // by a second look starting more beside it.
  private async round(): Promise<void> {
    try {
      await this.tick();
    } finally {
      this.timer = setTimeout(() => void this.round(), TICK);
      this.timer.unref();
    }
  }

  async tick(now = new Date()): Promise<Ticked> {
    const { rules, trouble } = readRules(this.rulesPath);
    const ticked: Ticked = { at: now.toISOString(), ran: [], trouble };
    const since = this.last;
    this.last = now;
    if (!rules.enabled || rules.schedules.length === 0) return ticked;

    for (const one of dueBetween(rules.schedules, since, now)) {
      const key = keyOf(one.schedule, one.due);
      if (this.seen.has(key)) continue;
      // Written down before the run, so a run that brings the process down is not run again.
      this.seen.add(key);
      ticked.ran.push(await this.run(one, key));
    }
    return ticked;
  }

  private async run(one: Due, key: string): Promise<Firing> {
    let came: Started;
    try {
      came = await this.starting(one.schedule, one.due);
    } catch (failure) {
      came = { ok: false, why: `could not run: ${failure instanceof Error ? failure.message : String(failure)}` };
    }
    const firing: Firing = {
      rule: one.schedule.id,
      voice: one.schedule.voice,
      title: `${one.schedule.playbook} ran`,
      why: came.why,
      at: new Date().toISOString(),
      when: one.due.toISOString(),
      key,
    };
    this.lastRan.set(one.schedule.id, { at: firing.at, why: firing.why });
    appendFiring(this.logPath, firing);
    this.transport.send({ event: "ambient.notice", data: firing });
    return firing;
  }

  /// Every schedule, when it is next due, and how its last run went.
  state(now = new Date()): Standing[] {
    return readRules(this.rulesPath).rules.schedules.map((one) => ({
      id: one.id,
      playbook: one.playbook,
      at: one.at,
      on: one.on,
      next: nextDue(one, now).toISOString(),
      last: this.lastRan.get(one.id),
    }));
  }
}
