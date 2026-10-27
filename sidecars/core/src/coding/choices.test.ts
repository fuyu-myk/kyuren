import assert from "node:assert/strict";
import { test } from "node:test";
import type { Answer } from "#coding/asked.ts";
import { claudeChoice, claudeChoiceAnswer } from "#coding/choices.ts";

const NOW = Date.UTC(2026, 9, 22, 8, 0);

const QUESTIONS = [
  { question: "Which framework?", header: "Framework", options: [{ label: "React", description: "Components" }, { label: "Vue", description: "Progressive" }], multiSelect: false },
  { question: "Which checks should run?", header: "Checks", options: [{ label: "Lint", description: "" }, { label: "Test", description: "" }, { label: "Build", description: "" }], multiSelect: true },
];

function asked(questions: unknown, tool = "AskUserQuestion") {
  return { session_id: "s1", cwd: "/Users/someone/Code/kyuren", hook_event_name: "PreToolUse", tool_name: tool, tool_input: { questions } };
}

test("questions to choose among are brought whole, each with its options and whether more than one may be picked", () => {
  const ask = claudeChoice(asked(QUESTIONS), "c1", NOW, 115_000);
  assert.equal(ask?.kind, "choice");
  assert.deepEqual(ask?.kind === "choice" ? ask.questions : [], QUESTIONS);
  assert.deepEqual([ask?.project, ask?.until], ["kyuren", NOW + 115_000]);
  const plain = claudeChoice(asked([{ question: "Ready?", options: [{ label: "Yes" }, { label: "No" }] }]), "c2", NOW, 1);
  assert.deepEqual(plain?.kind === "choice" ? plain.questions[0] : null, {
    question: "Ready?",
    header: "",
    options: [{ label: "Yes", description: "" }, { label: "No", description: "" }],
    multiSelect: false,
  });
});

test("questions the island could not show whole, or could not answer by name, are left to Claude Code's own picker", () => {
  const one = QUESTIONS[0];
  const leftThere: Array<[unknown, string]> = [
    [[], "no questions"],
    [[one, one], "the same question twice, which an answer could not tell apart"],
    [[{ ...one, options: [{ label: "React" }, { label: "React" }] }], "the same option twice"],
    [[{ ...one, options: [{ label: "React" }] }], "one option, which is no choice"],
    [[{ ...one, question: "Which ‮framework?" }], "a direction override"],
    [[{ ...one, options: [{ label: "Re​act" }, { label: "Vue" }] }], "a zero-width space in a label"],
    [Array.from({ length: 5 }, (_, at) => ({ ...one, question: `Question ${at}?` })), "more than Claude Code asks at once"],
  ];
  for (const [questions, why] of leftThere) assert.equal(claudeChoice(asked(questions), "c", NOW, 1), undefined, why);
  assert.equal(claudeChoice(asked(QUESTIONS, "Bash"), "c", NOW, 1), undefined, "another tool");
});

test("what is picked goes back with the questions as they were asked, several labels joined by commas", () => {
  const ask = claudeChoice(asked(QUESTIONS), "c1", NOW, 1);
  assert.ok(ask);
  const said = JSON.parse(claudeChoiceAnswer(asked(QUESTIONS), ask, { decision: "allow", picked: { "Which framework?": ["Vue"], "Which checks should run?": ["Lint", "Test"] } }) ?? "null");
  assert.deepEqual(said, {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { questions: QUESTIONS, answers: { "Which framework?": "Vue", "Which checks should run?": "Lint, Test" } },
    },
  });
  assert.equal(claudeChoiceAnswer(asked(QUESTIONS), ask, { decision: "ask" }), "", "left to Claude Code, nothing is said");
});

test("a pick that does not fit what was asked is not given", () => {
  const ask = claudeChoice(asked(QUESTIONS), "c1", NOW, 1);
  assert.ok(ask);
  const both = { "Which framework?": ["Vue"], "Which checks should run?": ["Lint"] };
  const wrong: Array<[Answer, string]> = [
    [{ decision: "allow", picked: { "Which framework?": ["Vue"] } }, "a question left unanswered"],
    [{ decision: "allow", picked: { ...both, "Which framework?": ["Angular"] } }, "an option not offered"],
    [{ decision: "allow", picked: { ...both, "Which framework?": ["React", "Vue"] } }, "two picked where one may be"],
    [{ decision: "allow", picked: { ...both, "Which checks should run?": ["Lint", "Lint"] } }, "the same option twice"],
    [{ decision: "allow", picked: { ...both, "Which colour?": ["Red"] } }, "a question not asked"],
    [{ decision: "allow", picked: JSON.parse('{"__proto__": ["Vue"], "Which checks should run?": ["Lint"]}') }, "a question's text that is no question"],
    [{ decision: "allow" }, "nothing picked"],
    [{ decision: "deny" }, "turned down, which a choice is not"],
  ];
  for (const [answer, why] of wrong) assert.equal(claudeChoiceAnswer(asked(QUESTIONS), ask, answer), undefined, why);
});

test("questions carrying more than the island shows, a preview drawn beside an option or anything else, are for Claude Code's own picker", () => {
  const one = QUESTIONS[0];
  const previewed = { ...one, options: [{ label: "React", description: "", preview: "+--+\n|A |\n+--+" }, { label: "Vue", description: "" }] };
  assert.equal(claudeChoice(asked([previewed]), "c", NOW, 1), undefined, "a preview beside an option");
  assert.equal(claudeChoice(asked([{ ...one, layout: "grid" }]), "c", NOW, 1), undefined, "anything else on a question");
});

test("an answer typed in place of the options goes back as Claude Code's own Other gives it", () => {
  const ask = claudeChoice(asked(QUESTIONS), "c1", NOW, 1);
  assert.ok(ask);
  const said = (answer: Answer) => JSON.parse(claudeChoiceAnswer(asked(QUESTIONS), ask, answer) ?? "null")?.hookSpecificOutput?.updatedInput?.answers;
  assert.deepEqual(said({ decision: "allow", picked: { "Which checks should run?": ["Lint"] }, other: { "Which framework?": "  Svelte, with runes  ", "Which checks should run?": "a smoke test" } }), {
    "Which framework?": "Svelte, with runes",
    "Which checks should run?": "Lint, a smoke test",
  });
  const refused: Array<[Answer, string]> = [
    [{ decision: "allow", picked: { "Which framework?": ["Vue"], "Which checks should run?": ["Lint"] }, other: { "Which framework?": "Svelte" } }, "an option and Other where only one may be"],
    [{ decision: "allow", picked: { "Which checks should run?": ["Lint"] }, other: { "Which framework?": "   " } }, "Other left empty"],
    [{ decision: "allow", picked: { "Which checks should run?": ["Lint"] }, other: { "Which framework?": "Svelte\u0007" } }, "a control character"],
    [{ decision: "allow", picked: { "Which checks should run?": ["Lint"] }, other: { "Which framework?": "x".repeat(1_001) } }, "too long"],
    [{ decision: "allow", picked: { "Which framework?": ["Vue"], "Which checks should run?": ["Lint"] }, other: { "Which language?": "Rust" } }, "an answer to a question not asked"],
  ];
  for (const [answer, why] of refused) assert.equal(claudeChoiceAnswer(asked(QUESTIONS), ask, answer), undefined, why);
});
