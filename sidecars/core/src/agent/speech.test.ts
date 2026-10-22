import assert from "node:assert/strict";
import { test } from "node:test";
import { Speech } from "#agent/speech.ts";

function speaking(): { speech: Speech; said: string[] } {
  const said: string[] = [];
  return { speech: new Speech((text) => said.push(text)), said };
}

test("a reply is said a sentence at a time as it arrives, not once it is whole", () => {
  const { speech, said } = speaking();
  for (const chunk of ["Your first meeting is ", "at nine with the design team.", " The after", "noon is completely free."]) speech.heard(chunk);
  assert.deepEqual(said, ["Your first meeting is at nine with the design team.", "The afternoon is completely free."]);
  speech.done();
  assert.equal(said.length, 2, "nothing is left over to say");
});

test("a fragment too short to be worth saying alone waits for the next, and the end says what is left", () => {
  const { speech, said } = speaking();
  speech.heard("Yes. ");
  assert.deepEqual(said, []);
  speech.heard("Your afternoon is completely clear.");
  assert.deepEqual(said, ["Yes. Your afternoon is completely clear."]);
  speech.heard(" Enjoy it");
  speech.done();
  assert.deepEqual(said, ["Yes. Your afternoon is completely clear.", "Enjoy it"]);
});

test("a tool's own words are said as soon as they come, after what the model had begun, and its retelling is not", () => {
  const { speech, said } = speaking();
  speech.heard("Let me check.");
  speech.spoken("Today is Tuesday 15 September. Nothing is on your calendar today.");
  speech.heard("You have nothing on today, so the day is yours.");
  speech.done();
  assert.deepEqual(said, ["Let me check.", "Today is Tuesday 15 September. Nothing is on your calendar today."]);
});

test("nothing is said for an empty reply", () => {
  const { speech, said } = speaking();
  speech.heard("   ");
  speech.done();
  speech.spoken("  ");
  assert.deepEqual(said, []);
});
