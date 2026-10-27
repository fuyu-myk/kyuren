import assert from "node:assert/strict";
import { test } from "node:test";
import { answeredFor, boundsOf, chose, contentFor, nextOpen, pickedFor, pickedOf, pressed, secondsLeft, summaryOf, waitingBesides, type AgentAsk, type Chosen, type Field, type Question } from "./asks.ts";

const ask: AgentAsk = { id: "a", harness: "claude", session: "s1", project: "kyuren", tool: "Bash", kind: "permission", verb: "run", target: "make", at: 0, until: 45_000 };

test("a question counts down to when Claude Code asks it itself", () => {
  assert.equal(secondsLeft(ask, 0), 45);
  assert.equal(secondsLeft(ask, 44_001), 1);
  assert.equal(secondsLeft(ask, 46_000), 0);
});

test("a session waiting because its question is on the island is not counted twice", () => {
  const sessions = [
    { id: "s1", state: "waiting" as const },
    { id: "s2", state: "waiting" as const },
    { id: "s3", state: "working" as const },
  ];
  assert.equal(waitingBesides(sessions, [ask]), 1);
  assert.equal(waitingBesides(sessions, []), 2);
});

const FRAMEWORK: Question = { question: "Which framework?", header: "Framework", options: [{ label: "React", description: "" }, { label: "Vue", description: "" }], multiSelect: false };
const CHECKS: Question = { question: "Which checks?", header: "Checks", options: [{ label: "Lint", description: "" }, { label: "Test", description: "" }], multiSelect: true };

test("pressing an option picks it, in place of the last where one may be, and beside it where several may", () => {
  let chosen = chose({}, FRAMEWORK, "React");
  chosen = chose(chosen, FRAMEWORK, "Vue");
  assert.deepEqual(chosen, { "Which framework?": ["Vue"] });
  chosen = chose(chose(chosen, CHECKS, "Lint"), CHECKS, "Test");
  assert.deepEqual(chosen["Which checks?"], ["Lint", "Test"]);
  assert.deepEqual(chose(chosen, CHECKS, "Lint")["Which checks?"], ["Test"], "pressed again, taken away");
});

test("an answer is ready only once every question has its pick, and only what was offered is given", () => {
  assert.equal(pickedFor([FRAMEWORK, CHECKS], { "Which framework?": ["Vue"] }), undefined, "one still unanswered");
  assert.equal(pickedFor([CHECKS], { "Which checks?": [] }), undefined, "nothing picked");
  assert.deepEqual(pickedFor([FRAMEWORK, CHECKS], { "Which framework?": ["Vue"], "Which checks?": ["Lint", "Test"] }), {
    "Which framework?": ["Vue"],
    "Which checks?": ["Lint", "Test"],
  });
  assert.equal(pickedFor([FRAMEWORK], { "Which framework?": ["Angular"] }), undefined);
});

const FIELDS: Field[] = [
  { name: "title", title: "Title", about: "", type: "string", choices: [], required: true },
  { name: "board", title: "Board", about: "", type: "string", choices: ["Inbox", "Sprint"], required: true },
  { name: "points", title: "Points", about: "", type: "integer", choices: [], required: false },
  { name: "urgent", title: "Urgent", about: "", type: "boolean", choices: [], required: false },
];

test("a form's typed values are read as the server asked for them, and what is empty and optional is left out", () => {
  assert.deepEqual(contentFor(FIELDS, { title: "  The build is slow ", board: "Sprint", points: "3", urgent: true }), {
    content: { title: "The build is slow", board: "Sprint", points: 3, urgent: true },
  });
  assert.deepEqual(contentFor(FIELDS, { title: "Slow", board: "Inbox", points: "" }), { content: { title: "Slow", board: "Inbox" } });
});

test("a form not filled as it asks says what is missing and what does not read right", () => {
  assert.deepEqual(contentFor(FIELDS, { board: "Sprint", points: "2.5" }), { missing: ["Title"], wrong: ["Points"] });
  assert.deepEqual(contentFor(FIELDS, { title: "x", board: "Backlog" }), { missing: [], wrong: ["Board"] });
});

test("each kind of question says in a line what it wants", () => {
  const base = { id: "b", harness: "claude", session: "s", project: "kyuren", tool: "x", at: 0, until: 1 };
  assert.deepEqual(summaryOf(ask), { wants: "wants to run", about: "make" });
  assert.deepEqual(summaryOf({ ...base, kind: "choice", questions: [FRAMEWORK, CHECKS] }), { wants: "asks you 2 questions", about: "Framework, Checks" });
  assert.deepEqual(summaryOf({ ...base, kind: "plan", plan: "\n## Refactor the parser\n1. Extract" }), { wants: "has a plan for you to approve", about: "Refactor the parser" });
  assert.deepEqual(summaryOf({ ...base, kind: "edit", path: "src/a.ts", fresh: false, whole: false, every: false, diff: [], added: 2, removed: 1 }).wants, "wants to edit");
  assert.equal(summaryOf({ ...base, kind: "form", server: "tickets", message: "Which board?", fields: FIELDS }).wants, "asks for a form from tickets");
});

