import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Scheduler, type Starting } from "#ambient/schedule.ts";
import type { Outbound } from "#protocol.ts";

function at(year: number, month: number, day: number, hours: number, minutes: number): Date {
  return new Date(year, month - 1, day, hours, minutes);
}

const file = { enabled: true, schedules: [{ id: "morning", playbook: "weekly-review", at: "07:30" }] };

function setUp(rules: object, starting: Starting, root = mkdtempSync(join(tmpdir(), "schedule-"))) {
  writeFileSync(join(root, "ambient.json"), JSON.stringify(rules));
  const sent: Outbound[] = [];
  const scheduler = new Scheduler({ send: (message) => sent.push(message), listen: () => {} }, root, starting);
  return { scheduler, sent, root };
}

test("a schedule runs its playbook at its time, once, and the run is written down as a firing of it", async () => {
  const started: Array<[string, string]> = [];
  const starting: Starting = async (schedule, due) => {
    started.push([schedule.playbook, due.toISOString()]);
    return { ok: true, why: "proof passed" };
  };
  const { scheduler, sent, root } = setUp(file, starting);

  assert.deepEqual((await scheduler.tick(at(2026, 9, 21, 7, 29))).ran, []);
  const ticked = await scheduler.tick(at(2026, 9, 21, 7, 30));
  assert.deepEqual(started, [["weekly-review", at(2026, 9, 21, 7, 30).toISOString()]]);
  assert.equal(ticked.ran.length, 1);
  assert.equal(ticked.ran[0]!.rule, "morning");
  assert.equal(ticked.ran[0]!.title, "weekly-review ran");
  assert.equal(ticked.ran[0]!.why, "proof passed");
  assert.deepEqual(sent.map((one) => (one as { event: string }).event), ["ambient.notice"]);

  const log = readFileSync(join(root, "ambient.log"), "utf8").trim().split("\n");
  assert.equal(log.length, 1);
  assert.equal((JSON.parse(log[0]!) as { rule: string }).rule, "morning");

  assert.deepEqual((await scheduler.tick(at(2026, 9, 21, 7, 31))).ran, [], "once is once");
  const again = setUp(file, starting, root);
  assert.deepEqual((await again.scheduler.tick(at(2026, 9, 21, 7, 35))).ran, [], "a restart does not run it again");
  assert.equal(started.length, 1);
});

test("switched off, nothing runs, whatever the schedules say", async () => {
  let started = 0;
  const { scheduler, sent } = setUp({ ...file, enabled: false }, async () => {
    started += 1;
    return { ok: true, why: "proof passed" };
  });
  assert.deepEqual((await scheduler.tick(at(2026, 9, 21, 7, 30))).ran, []);
  assert.equal(started, 0);
  assert.deepEqual(sent, []);
});

test("a run that could not start is still written down, with why", async () => {
  const { scheduler } = setUp(file, async () => {
    throw new Error("there is no approved playbook named weekly-review");
  });
  const ticked = await scheduler.tick(at(2026, 9, 21, 7, 30));
  assert.equal(ticked.ran.length, 1);
  assert.match(ticked.ran[0]!.why, /could not run: there is no approved playbook/);
});

test("the state says when each schedule is next due and how its last run went", async () => {
  const { scheduler } = setUp(file, async () => ({ ok: false, why: "proof failed: no file" }));
  const [before] = scheduler.state(at(2026, 9, 21, 7, 0));
  assert.equal(before!.next, at(2026, 9, 21, 7, 30).toISOString());
  assert.equal(before!.last, undefined);

  await scheduler.tick(at(2026, 9, 21, 7, 30));
  const [after] = scheduler.state(at(2026, 9, 21, 7, 31));
  assert.equal(after!.next, at(2026, 9, 22, 7, 30).toISOString());
  assert.equal(after!.last?.why, "proof failed: no file");
});
