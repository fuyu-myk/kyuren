import assert from "node:assert/strict";
import { test } from "node:test";
import type { Answer } from "#coding/asked.ts";
import { claudeForm, claudeFormAnswer, FIELDS } from "#coding/forms.ts";

const NOW = Date.UTC(2026, 9, 22, 8, 0);

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", title: "Title", description: "What the ticket is about" },
    board: { type: "string", title: "Board", enum: ["Inbox", "Sprint"] },
    points: { type: "integer", title: "Points" },
    urgent: { type: "boolean", title: "Urgent" },
  },
  required: ["title", "board"],
};

function form(schema: unknown = SCHEMA, extra: Record<string, unknown> = {}) {
  return {
    session_id: "s1",
    cwd: "/Users/someone/Code/kyuren",
    hook_event_name: "Elicitation",
    mcp_server_name: "tickets",
    message: "Tell me about the ticket.",
    mode: "form",
    requested_schema: schema,
    ...extra,
  };
}

test("a form from a server is brought with its fields, what each is and whether it must be filled", () => {
  const ask = claudeForm(form(), "f1", NOW, 115_000);
  assert.deepEqual(ask?.kind === "form" ? [ask.server, ask.message, ask.until] : [], ["tickets", "Tell me about the ticket.", NOW + 115_000]);
  assert.deepEqual(ask?.kind === "form" ? ask.fields : [], [
    { name: "title", title: "Title", about: "What the ticket is about", type: "string", choices: [], required: true },
    { name: "board", title: "Board", about: "", type: "string", choices: ["Inbox", "Sprint"], required: true },
    { name: "points", title: "Points", about: "", type: "integer", choices: [], required: false },
    { name: "urgent", title: "Urgent", about: "", type: "boolean", choices: [], required: false },
  ]);
});

test("a form asking for a secret, a page to open, or more than plain fields is left to Claude Code's own dialog", () => {
  const field = (name: string, property: Record<string, unknown>) => form({ type: "object", properties: { [name]: property } });
  const leftThere: Array<[unknown, string]> = [
    [form(SCHEMA, { mode: "url", url: "https://auth.example.com" }), "a page to open in the browser"],
    [field("password", { type: "string" }), "a password"],
    [field("key", { type: "string", title: "API key" }), "a key, by its title"],
    [field("code", { type: "string", description: "The one-time PIN sent to you" }), "a PIN, by what it says"],
    [field("word", { type: "string", format: "password" }), "a field marked as a password"],
    [field("tags", { type: "array" }), "a list, which is not a plain field"],
    [form({ type: "object", properties: Object.fromEntries(Array.from({ length: FIELDS + 1 }, (_, at) => [`f${at}`, { type: "string" }])) }), "too many fields"],
    [form({ type: "object", properties: {} }), "no fields"],
    [form(SCHEMA, { message: "Tell me ‮about it" }), "a direction override"],
  ];
  for (const [payload, why] of leftThere) assert.equal(claudeForm(payload, "f", NOW, 1), undefined, why);
});

test("a form's values go back as the server asked for them, and a declined form says so", () => {
  const ask = claudeForm(form(), "f1", NOW, 1);
  assert.ok(ask);
  const content = { title: "The build is slow", board: "Sprint", points: 3, urgent: true };
  assert.deepEqual(JSON.parse(claudeFormAnswer(ask, { decision: "allow", content }) ?? "null"), {
    hookSpecificOutput: { hookEventName: "Elicitation", action: "accept", content },
  });
  assert.deepEqual(JSON.parse(claudeFormAnswer(ask, { decision: "deny" }) ?? "null"), { hookSpecificOutput: { hookEventName: "Elicitation", action: "decline" } });
  assert.equal(claudeFormAnswer(ask, { decision: "ask" }), "");
});