test("a question named like something every object has is still only what was picked for it", () => {
  const named: Question = { question: "constructor", header: "", options: [{ label: "A", description: "" }, { label: "B", description: "" }], multiSelect: false };
  assert.deepEqual(pickedOf({}, named), []);
  assert.deepEqual(pickedOf(chose({}, named, "B"), named), ["B"]);
  assert.deepEqual(pickedFor([named], chose({}, named, "A")), { constructor: ["A"] });
});

test("a form's bounds are said in a few words, and values outside them do not read right", () => {
  const stars: Field = { name: "stars", title: "Stars", about: "", type: "integer", choices: [], required: true, least: 1, most: 5 };
  const nick: Field = { name: "nick", title: "Nick", about: "", type: "string", choices: [], required: false, least: 2, most: 8 };
  assert.equal(boundsOf(stars), "1 to 5");
  assert.equal(boundsOf(nick), "2 to 8 characters");
  assert.equal(boundsOf({ ...nick, least: undefined }), "at most 8 characters");
  assert.equal(boundsOf({ ...stars, most: undefined }), "at least 1");
  assert.equal(boundsOf(FIELDS[0] as Field), "");
  assert.deepEqual(contentFor([stars, nick], { stars: "9", nick: "x" }), { missing: [], wrong: ["Stars", "Nick"] });
  assert.deepEqual(contentFor([stars, nick], { stars: "5", nick: "山田　太郎" }), { content: { stars: 5, nick: "山田　太郎" } }, "a wide space typed in a name is the user's to send");
});

test("words a server could not be sent do not read right: too long, or holding a control character", () => {
  const note: Field = { name: "note", title: "Note", about: "", type: "string", choices: [], required: true };
  assert.deepEqual(contentFor([note], { note: "x".repeat(2_001) }), { missing: [], wrong: ["Note"] });
  assert.deepEqual(contentFor([note], { note: "a\u0007b" }), { missing: [], wrong: ["Note"] });
});

test("questions asked together are gone through in turn: the next still without its pick, coming round to the start", () => {
  const third: Question = { ...FRAMEWORK, question: "Which store?" };
  const all = [FRAMEWORK, CHECKS, third];
  const only = (picked: Record<string, string[]>): Chosen => ({ picked, typed: {} });
  assert.equal(nextOpen(all, only({}), 0), 1);
  assert.equal(nextOpen(all, only(chose({}, CHECKS, "Lint")), 0), 2, "an answered one is passed over");
  assert.equal(nextOpen(all, only(chose(chose({}, CHECKS, "Lint"), third, "React")), 2), 0, "round to the start");
  assert.equal(nextOpen(all, only(chose(chose({}, CHECKS, "Lint"), third, "React")), 0), undefined, "only the one in hand is left");
  assert.equal(nextOpen([FRAMEWORK, CHECKS], { picked: {}, typed: { "Which framework?": "Svelte" } }, 1), undefined, "one answered by what was typed");
});

test("Other takes an answer typed in place of the options: alone where one may be picked, beside them where several may", () => {
  const none: Chosen = { picked: {}, typed: {} };
  let one = pressed(pressed(none, FRAMEWORK, "React"), FRAMEWORK, undefined);
  assert.deepEqual(one, { picked: { "Which framework?": [] }, typed: { "Which framework?": "" } }, "Other in the option's place");
  assert.equal(answeredFor([FRAMEWORK], one), undefined, "nothing typed yet");
  one = { ...one, typed: { "Which framework?": "  Svelte " } };
  assert.deepEqual(answeredFor([FRAMEWORK], one), { picked: {}, other: { "Which framework?": "Svelte" } });
  assert.deepEqual(pressed(one, FRAMEWORK, "Vue"), { picked: { "Which framework?": ["Vue"] }, typed: {} }, "an option takes Other's place again");
  let several = pressed(pressed(none, CHECKS, "Lint"), CHECKS, undefined);
  several = { ...several, typed: { "Which checks?": "a smoke test" } };
  assert.deepEqual(answeredFor([CHECKS], several), { picked: { "Which checks?": ["Lint"] }, other: { "Which checks?": "a smoke test" } });
  assert.deepEqual(pressed(several, CHECKS, undefined).typed, {}, "pressed again, Other is taken away");
  assert.equal(answeredFor([CHECKS], { picked: {}, typed: { "Which checks?": "x".repeat(1_001) } }), undefined, "longer than Claude Code takes");
});
