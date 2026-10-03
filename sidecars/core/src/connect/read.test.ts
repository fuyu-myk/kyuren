import assert from "node:assert/strict";
import { test } from "node:test";
import { gather, readingAction } from "#connect/read.ts";
import type { Item, Source, Span } from "#connect/source.ts";
import { Gate } from "#permission/gate.ts";
import type { Action } from "#permission/action.ts";

const span: Span = { from: "2026-09-01", to: "2026-09-30" };

function itemAt(source: string, at: string): Item {
  return { source, kind: "task", collection: "c", title: at, at, timed: false, done: false };
}

function fake(name: string, origin: string, items: Item[] = [], held = true): Source {
  return {
    name,
    effect: "outbound",
    origin,
    available: () => held,
    read: async () => items,
  };
}

function gate(): Gate {
  return new Gate(() => [{ path: "/tmp/kyuren-vault-not-used", mode: "write" }], () => {});
}

test("reading a service asks, because it leaves the machine", () => {
  const action = readingAction(fake("notion", "https://api.notion.com"));
  assert.equal(action.effect, "outbound");
  assert.equal(gate().decide(action).verdict, "ask");
});

test("reading personal records held on this Mac asks without pretending to be outbound", () => {
  const local: Source = {
    name: "apple_calendar",
    effect: "personal",
    origin: "eventkit://calendars",
    available: () => true,
    read: async () => [],
  };
  const action = readingAction(local);
  assert.equal(action.effect, "personal");
  assert.equal(gate().decide(action).verdict, "ask");
});

test("allowing one service does not allow another", async () => {
  const shared = gate();
  const asked: Action[] = [];
  const ask = async (action: Action) => {
    asked.push(action);
    return action.tool === "notion" ? ("allow" as const) : ("deny" as const);
  };

  const sources = [
    fake("notion", "https://api.notion.com", [itemAt("notion", "2026-09-10")]),
    fake("apple_mail", "https://mail.local", [itemAt("apple_mail", "2026-09-11")]),
  ];

  const first = await gather(sources, span, shared, ask);
  assert.deepEqual(first.read, ["notion"]);
  assert.deepEqual(first.refused, ["apple_mail"]);
  assert.equal(asked.length, 2, "each service is asked about separately");

  const again = await gather(sources, span, shared, ask);
  assert.deepEqual(again.read, ["notion"]);
  assert.equal(asked.length, 2, "an answered service is not asked about twice");
});

test("a service with no credential is unavailable rather than refused", async () => {
  const gathered = await gather(
    [fake("notion", "https://api.notion.com", [], false)],
    span,
    gate(),
    async () => "allow",
  );
  assert.deepEqual(gathered.unavailable, ["notion"]);
  assert.deepEqual(gathered.refused, []);
  assert.deepEqual(gathered.read, []);
});

test("one service failing does not lose the others", async () => {
  const broken: Source = {
    name: "broken",
    effect: "outbound",
    origin: "https://broken.example",
    available: () => true,
    read: async () => {
      throw new Error("notion 401: API token is invalid");
    },
  };
  const working = fake("notion", "https://api.notion.com", [itemAt("notion", "2026-09-10")]);

  const gathered = await gather([broken, working], span, gate(), async () => "allow");
  assert.deepEqual(gathered.read, ["notion"]);
  assert.equal(gathered.items.length, 1);
  assert.equal(gathered.failed[0]?.source, "broken");
  assert.match(gathered.failed[0]?.reason ?? "", /401/);
});

test("items from every service are ordered together by time", async () => {
  const gathered = await gather(
    [
      fake("a", "https://a.example", [itemAt("a", "2026-09-20"), itemAt("a", "2026-09-05")]),
      fake("b", "https://b.example", [itemAt("b", "2026-09-10")]),
    ],
    span,
    gate(),
    async () => "allow",
  );
  assert.deepEqual(gathered.items.map((item) => item.at), ["2026-09-05", "2026-09-10", "2026-09-20"]);
});
