import { clock, dayOf, distance, nextDay, spoken } from "#brief/day.ts";
import { dueTomorrow, type Digest, type Scope } from "#brief/digest.ts";
import { bySender, inWords } from "#brief/senders.ts";
import type { Item } from "#connect/source.ts";

/// The brief is spoken from here rather than paraphrased by a model. It is a report of facts, and
/// a small model retelling it moved a fortnight to "this weekend" and put an afternoon discussion
/// before the morning lecture. Deciding that the question was about the day is worth a model;
/// restating the answer is not.

function list(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function at(item: Item): string {
  const time = clock(item.at);
  return time ? `${item.title} at ${time}` : item.title;
}

function when(item: Item, day: string): string {
  const away = distance(dayOf(item.at), day);
  const time = clock(item.at);
  const near = away === "today" || away === "tomorrow" || away === "yesterday";
  const on = near ? away : spoken(dayOf(item.at));
  const said = time ? `${on} at ${time}` : on;
  return near ? `${item.title} ${said}` : `${item.title} ${said}, ${away}`;
}

/// How a source is named out loud. The brief says which one it could not reach, and the internal
/// identifier is not a thing to say to someone.
const ALOUD: Record<string, string> = {
  apple_calendar: "your Mac's calendar",
  apple_mail: "Mail",
  google_calendar: "Google Calendar",
  gmail: "Gmail",
  microsoft_calendar: "your Outlook calendar",
  microsoft_mail: "Outlook mail",
  notion: "Notion",
};

function aloud(source: string): string {
  return ALOUD[source] ?? source.replace(/_/g, " ");
}

function count(n: number, one: string, many: string): string {
  return n === 1 ? `one ${one}` : `${n} ${many}`;
}

/// Said by whoever wrote it. Naming a sender once per message reads out the same name twice in a
/// row, which sounds like a fault rather than a full inbox.
function mail(messages: Item[]): string {
  const senders = bySender(messages);
  if (senders.length === 0) return "You have no unread mail.";

  const total = count(messages.length, "unread message", "unread messages");
  if (senders.every((one) => one.count === 1)) {
    return `You have ${total}, from ${list(senders.map((one) => one.sender))}.`;
  }

  return `You have ${total}: `
    + `${list(senders.map((one) => `${inWords(one.count)} from ${one.sender}`))}.`;
}

export type { Scope };

function unchecked(summary: Digest): string[] {
  return summary.missing.length > 0
    ? [`I could not check ${list(summary.missing.map((one) => aloud(one.split(" ")[0] ?? one)))}.`]
    : [];
}

/// Tomorrow is its events and what falls due, and a calendar that could not be read is said
/// rather than taken for a free day.
function tomorrow(summary: Digest): string {
  const due = dueTomorrow(summary);
  const day = spoken(nextDay(summary.day));
  const said = summary.tomorrow.length > 0
    ? [`Tomorrow is ${day}.`, `You have ${list(summary.tomorrow.map(at))}.`]
    : [`Tomorrow is ${day}, and nothing ${summary.missing.length > 0 ? "I could read " : ""}is on your calendar.`];
  if (due.length > 0) said.push(`Due: ${list(due.map(at))}.`);
  return [...said, ...unchecked(summary)].join(" ");
}

export function asSpeech(summary: Digest, scope: Scope = "everything"): string {
  if (scope === "tomorrow") return tomorrow(summary);

  const said: string[] = [`Today is ${spoken(summary.day)}.`];

  if (summary.now.length > 0) {
    said.push(`You have ${list(summary.now.map(at))}.`);
  } else {
    said.push("Nothing is on your calendar today.");
  }

  if (scope === "today") {
    return said.join(" ");
  }

  if (summary.overdue.length > 0) {
    said.push(
      `${count(summary.overdue.length, "thing is overdue", "things are overdue")}: `
      + `${list(summary.overdue.map((item) => when(item, summary.day)))}.`,
    );
  }

  if (summary.deadlines.length > 0) {
    const [next, ...rest] = summary.deadlines;
    said.push(
      rest.length === 0
        ? `Coming up, ${when(next as Item, summary.day)}.`
        : `${count(summary.deadlines.length, "deadline is", "deadlines are")} coming up. `
          + `The nearest is ${when(next as Item, summary.day)}.`,
    );
  }

  if (summary.tomorrow.length > 0) {
    said.push(`Tomorrow you have ${list(summary.tomorrow.map(at))}.`);
  }

  said.push(mail(summary.messages));

  return [...said, ...unchecked(summary)].join(" ");
}
