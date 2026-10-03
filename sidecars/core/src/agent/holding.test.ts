import assert from "node:assert/strict";
import { test } from "node:test";
import { routeHolding } from "#agent/holding.ts";
import type { Action } from "#permission/action.ts";
import { Gate } from "#permission/gate.ts";
import type { Demand } from "#model/route.ts";

const DEMAND: Demand = { sensitive: false, online: true, cloudConfigured: true, difficulty: "moderate" };
const CLOUD = { route: "cloud" as const, reason: "test" };

test("a conversation that holds the user's notes asks before it goes to the cloud, and stays on this machine if refused", async () => {
  const gate = new Gate(() => [], () => {});
  const asked: Action[] = [];
  const ask = (answer: "allow" | "deny") => async (action: Action) => {
    asked.push(action);
    return answer;
  };
  assert.equal((await routeHolding(CLOUD, true, DEMAND, ask("allow"), gate)).route, "cloud");
  assert.match(asked[0]?.carrying ?? "", /holds your notes/);
  assert.equal((await routeHolding(CLOUD, true, DEMAND, ask("deny"), gate)).route, "local-small");
  assert.equal((await routeHolding(CLOUD, false, DEMAND, ask("deny"), gate)).route, "cloud", "one that holds none is not asked");
  assert.equal((await routeHolding({ route: "local-large", reason: "test" }, true, DEMAND, ask("deny"), gate)).route, "local-large");
  assert.equal(asked.length, 2);
});
