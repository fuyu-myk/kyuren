import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Sessions } from "#session/store.ts";

function held(): Sessions {
  return new Sessions(":memory:");
}

test("a session that has been started can be found again", () => {
  const sessions = held();
  const one = sessions.start("knowledge", "what did I write about thermodynamics");

  const found = sessions.find(one.id)!;
  assert.equal(found.id, one.id);
  assert.equal(found.pane, "knowledge");
  assert.equal(found.turns, 0);
  assert.equal(sessions.find("nobody"), undefined);
});

test("turns come back in the order they were said", () => {
  const sessions = held();
  const one = sessions.start("comms", "today");
  sessions.remember(one.id, "user", "what does today hold", 10);
  sessions.remember(one.id, "assistant", "nothing until three", 20);
  sessions.remember(one.id, "user", "and tomorrow", 30);

  assert.deepEqual(
    sessions.read(one.id).map((turn) => `${turn.role}: ${turn.text}`),
    ["user: what does today hold", "assistant: nothing until three", "user: and tomorrow"],
  );
  assert.equal(sessions.find(one.id)!.turns, 3);
});

test("every pane's sessions are listed together, most recent first", () => {
  const sessions = held();
  const first = sessions.start("comms", "one", 100);
  const second = sessions.start("knowledge", "two", 200);
  const third = sessions.start("development", "three", 300);

  assert.deepEqual(sessions.list().map((one) => one.id), [third.id, second.id, first.id]);

  // Saying something in the oldest session makes it the most recent thing that happened.
  sessions.remember(first.id, "user", "still here", 400);
  assert.deepEqual(sessions.list().map((one) => one.id), [first.id, third.id, second.id]);
});

test("a pane sees only its own sessions", () => {
  const sessions = held();
  sessions.start("comms", "mail", 100);
  sessions.start("development", "the graph", 200);
  sessions.start("comms", "calendar", 300);

  assert.deepEqual(sessions.inPane("development").map((one) => one.title), ["the graph"]);
  assert.deepEqual(sessions.inPane("comms").map((one) => one.title), ["calendar", "mail"]);
  assert.deepEqual(sessions.inPane("knowledge"), []);
});

test("a list can be asked for fewer than it holds", () => {
  const sessions = held();
  for (let at = 0; at < 10; at += 1) sessions.start("comms", `one ${at}`, at);
  assert.equal(sessions.list(3).length, 3);
  assert.equal(sessions.list(3)[0]!.title, "one 9");
});

test("sessions outlive the process that made them", () => {
  const where = mkdtempSync(join(tmpdir(), "kyuren-sessions-"));
  const path = join(where, "deep", "sessions.db");

  try {
    const before = new Sessions(path);
    const one = before.start("knowledge", "a long conversation", 100);
    before.remember(one.id, "user", "remember this", 200);
    before.remember(one.id, "assistant", "remembered", 300);
    before.close();

    const after = new Sessions(path);
    const found = after.find(one.id)!;
    assert.equal(found.title, "a long conversation");
    assert.equal(found.turns, 2);
    assert.deepEqual(after.read(one.id).map((turn) => turn.text), ["remember this", "remembered"]);
    after.close();
  } finally {
    rmSync(where, { recursive: true, force: true });
  }
});

test("a session let go of takes its turns with it", () => {
  const sessions = held();
  const one = sessions.start("comms", "passing thought");
  sessions.remember(one.id, "user", "never mind");

  sessions.forget(one.id);
  assert.equal(sessions.find(one.id), undefined);
  assert.deepEqual(sessions.read(one.id), []);
  assert.deepEqual(sessions.list(), []);
});

test("a session can be renamed once what it is about is known", () => {
  const sessions = held();
  const one = sessions.start("knowledge", "untitled");
  sessions.rename(one.id, "thermodynamics revision");
  assert.equal(sessions.find(one.id)!.title, "thermodynamics revision");
});

test("a long first line does not become a long title", () => {
  const sessions = held();
  const one = sessions.start("comms", "a".repeat(400));
  assert.ok(sessions.find(one.id)!.title.length < 100);
});

test("an answer remembers what answered it and how much it read", () => {
  const sessions = held();
  const one = sessions.start("comms", "how far is the moon");
  sessions.remember(one.id, "user", "how far is the moon", 10);
  sessions.remember(one.id, "assistant", "about 384,000 km", 20, {
    model: "qwen3.5:2b",
    route: "local-small",
    usage: { input: 2041, output: 54 },
  });

  const [asked, answer] = sessions.read(one.id);
  assert.equal(asked!.by, undefined);
  assert.deepEqual(answer!.by, {
    model: "qwen3.5:2b",
    route: "local-small",
    usage: { input: 2041, output: 54 },
  });
});

