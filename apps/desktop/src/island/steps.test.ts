import assert from "node:assert/strict";
import { test } from "node:test";
import { merged, type Detail, type Step } from "./steps.ts";

const running: Step = { id: "a", verb: "run", target: "cargo test", ok: null };
const had: Detail = { epoch: "e", seq: 1, total: 1, task: null, branch: null, steps: [running], files: [], tests: null, said: null };

test("what changed since is laid over what was had, in the order the steps were taken", () => {
  const got: Detail = { ...had, seq: 3, total: 2, steps: [{ ...running, ok: true }, { id: "b", verb: "read", target: "a.ts", ok: null }] };
  assert.deepEqual(merged(had, got).steps.map((one) => [one.id, one.ok]), [["a", true], ["b", null]]);
  assert.equal(merged(had, got).seq, 3);
});

test("a reading of another session, or the same read afresh, replaces what was had", () => {
  const afresh: Detail = { ...had, epoch: "f", steps: [{ id: "c", verb: "edit", target: "b.ts", ok: true }] };
  assert.deepEqual(merged(had, afresh).steps.map((one) => one.id), ["c"]);
  assert.equal(merged(undefined, afresh), afresh);
  assert.equal(merged(null, afresh), afresh);
});

test("a look that found nothing new keeps what was had, so nothing is drawn again", () => {
  const same: Detail = { ...had, steps: [] };
  assert.equal(merged(had, same), had);
  assert.notEqual(merged(had, { ...same, task: "another" }), had, "a new task is news");
});

test("what the agent said last is news though no step came with it", () => {
  const spoke: Detail = { ...had, steps: [], said: "Which of the two should I keep?" };
  assert.equal(merged(had, spoke).said, "Which of the two should I keep?");
});
