import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { Ambient } from "#ambient/watch.ts";
import type { Item, Source } from "#connect/source.ts";
import { Gate } from "#permission/gate.ts";
import type { Outbound } from "#protocol.ts";

const now = new Date("2026-09-17T10:00:00Z");

function calendar(items: Item[]): Source {
  return {
    name: "test_calendar",
    effect: "personal",
    origin: "test://calendar",
    available: () => true,
    read: async () => items,
  };
}

function setUp(file: object, sources: Source[]) {
  const root = mkdtempSync(join(tmpdir(), "ambient-"));
  writeFileSync(join(root, "ambient.json"), JSON.stringify(file));
  const sent: Outbound[] = [];
  const gate = new Gate(() => [], () => {});
  const ambient = new Ambient({ send: (message) => sent.push(message), listen: () => {} }, gate, sources, root);
  return { ambient, sent, root };
}

const soon: Item = {
  source: "test_calendar",
  kind: "event",
  collection: "work",
  title: "Design review",
  at: "2026-09-17T10:07:00Z",
  timed: true,
  done: false,
};

// A personal source asks before it is read, and nobody is at the keyboard to answer. Reading it
// unattended is allowed by one thing only: the user having written its name into the rules.
test("a source is read unattended only if the rules name it", async () => {
  const rules = [{ id: "soon", when: "event", within: 10 }];
  const unnamed = setUp({ enabled: true, rules }, [calendar([soon])]);
  const quiet = await unnamed.ambient.look(now);
  assert.deepEqual(quiet.read, []);
  assert.deepEqual(quiet.firings, []);
  assert.equal(unnamed.sent.filter((one) => (one as { event: string }).event === "ambient.notice").length, 0, "nothing reaches the user");

  const named = setUp({ enabled: true, read: ["test_calendar"], rules }, [calendar([soon])]);
  const looked = await named.ambient.look(now);
  assert.deepEqual(looked.read, ["test_calendar"]);
  assert.equal(looked.firings.length, 1);
  assert.equal(looked.firings[0]!.why, "starts in 7 minutes");
  const events = named.sent.map((one) => (one as { event: string }).event);
  assert.deepEqual(events, ["ambient.notice", "ambient.looked"]);
  assert.deepEqual(unnamed.sent.map((one) => (one as { event: string }).event), ["ambient.looked"], "the look itself is always announced");
});

test("a firing is written down with the rule that caused it, and does not fire again", async () => {
  const { ambient, sent, root } = setUp(
    { enabled: true, read: ["test_calendar"], rules: [{ id: "soon", when: "event", within: 10 }] },
    [calendar([soon])],
  );
  await ambient.look(now);
  const again = await ambient.look(new Date(now.getTime() + 60_000));
  assert.equal(again.firings.length, 0, "once is once");
  assert.equal(sent.filter((one) => (one as { event: string }).event === "ambient.notice").length, 1);

  const log = readFileSync(join(root, "ambient.log"), "utf8").trim().split("\n");
  assert.equal(log.length, 1);
  const written = JSON.parse(log[0]!) as { rule: string; title: string };
  assert.equal(written.rule, "soon");
  assert.equal(written.title, "Design review");
  assert.deepEqual(ambient.recent(5).map((one) => one.rule), ["soon"]);
});

test("a source the rules name but nothing is called is reported, not read", async () => {
  const { ambient } = setUp(
    { enabled: true, read: ["nowhere"], rules: [{ id: "soon", when: "event", within: 10 }] },
    [calendar([soon])],
  );
  const looked = await ambient.look(now);
  assert.match(looked.trouble ?? "", /no source is called nowhere/);
  assert.deepEqual(looked.read, []);
});

test("switched off, nothing is read and nothing fires, whatever the rules say", async () => {
  const { ambient, sent } = setUp(
    { enabled: false, read: ["test_calendar"], rules: [{ id: "soon", when: "event", within: 10 }] },
    [calendar([soon])],
  );
  const looked = await ambient.look(now);
  assert.equal(looked.enabled, false);
  assert.deepEqual(looked.read, []);
  assert.equal(sent.filter((one) => (one as { event: string }).event === "ambient.notice").length, 0);
});

// A look runs on a timer, where nothing waits on it. One that fails, here because what was allowed
// could not be saved, must cost that look and be said, not take the whole process down with it.
test("a look that fails is reported as trouble and the next look still comes", async () => {
  const root = mkdtempSync(join(tmpdir(), "ambient-"));
  writeFileSync(join(root, "ambient.json"), JSON.stringify({ enabled: true, every: 5, read: ["test_calendar"], rules: [{ id: "soon", when: "event", within: 10 }] }));
  const sent: Outbound[] = [];
  const full = { read: () => [], write: () => { throw new Error("EMFILE: too many open files"); } };
  const ambient = new Ambient({ send: (message) => sent.push(message), listen: () => {} }, new Gate(() => [], () => {}, full), [calendar([soon])], root);
  const settled = () => new Promise((done) => setImmediate(done));
  const troubles = () => sent.flatMap((one) => ("event" in one && one.event === "ambient.looked" ? [String((one.data as { trouble: string | null }).trouble)] : []));

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    ambient.start();
    mock.timers.tick(20_000);
    await settled();
    assert.equal(troubles().length, 1, "the failed look is announced like any other");
    assert.match(troubles()[0]!, /the look did not finish: EMFILE: too many open files/);
    assert.match(String((ambient.state().lastLook as { trouble?: string }).trouble), /did not finish/, "and asked after, it is what the last look says");

    mock.timers.tick(5 * 60_000);
    await settled();
    assert.equal(troubles().length, 2, "looking goes on");
  } finally {
    ambient.stop();
    mock.timers.reset();
  }
});
