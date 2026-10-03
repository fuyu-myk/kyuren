import assert from "node:assert/strict";
import { test } from "node:test";
import { ago } from "./when.ts";

const now = new Date("2026-09-16T12:00:00Z").getTime();
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

test("what just happened is said to have just happened", () => {
  assert.equal(ago(now, now), "just now");
  assert.equal(ago(now - 30_000, now), "just now");
});

test("minutes and hours are counted, and counted in plain words", () => {
  assert.equal(ago(now - minute, now), "1 minute ago");
  assert.equal(ago(now - 12 * minute, now), "12 minutes ago");
  assert.equal(ago(now - hour, now), "1 hour ago");
  assert.equal(ago(now - 5 * hour, now), "5 hours ago");
});

test("yesterday is yesterday rather than twenty six hours", () => {
  assert.equal(ago(now - 26 * hour, now), "yesterday");
  assert.equal(ago(now - 3 * day, now), "3 days ago");
});

test("anything older than a week is given its date", () => {
  assert.equal(ago(new Date("2026-08-04T09:00:00Z").getTime(), now), "4 August");
  assert.equal(ago(new Date("2025-03-19T09:00:00Z").getTime(), now), "19 March 2025");
});

test("a clock that has slipped forward does not report the future", () => {
  assert.equal(ago(now + 5 * minute, now), "just now");
});
