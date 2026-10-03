import assert from "node:assert/strict";
import { test } from "node:test";
import { ceiling, countdown, minutes, nearest, played, rate, remaining } from "./glance.ts";

test("a rate is said in the unit that keeps it short", () => {
  assert.equal(rate(0), "0 KB/s");
  assert.equal(rate(512), "0.5 KB/s");
  assert.equal(rate(340_000), "340 KB/s");
  assert.equal(rate(2_400_000), "2.4 MB/s");
  assert.equal(rate(18_000_000), "18 MB/s");
});

test("upload and download share one scale, never so small that silence looks busy", () => {
  assert.equal(ceiling([{ at: 1, up: 2_000, down: 50_000 }, { at: 2, up: 9_000, down: 10_000 }]), 50_000);
  assert.equal(ceiling([{ at: 1, up: 3, down: 0 }]), 10_000, "a quiet line stays near the middle");
  assert.equal(ceiling([]), 10_000);
});

test("the cursor picks the sample under it", () => {
  assert.equal(nearest(0, 150, 120), 0);
  assert.equal(nearest(150, 150, 120), 119);
  assert.equal(nearest(75, 150, 120), 60);
  assert.equal(nearest(-20, 150, 120), 0, "past the edge is the edge");
  assert.equal(nearest(10, 150, 0), -1, "nothing yet is nothing to pick");
});

test("the pomodoro counts down in minutes and seconds, never showing nothing left early", () => {
  assert.equal(countdown(25 * 60_000), "25:00");
  assert.equal(countdown(9 * 60_000 + 59_500), "10:00", "a second partly gone still counts");
  assert.equal(countdown(61_000), "01:01");
  assert.equal(countdown(400), "00:01");
  assert.equal(countdown(0), "00:00");
  assert.equal(remaining({ period: "focus", endsAt: 10_000, left: 1, done: 0 }, 4_000), 6_000);
  assert.equal(remaining({ period: "focus", endsAt: 10_000, left: 1, done: 0 }, 12_000), 0);
  assert.equal(remaining({ period: "short", endsAt: null, left: 90_000, done: 1 }, 12_000), 90_000);
});

test("what plays moves on by itself between what the player says, and stops at the end", () => {
  const base = { player: "spotify", title: "t", artist: "a", album: "b", duration: 200, position: 40, at: 1_000, playing: true, track: null, volume: null };
  assert.equal(played(base, 11_000), 50);
  assert.equal(played({ ...base, playing: false }, 11_000), 40, "paused, it stays put");
  assert.equal(played(base, 1_000_000), 200, "it never runs past the end");
  assert.equal(played({ ...base, position: null }, 11_000), null, "not knowing stays not knowing");
  assert.equal(minutes(0), "0:00");
  assert.equal(minutes(171), "2:51");
  assert.equal(minutes(3_725), "62:05");
});
