import assert from "node:assert/strict";
import { test } from "node:test";
import { answered, opened } from "#session/thread.ts";
import { Sessions } from "#session/store.ts";

function held(): Sessions {
  return new Sessions(":memory:");
}

test("a turn in a pane starts a session and titles it after the asking", () => {
  const sessions = held();
  const { session, history } = opened(sessions, undefined, "knowledge", "what is a carnot cycle", "what is a carnot cycle");

  assert.ok(session);
  assert.equal(session.pane, "knowledge");
  assert.equal(session.title, "what is a carnot cycle");
  assert.deepEqual(history, [], "a new session has nothing said in it yet");
  assert.deepEqual(sessions.read(session.id).map((one) => one.text), ["what is a carnot cycle"]);
});

test("a turn belonging to nothing is not kept", () => {
  const sessions = held();
  const { session, history } = opened(sessions, undefined, undefined, "what time is it", "what time is it");

  assert.equal(session, undefined, "a spoken turn is over when it is over");
  assert.deepEqual(history, []);
  assert.deepEqual(sessions.list(), []);
});

test("resuming a session hands back everything said in it, and not the new prompt", () => {
  const sessions = held();
  const first = opened(sessions, undefined, "comms", "what does today hold", "what does today hold");
  answered(sessions, first, "nothing until three");

  const again = opened(sessions, first.session!.id, undefined, "and tomorrow", "and tomorrow");

  assert.equal(again.session!.id, first.session!.id, "it is the same conversation");
  assert.deepEqual(again.history, [
    { role: "user", text: "what does today hold" },
    { role: "assistant", text: "nothing until three" },
  ]);
});

test("a session Kyuren does not hold is refused rather than quietly replaced", () => {
  const sessions = held();
  assert.throws(
    () => opened(sessions, "nobody", "comms", "hello", "hello"),
    /not a session/,
    "answering into a session that does not exist would lose the conversation",
  );
  assert.deepEqual(sessions.list(), [], "and nothing is started in its place");
});

test("a resumed session is the most recent thing to have happened", () => {
  const sessions = held();
  const older = opened(sessions, undefined, "comms", "one", "one");
  answered(sessions, older, "first");
  const newer = opened(sessions, undefined, "knowledge", "two", "two");
  answered(sessions, newer, "second");

  assert.equal(sessions.list()[0]!.id, newer.session!.id);
  answered(sessions, opened(sessions, older.session!.id, undefined, "again", "again"), "third");
  assert.equal(sessions.list()[0]!.id, older.session!.id);
});

test("a turn knows whether its conversation has read the user's notes, and a turn that read them says so for the next", () => {
  const sessions = held();
  const first = opened(sessions, undefined, "knowledge", "what did I write", "what did I write");
  assert.equal(first.exposed, false);
  answered(sessions, first, "you wrote about the move", undefined, true);
  const next = opened(sessions, first.session?.id, undefined, "and then?", "and then?");
  assert.equal(next.exposed, true);
  assert.equal(opened(sessions, undefined, undefined, "what time is it", "what time is it").exposed, false);
});
