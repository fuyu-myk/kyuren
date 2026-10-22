import assert from "node:assert/strict";
import { test } from "node:test";
import { Speech } from "#agent/speech.ts";

function speaking(): { speech: Speech; said: string[] } {
  const said: string[] = [];
  return { speech: new Speech((text) => said.push(text), () => said.push("<end>")), said };
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

test("once the model moves on from a tool that has spoken, the reply is over, and a later tool's words begin anew", () => {
  const { speech, said } = speaking();
  speech.moved();
  speech.spoken("Today is Tuesday 15 September. Nothing is on your calendar today.");
  speech.moved();
  speech.heard("You have nothing on today, so the day is yours.");
  speech.moved();
  speech.spoken("The thesis was last touched in June, on the methods chapter.");
  speech.moved();
  assert.deepEqual(said, [
    "Today is Tuesday 15 September. Nothing is on your calendar today.",
    "<end>",
    "The thesis was last touched in June, on the methods chapter.",
    "<end>",
  ]);
});

test("a code block or a link is said whole rather than split where a sentence would end inside it", () => {
  const { speech, said } = speaking();
  speech.heard("Here is the function you asked for.\n```python\ndef add(a, b):\n    return a + b\n```\nIt adds two numbers together.");
  speech.heard(" You can read more at [the project page](https://example.com/docs/intro.html). It explains the setup.");
  speech.done();
  assert.deepEqual(said, [
    "Here is the function you asked for.",
    "```python\ndef add(a, b):\n    return a + b\n```",
    "It adds two numbers together.",
    "You can read more at [the project page](https://example.com/docs/intro.html).",
    "It explains the setup.",
  ]);
});

test("the opening of a reply is said at its first pause, and the rest a sentence at a time", () => {
  const { speech, said } = speaking();
  speech.heard("Photosynthesis is the process by which plants, algae, and some bacteria turn light into chemical energy.");
  speech.heard(" It happens in the chloroplasts, mostly in the leaves.");
  speech.done();
  assert.deepEqual(said, [
    "Photosynthesis is the process by which plants,",
    "algae, and some bacteria turn light into chemical energy.",
    "It happens in the chloroplasts, mostly in the leaves.",
  ]);
});

test("a comma or colon inside a number or a time is no pause", () => {
  const { speech, said } = speaking();
  speech.heard("The city has a population of about 1,000,000 people and the ferry leaves at 10:30 every day.");
  speech.done();
  assert.deepEqual(said, ["The city has a population of about 1,000,000 people and the ferry leaves at 10:30 every day."]);
});

test("a tool beginning ends what was said before it, and what the model says after it begins anew", () => {
  const { speech, said } = speaking();
  speech.heard("Let me look that up for you");
  speech.working();
  speech.working();
  speech.heard("The page says the library opens at nine, and closes at six on weekdays.");
  speech.done();
  assert.deepEqual(said, [
    "Let me look that up for you",
    "<end>",
    "The page says the library opens at nine,",
    "and closes at six on weekdays.",
  ]);
});