test("a session keeps the route chosen for it until the choice is cleared", () => {
  const sessions = held();
  const one = sessions.start("comms", "a question");
  assert.equal(sessions.find(one.id)!.preferred, undefined);

  sessions.prefer(one.id, "cloud");
  assert.equal(sessions.find(one.id)!.preferred, "cloud");
  assert.equal(sessions.list()[0]!.preferred, "cloud");

  sessions.prefer(one.id, undefined);
  assert.equal(sessions.find(one.id)!.preferred, undefined);
});

test("a store made before answers were remembered opens, and grows", () => {
  const dir = mkdtempSync(join(tmpdir(), "kyuren-sessions-"));
  const path = join(dir, "sessions.db");
  const before = new DatabaseSync(path);
  before.exec(`
    create table sessions (
      id text primary key, pane text not null, title text not null,
      started integer not null, touched integer not null, seq integer not null
    );
    create table turns (
      session text not null references sessions(id) on delete cascade, ord integer not null,
      role text not null, text text not null, at integer not null, primary key (session, ord)
    );
    insert into sessions values ('kept', 'comms', 'from before', 1, 2, 1);
    insert into turns values ('kept', 0, 'user', 'hello', 1);
    insert into turns values ('kept', 1, 'assistant', 'hello yourself', 2);
  `);
  before.close();

  const sessions = new Sessions(path);
  try {
    assert.equal(sessions.find("kept")!.preferred, undefined);
    assert.deepEqual(sessions.read("kept").map((turn) => turn.by), [undefined, undefined]);
    sessions.remember("kept", "assistant", "and again", 3, { model: "qwen3.5:2b", route: "local-small" });
    assert.equal(sessions.read("kept")[2]!.by?.model, "qwen3.5:2b");
    assert.equal(sessions.read("kept")[2]!.by?.usage, undefined);
  } finally {
    sessions.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a conversation that has read the user's notes is still one that has, opened again", () => {
  const folder = mkdtempSync(join(tmpdir(), "kyuren-sessions-"));
  try {
    const path = join(folder, "sessions.db");
    const sessions = new Sessions(path);
    const one = sessions.start("knowledge", "what did I write");
    assert.equal(sessions.find(one.id)?.exposed, undefined);
    sessions.expose(one.id);
    sessions.close();
    assert.equal(new Sessions(path).find(one.id)?.exposed, true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a conversation from before the mark was kept is taken to hold the user's notes if it ever answered", () => {
  const dir = mkdtempSync(join(tmpdir(), "kyuren-sessions-"));
  const path = join(dir, "sessions.db");
  const before = new DatabaseSync(path);
  before.exec(`
    create table sessions (
      id text primary key, pane text not null, title text not null,
      started integer not null, touched integer not null, seq integer not null, preferred text
    );
    create table turns (
      session text not null references sessions(id) on delete cascade, ord integer not null,
      role text not null, text text not null, at integer not null, model text, route text,
      input integer, output integer, primary key (session, ord)
    );
    insert into sessions values ('answered', 'knowledge', 'about the move', 1, 2, 1, null);
    insert into sessions values ('unanswered', 'knowledge', 'never answered', 1, 2, 2, null);
    insert into turns values ('answered', 0, 'user', 'what did I write', 1, null, null, null, null);
    insert into turns values ('answered', 1, 'assistant', 'you wrote about the move', 2, null, null, null, null);
    insert into turns values ('unanswered', 0, 'user', 'hello', 1, null, null, null, null);
  `);
  before.close();
  const sessions = new Sessions(path);
  try {
    assert.equal(sessions.find("answered")?.exposed, true);
    assert.equal(sessions.find("unanswered")?.exposed, undefined);
  } finally {
    sessions.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a column added to an older store is added with what it says, or not at all", () => {
  const dir = mkdtempSync(join(tmpdir(), "kyuren-sessions-"));
  const path = join(dir, "sessions.db");
  const sessions = new Sessions(path);
  sessions.close();
  const after = new DatabaseSync(path);
  try {
    const columns = after.prepare("pragma table_info(sessions)").all() as Array<{ name: string }>;
    assert.ok(columns.some((one) => one.name === "exposed"));
  } finally {
    after.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