test("values that do not fit the form are not given", () => {
  const ask = claudeForm(form(), "f1", NOW, 1);
  assert.ok(ask);
  const fine = { title: "The build is slow", board: "Sprint" };
  const wrong: Array<[Answer, string]> = [
    [{ decision: "allow", content: { board: "Sprint" } }, "a field that must be filled, left empty"],
    [{ decision: "allow", content: { ...fine, board: "Backlog" } }, "a choice not offered"],
    [{ decision: "allow", content: { ...fine, points: 2.5 } }, "a fraction for a whole number"],
    [{ decision: "allow", content: { ...fine, urgent: "yes" } }, "words for a yes or no"],
    [{ decision: "allow", content: { ...fine, owner: "me" } }, "a field the form does not have"],
    [{ decision: "allow", content: { ...fine, title: "x".repeat(2_001) } }, "too long"],
    [{ decision: "allow", content: { ...fine, title: "one\nline" } }, "a second line hidden in a line"],
    [{ decision: "allow" }, "no values at all"],
  ];
  for (const [answer, why] of wrong) assert.equal(claudeFormAnswer(ask, answer), undefined, why);
});

test("a field asking for a secret is found however its name is written, and so is a form whose message asks for one", () => {
  const field = (name: string, property: Record<string, unknown> = { type: "string" }) => form({ type: "object", properties: { [name]: property } });
  const secrets = ["user_pin", "pinCode", "securityPin", "otp_code", "totp", "mfa_code", "pwd", "API-KEY", "apiKey", "password1", "Ｐａｓｓｗｏｒｄ", "recovery_phrase", "cardNumber", "ssn"];
  for (const name of secrets) assert.equal(claudeForm(field(name), "f", NOW, 1), undefined, name);
  assert.equal(claudeForm(form(SCHEMA, { message: "Enter your password to go on." }), "f", NOW, 1), undefined, "asked for in the message");
  assert.ok(claudeForm(field("compass_heading"), "f", NOW, 1), "a word that only holds one");
});

test("a field with a rule the island does not check is left to Claude Code's own dialog, and the bounds it does check are kept", () => {
  const field = (property: Record<string, unknown>) => form({ type: "object", properties: { value: property } });
  const leftThere: Array<[Record<string, unknown>, string]> = [
    [{ type: "string", format: "email" }, "a format"],
    [{ type: "string", enum: ["a", "b"], enumNames: ["A", "B"] }, "names shown in place of the values"],
    [{ type: "integer", enum: ["1", "2"] }, "choices for a number"],
    [{ type: "string", pattern: "^[a-z]+$" }, "a pattern"],
  ];
  for (const [property, why] of leftThere) assert.equal(claudeForm(field(property), "f", NOW, 1), undefined, why);
  const bounded = claudeForm(form({ type: "object", properties: { stars: { type: "integer", minimum: 1, maximum: 5, default: 3 }, nick: { type: "string", minLength: 2, maxLength: 8 } } }), "f", NOW, 1);
  assert.deepEqual(bounded?.kind === "form" ? bounded.fields.map((one) => [one.name, one.least, one.most]) : [], [["stars", 1, 5], ["nick", 2, 8]]);
});

test("values are held to a field's bounds, and anything the user can type is theirs to send but a control character", () => {
  const ask = claudeForm(form({ type: "object", properties: { stars: { type: "integer", minimum: 1, maximum: 5 }, name: { type: "string", minLength: 2, maxLength: 8 } } }), "f", NOW, 1);
  assert.ok(ask);
  const sent = (content: Record<string, string | number | boolean>) => claudeFormAnswer(ask, { decision: "allow", content }) !== undefined;
  assert.ok(sent({ stars: 5, name: "山田　太郎" }), "a wide space typed in a name");
  assert.ok(sent({ name: "\u{1F469}\u200D\u{1F4BB} dev" }), "an emoji joined with a zero-width joiner");
  assert.equal(sent({ stars: 9 }), false, "above the most");
  assert.equal(sent({ stars: 0 }), false, "below the least");
  assert.equal(sent({ name: "x" }), false, "shorter than the least");
  assert.equal(sent({ name: "x".repeat(9) }), false, "longer than the most");
  assert.equal(sent({ name: "a\u0007b" }), false, "a control character");
});
