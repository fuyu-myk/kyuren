import assert from "node:assert/strict";
import { test } from "node:test";
import { route, type Demand } from "#model/route.ts";

const base: Demand = {
  sensitive: false,
  online: true,
  cloudConfigured: true,
  difficulty: "moderate",
};

test("a hard task online with credentials goes to the cloud", () => {
  assert.equal(route({ ...base, difficulty: "hard" }).route, "cloud");
});

test("sensitive content stays local even when the task is hard", () => {
  const decision = route({ ...base, difficulty: "hard", sensitive: true });
  assert.equal(decision.route, "local-large");
  assert.match(decision.reason, /never leaves/);
});

test("privacy outranks capability, which is the whole point of the ordering", () => {
  const sensitive = route({ ...base, difficulty: "hard", sensitive: true });
  const notSensitive = route({ ...base, difficulty: "hard", sensitive: false });
  assert.notEqual(sensitive.route, notSensitive.route);
});

test("offline falls back to local rather than failing", () => {
  const decision = route({ ...base, difficulty: "hard", online: false });
  assert.equal(decision.route, "local-large");
  assert.match(decision.reason, /offline/);
});

test("without credentials the cloud is never chosen", () => {
  for (const difficulty of ["trivial", "moderate", "hard"] as const) {
    const decision = route({ ...base, difficulty, cloudConfigured: false });
    assert.notEqual(decision.route, "cloud", `${difficulty} should not reach the cloud`);
  }
});

test("trivial work uses the small resident model", () => {
  assert.equal(route({ ...base, difficulty: "trivial" }).route, "local-small");
});

test("easy work stays local even when the cloud is available", () => {
  assert.equal(route({ ...base, difficulty: "moderate" }).route, "local-small");
});

test("the larger local model is kept for work that needs it", () => {
  // It holds ten gigabytes resident, which takes the machine to where the audio device will not
  // start, and it evicts the small model that judged the request.
  for (const difficulty of ["trivial", "moderate"] as const) {
    for (const demand of [
      { ...base, sensitive: true, difficulty },
      { ...base, online: false, difficulty },
      { ...base, cloudConfigured: false, difficulty },
      { ...base, difficulty },
    ]) {
      assert.equal(route(demand).route, "local-small",
        `${difficulty} work reached for the larger model`);
    }
  }

  assert.equal(route({ ...base, cloudConfigured: false, difficulty: "hard" }).route, "local-large");
});

test("every decision explains itself", () => {
  for (const sensitive of [true, false]) {
    for (const online of [true, false]) {
      for (const cloudConfigured of [true, false]) {
        for (const difficulty of ["trivial", "moderate", "hard"] as const) {
          const decision = route({ sensitive, online, cloudConfigured, difficulty });
          assert.ok(decision.reason.length > 10, "a route with no reason cannot be audited");
        }
      }
    }
  }
});

test("a route the user chose is taken, wherever the drivers allow it", () => {
  assert.equal(route({ ...base, preferred: "local-small", difficulty: "hard" }).route, "local-small");
  assert.equal(route({ ...base, preferred: "cloud", difficulty: "trivial" }).route, "cloud");
  assert.match(route({ ...base, preferred: "cloud" }).reason, /chosen/);
});

test("a chosen cloud never overrides privacy or absence, and a chosen local route still holds there", () => {
  const sensitive = route({ ...base, preferred: "cloud", sensitive: true, difficulty: "hard" });
  assert.notEqual(sensitive.route, "cloud");
  assert.match(sensitive.reason, /never leaves/);
  assert.equal(route({ ...base, preferred: "local-small", sensitive: true, difficulty: "hard" }).route, "local-small");
  assert.notEqual(route({ ...base, preferred: "cloud", online: false }).route, "cloud");
  assert.notEqual(route({ ...base, preferred: "cloud", cloudConfigured: false }).route, "cloud");
});
