import assert from "node:assert/strict";
import { test } from "node:test";
import { faults, onlyInPath, placeholders, reachable, type Draft } from "#skill/shape.ts";

function draft(changes: Partial<Draft> = {}): Draft {
  return {
    name: "weather_now",
    about: "The current weather in a named city, from the open weather service.",
    method: "GET",
    url: "https://api.example.com/v1/weather/{city}",
    parameters: [
      { name: "city", in: "path", kind: "string", required: true, about: "the city to look up" },
    ],
    headers: { accept: "application/json" },
    auth: { mode: "none" },
    reads: "json",
    ...changes,
  };
}

test("a well formed draft has nothing wrong with it", () => {
  assert.deepEqual(faults(draft()), []);
});

test("a skill may only reach the public internet, over https", () => {
  assert.equal(reachable("https://api.example.com/x"), undefined);
  assert.match(reachable("http://api.example.com/x")!, /https/);
  assert.match(reachable("file:///etc/passwd")!, /https/);
  assert.match(reachable("not an address")!, /not an address/);
});

test("a skill may not be aimed at this machine or the network it sits on", () => {
  for (const where of [
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://0.0.0.0/x",
    "https://10.1.2.3/x",
    "https://192.168.0.5/x",
    "https://172.16.4.4/x",
    "https://169.254.169.254/latest/meta-data",
    "https://printer.local/x",
    "https://metadata.google.internal/x",
    "https://[::1]/x",
  ]) {
    assert.match(reachable(where)!, /this machine or its network/, `${where} was let through`);
  }
});

test("an address may not smuggle a name and password", () => {
  assert.match(reachable("https://user:secret@api.example.com/x")!, /name and password/);
});

test("a name must be a name, and not one that is taken", () => {
  assert.match(faults(draft({ name: "Weather Now" })).join(), /lower case/);
  assert.match(faults(draft({ name: "x" })).join(), /lower case/);
  assert.match(faults(draft({ name: "remember" })).join(), /already the name/);
  assert.match(faults(draft({ name: "mine" }), ["mine"]).join(), /already the name/);
});

test("a skill that does not say what it does cannot be chosen by anything", () => {
  assert.match(faults(draft({ about: "weather" })).join(), /say what it does/);
});

test("a credential may not be written into a header", () => {
  assert.match(
    faults(draft({ headers: { Authorization: "Bearer sk-12345" } })).join(),
    /not a header a skill may set/,
  );
  assert.match(faults(draft({ headers: { Cookie: "session=abc" } })).join(), /not a header/);
});

test("the address and the parameters must agree", () => {
  assert.match(
    faults(draft({ url: "https://api.example.com/v1/weather/{town}" })).join(),
    /asks for town/,
  );
  assert.match(
    faults(draft({
      url: "https://api.example.com/v1/weather",
      parameters: [{ name: "city", in: "path", kind: "string", required: true, about: "x" }],
    })).join(),
    /never uses it/,
  );
  assert.match(
    faults(draft({
      parameters: [{ name: "city", in: "query", kind: "string", required: true, about: "x" }],
    })).join(),
    /not a path parameter/,
  );
});

test("a parameter cannot be given twice or given a strange name", () => {
  const twice = draft({
    url: "https://api.example.com/v1/weather/{city}",
    parameters: [
      { name: "city", in: "path", kind: "string", required: true, about: "x" },
      { name: "city", in: "query", kind: "string", required: false, about: "y" },
    ],
  });
  assert.match(faults(twice).join(), /given twice/);
  assert.match(
    faults(draft({
      url: "https://api.example.com/v1/weather",
      parameters: [{ name: "drop table", in: "query", kind: "string", required: false, about: "x" }],
    })).join(),
    /not a name a parameter may have/,
  );
});

test("proving who you are needs something to prove it with", () => {
  assert.match(
    faults(draft({ auth: { mode: "bearer", credential: "  " } })).join(),
    /which credential/,
  );
  assert.deepEqual(faults(draft({ auth: { mode: "bearer", credential: "weather" } })), []);
});

test("placeholders are found wherever they are", () => {
  assert.deepEqual(placeholders("https://a.example.com/{one}/x/{two}"), ["one", "two"]);
  assert.deepEqual(placeholders("https://a.example.com/none"), []);
});

test("a parameter may not decide where the request goes", () => {
  for (const url of [
    "https://{region}.example.com/v1/weather",
    "https://api.{host}/v1/weather",
    "https://{whole}",
  ]) {
    assert.equal(onlyInPath(url), false, `${url} lets a parameter choose the host`);
  }
  assert.equal(onlyInPath("https://api.example.com/v1/{city}/now"), true);
  assert.equal(onlyInPath("https://api.example.com/v1/weather"), true);
});

test("a draft whose host is a parameter is refused", () => {
  const wrong = faults(draft({
    url: "https://{region}.example.com/v1/weather",
    parameters: [{ name: "region", in: "path", kind: "string", required: true, about: "x" }],
  }));
  assert.match(wrong.join(), /never part of the address itself/);
});
