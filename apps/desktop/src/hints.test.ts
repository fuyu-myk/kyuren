import assert from "node:assert/strict";
import { test } from "node:test";
import { hintsFor, valuesFor } from "./hints.ts";

const weather = {
  name: "weather_now",
  parameters: [
    { name: "q", in: "query" as const, kind: "string" as const, required: true, about: "the place" },
    { name: "aqi", in: "query" as const, kind: "boolean" as const, required: false, about: "air quality too" },
    { name: "days", in: "query" as const, kind: "number" as const, required: false, about: "" },
  ],
  recent: { q: ["Singapore", "New York", "Oslo"], days: ["3"] },
};

test("words without a name go to the needed value, and named ones to theirs, each of its kind", () => {
  assert.deepEqual(valuesFor(weather, "New York aqi=yes days=3"), { values: { q: "New York", aqi: true, days: 3 } });
  assert.deepEqual(valuesFor(weather, 'q="Kuala Lumpur" aqi=no'), { values: { q: "Kuala Lumpur", aqi: false } });
});

test("a needed value left out, one given twice, or one of the wrong kind is said, and nothing is sent", () => {
  assert.deepEqual(valuesFor(weather, ""), { wrong: "q is needed" });
  assert.deepEqual(valuesFor(weather, "Oslo q=Bergen"), { wrong: "q is given twice" });
  assert.deepEqual(valuesFor(weather, "Oslo days=soon"), { wrong: "days should be a number" });
  assert.deepEqual(valuesFor(weather, "Oslo aqi=maybe"), { wrong: "aqi should be yes or no" });
});

test("just after the name, the values used before come first, then what else it takes", () => {
  const hints = hintsFor(weather, "/weather_now ");
  assert.deepEqual(hints.map((one) => one.label), ["Singapore", "New York", "Oslo", "aqi=", "days="]);
  assert.equal(hints[1]?.text, "/weather_now New York ");
  assert.equal(hints[3]?.text, "/weather_now aqi=");
  assert.equal(hints[3]?.about, "boolean: air quality too");
});

test("hints narrow as a value or a name is typed, and a name's own past values follow its equals sign", () => {
  assert.deepEqual(hintsFor(weather, "/weather_now ne").map((one) => one.label), ["New York"]);
  assert.deepEqual(hintsFor(weather, "/weather_now Oslo a").map((one) => one.label), ["aqi="]);
  assert.equal(hintsFor(weather, "/weather_now Oslo a")[0]?.text, "/weather_now Oslo aqi=");
  const days = hintsFor(weather, "/weather_now Oslo days=");
  assert.deepEqual(days.map((one) => [one.label, one.text]), [["3", "/weather_now Oslo days=3 "]]);
});

test("a value already given is not offered again, and the bare name has no hints", () => {
  assert.deepEqual(hintsFor(weather, "/weather_now Singapore ").map((one) => one.label), ["aqi=", "days="]);
  assert.deepEqual(hintsFor(weather, "/weather_now"), []);
});
