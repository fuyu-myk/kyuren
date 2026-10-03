import assert from "node:assert/strict";
import { test } from "node:test";
import { Presence, RISE, SHUT, SPAN, smoothstep } from "./presence.ts";

test("an orb fades up rather than appearing at full size", () => {
  const presence = new Presence();
  presence.note(["a"], 0);

  assert.equal(presence.of("a", 0), 0);
  assert.ok(presence.of("a", RISE / 2) > 0.2);
  assert.equal(presence.of("a", RISE), 1);
  assert.equal(presence.of("a", 40), 1, "arriving is over, not still happening");
});

test("a whole whirlpool arrives in the same span however many orbs it holds", () => {
  const few = new Presence();
  few.note(["a", "b", "c"], 0);
  const many = new Presence();
  many.note(Array.from({ length: 900 }, (_, at) => `n${at}`), 0);

  const done = SPAN + RISE;
  assert.equal(few.of("c", done), 1);
  assert.equal(many.of("n899", done), 1, "a big mind must not take longer to appear");
});

test("orbs arrive in turn rather than all at once", () => {
  const presence = new Presence();
  presence.note(["first", "middle", "last"], 0);

  const at = SPAN / 2;
  assert.ok(presence.of("first", at) > presence.of("last", at), "a stagger is the point");
});

test("something already here is not born again", () => {
  const presence = new Presence();
  presence.note(["a"], 0);
  presence.note(["a", "b"], 10);

  assert.equal(presence.of("a", 10), 1, "restarting the rise would make the whirlpool flicker");
  assert.equal(presence.of("b", 10), 0);
});

test("what is not known is not here", () => {
  assert.equal(new Presence().of("nobody", 5), 0);
});

test("an orb sent away fades out and stays gone", () => {
  const presence = new Presence();
  presence.note(["a"], 0);
  presence.dismiss(["a"], 10);

  assert.equal(presence.of("a", 10), 1);
  assert.ok(presence.of("a", 10 + RISE / 2) < 0.8, "it should be on its way out");
  assert.equal(presence.of("a", 10 + SHUT + RISE), 0);
  assert.equal(presence.of("a", 60), 0);
});

test("the last orb to arrive is the first to leave", () => {
  const presence = new Presence();
  presence.note(["first", "middle", "last"], 0);
  presence.dismiss(["first", "middle", "last"], 10);

  const at = 10 + SHUT / 2;
  assert.ok(presence.of("last", at) < presence.of("first", at), "a whirlpool unwinds from its rim");
});

test("what is leaving is known, until it has gone", () => {
  const presence = new Presence();
  presence.note(["a", "b"], 0);
  assert.deepEqual(presence.leaving(1), []);

  presence.dismiss(["a"], 10);
  assert.deepEqual(presence.leaving(10), ["a"]);
  assert.ok(!presence.settled(10));

  assert.deepEqual(presence.leaving(10 + SHUT + RISE), []);
  assert.ok(presence.settled(10 + SHUT + RISE));
});

test("an orb called back on its way out comes back", () => {
  const presence = new Presence();
  presence.note(["a"], 0);
  presence.dismiss(["a"], 10);
  presence.note(["a"], 10.1);

  assert.deepEqual(presence.leaving(10.1), [], "it is no longer going anywhere");
  assert.equal(presence.of("a", 10.1 + SPAN + RISE), 1);
});

test("forgetting lets the whole whirlpool arrive again", () => {
  const presence = new Presence();
  presence.note(["a"], 0);
  presence.forget();
  presence.note(["a"], 100);

  assert.equal(presence.of("a", 100), 0);
  assert.equal(presence.of("a", 100 + SPAN + RISE), 1);
});

test("smoothstep starts and ends flat", () => {
  assert.equal(smoothstep(-1), 0);
  assert.equal(smoothstep(2), 1);
  assert.equal(smoothstep(0.5), 0.5);
});
