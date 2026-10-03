import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY, KEPT, said, type Thread } from "./thread.ts";

function shape(t: Thread): Array<[string, string, boolean]> {
  return t.bubbles.map((one) => [one.who, one.text, one.live]);
}

function last(t: Thread) {
  return t.bubbles[t.bubbles.length - 1]!;
}

test("a typed message is your bubble, with an answer waited for beneath it", () => {
  const t = said(EMPTY, { type: "typed", text: "hello" });
  assert.deepEqual(shape(t), [["you", "hello", false], ["kyuren", "", true]]);
});

test("the answer streams into its bubble, and the last word replaces the stream", () => {
  let t = said(EMPTY, { type: "typed", text: "hi" });
  t = said(said(t, { type: "chunk", text: "Hel" }), { type: "chunk", text: "lo" });
  assert.deepEqual([last(t).text, last(t).live], ["Hello", true]);
  t = said(t, { type: "replied", text: "Hello there.", asked: "typed", session: "s1" });
  assert.deepEqual([last(t).text, last(t).live], ["Hello there.", false]);
  assert.equal(t.session, "s1");
});

test("words show as they are heard, and become a message when the sentence ends", () => {
  let t = said(EMPTY, { type: "heard", text: "what is", final: false });
  t = said(t, { type: "heard", text: "what is the time", final: false });
  assert.deepEqual(shape(t), [["you", "what is the time", true]]);
  t = said(t, { type: "heard", text: "what is the time", final: true });
  assert.deepEqual(shape(t), [["you", "what is the time", false], ["kyuren", "", true]]);
});

test("a stream that is not this island's is not shown", () => {
  assert.equal(said(EMPTY, { type: "chunk", text: "stray" }).bubbles.length, 0);
  const done = said(said(said(EMPTY, { type: "typed", text: "a" }), { type: "replied", text: "ok", asked: "typed" }), { type: "chunk", text: "late" });
  assert.equal(last(done).text, "ok");
});

test("a turn that failed says so in place of its answer", () => {
  const t = said(said(EMPTY, { type: "typed", text: "x" }), { type: "failed", reason: "the model is offline", asked: "typed" });
  assert.deepEqual([last(t).text, last(t).live, last(t).failed], ["the model is offline", false, true]);
});

test("a sound heard while an answer is coming does not lose the answer", () => {
  let t = said(EMPTY, { type: "heard", text: "what is the time", final: true });
  t = said(t, { type: "heard", text: "uh", final: false });
  t = said(t, { type: "chunk", text: "It is " });
  t = said(t, { type: "replied", text: "It is noon.", asked: "spoken" });
  assert.deepEqual(shape(t), [["you", "what is the time", false], ["kyuren", "It is noon.", false], ["you", "uh", true]]);
});

test("a spoken turn left unanswered gives way to the next sentence", () => {
  let t = said(EMPTY, { type: "heard", text: "one", final: true });
  t = said(said(t, { type: "heard", text: "two", final: false }), { type: "heard", text: "two", final: true });
  assert.deepEqual(shape(t), [["you", "one", false], ["you", "two", false], ["kyuren", "", true]]);
  let streamed = said(said(EMPTY, { type: "heard", text: "one", final: true }), { type: "chunk", text: "partly" });
  streamed = said(said(streamed, { type: "heard", text: "two", final: false }), { type: "chunk", text: " more" });
  streamed = said(streamed, { type: "heard", text: "two", final: true });
  assert.deepEqual(shape(streamed), [["you", "one", false], ["kyuren", "partly more", false], ["you", "two", false], ["kyuren", "", true]], "what did come back is kept");
});

test("an answer finds the bubble of the question it answers", () => {
  let t = said(EMPTY, { type: "typed", text: "typed first" });
  t = said(t, { type: "heard", text: "then spoken", final: true });
  t = said(t, { type: "failed", reason: "stopped", asked: "typed" });
  t = said(t, { type: "replied", text: "the spoken answer", asked: "spoken" });
  assert.deepEqual(shape(t), [["you", "typed first", false], ["you", "then spoken", false], ["kyuren", "the spoken answer", false]]);
  const late = said(t, { type: "replied", text: "typed answer, late", asked: "typed", session: "s2" });
  assert.equal(late.session, "s2", "the conversation it began is still carried on");
  assert.deepEqual(shape(late), shape(t));
});

test("clearing starts the conversation over, session and all", () => {
  let t = said(said(EMPTY, { type: "typed", text: "a" }), { type: "replied", text: "b", asked: "typed", session: "s" });
  t = said(t, { type: "cleared" });
  assert.deepEqual(t.bubbles, []);
  assert.equal(t.session, undefined);
});

test("only the most recent messages are kept", () => {
  let t = EMPTY;
  for (let at = 0; at < KEPT; at += 1) t = said(said(t, { type: "typed", text: `q${at}` }), { type: "replied", text: `a${at}`, asked: "typed" });
  assert.equal(t.bubbles.length, KEPT);
  assert.equal(last(t).text, `a${KEPT - 1}`);
  assert.ok(new Set(t.bubbles.map((one) => one.id)).size === KEPT, "every bubble keeps its own key");
});
