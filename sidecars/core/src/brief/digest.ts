import { clock, dayOf, distance, nextDay, spoken, today } from "#brief/day.ts";
import type { Gathered } from "#connect/read.ts";
import { bySender } from "#brief/senders.ts";
import type { Item } from "#connect/source.ts";

/// Which part of the day was asked about. Reading the whole brief back to someone who asked what
/// they have tomorrow answers a question they did not ask.
export type Scope = "today" | "tomorrow" | "everything";

export type Digest = {
  day: string;
  overdue: Item[];
  now: Item[];
  tomorrow: Item[];
  deadlines: Item[];
  messages: Item[];
  missing: string[];
};

/// A brief is what someone needs to hear at the start of a day, not everything a calendar knows.
/// An event that has passed is simply past: a lecture on the second is not work left undone, and
/// listing a term of them as overdue was the difference between a summary and a recital.
export function digest(gathered: Gathered, when: Date = new Date()): Digest {
  const day = today(when);
  const after = nextDay(day);
  const live = gathered.items.filter((item) => !item.done);

  const tasks = live.filter((item) => item.kind === "task");
  const events = live.filter((item) => item.kind === "event");

  const missing = [
    ...gathered.refused.map((name) => `${name} was not allowed`),
    ...gathered.failed.map((one) => `${one.source} could not be reached: ${one.reason}`),
  ];

  return {
    day,
    overdue: tasks.filter((item) => dayOf(item.at) < day && !item.happening),
    now: live.filter((item) => item.kind !== "message" && dayOf(item.at) === day),
    // Only the next day of events. Anything further is a timetable, and a timetable is not news.
    tomorrow: events.filter((item) => dayOf(item.at) === after),
    deadlines: tasks.filter((item) => dayOf(item.at) > day),
    messages: live.filter((item) => item.kind === "message"),
    missing,
  };
}

/// Work due tomorrow, which belongs to a question about tomorrow as much as its events do.
export function dueTomorrow(summary: Digest): Item[] {
  const after = nextDay(summary.day);
  return summary.deadlines.filter((item) => dayOf(item.at) === after);
}

function line(item: Item, day: string): string {
  const on = dayOf(item.at);
  const at = clock(item.at);
  const when = at ? `${spoken(on)} at ${at}` : spoken(on);
  return `- ${when}, ${distance(on, day)}: ${item.title} (${item.collection})`;
}

function mailLines(messages: Item[]): string[] {
  return bySender(messages).map((one) => {
    const again = one.count > one.subjects.length ? ` (${one.count} in all)` : "";
    return `- ${one.sender}: ${one.subjects.join("; ")}${again}`;
  });
}

function notIncluded(summary: Digest): string[] {
  return summary.missing.length > 0 ? [`Not included:\n${summary.missing.map((one) => `- ${one}`).join("\n")}`] : [];
}

/// Facts for the model to read aloud from, not prose. Composing the sentences here would put a
/// second voice in the reply, and the assistant already has one. Only the part asked about is
/// given: a small model handed the whole brief for a question about tomorrow read out today's
/// overdue work as tomorrow's.
export function asFacts(summary: Digest, scope: Scope = "everything"): string {
  const say = (item: Item) => line(item, summary.day);
  const parts = [
    // A smaller model will otherwise round a fortnight down to "a few days" and contradict itself
    // about the mail. Saying it must not add anything costs a sentence and buys accuracy.
    "These are the facts about the user's day. Read them back in plain speech. Do not add anything "
    + "that is not written here, do not leave anything out, and do not guess at how far away "
    + "something is: the distance is given.",
    `Today is ${spoken(summary.day)}.`,
  ];

  if (scope === "tomorrow") {
    const due = dueTomorrow(summary);
    parts.push(
      summary.tomorrow.length > 0
        ? `Tomorrow, ${spoken(nextDay(summary.day))}:\n${summary.tomorrow.map(say).join("\n")}`
        : `Nothing is on the calendar tomorrow, ${spoken(nextDay(summary.day))}.`,
    );
    if (due.length > 0) parts.push(`Due tomorrow:\n${due.map(say).join("\n")}`);
    return [...parts, ...notIncluded(summary)].join("\n\n");
  }

  parts.push(
    summary.now.length > 0
      ? `Today:\n${summary.now.map(say).join("\n")}`
      : "Nothing is on today.",
  );
  if (scope === "today") return [...parts, ...notIncluded(summary)].join("\n\n");
  if (summary.overdue.length > 0) {
    parts.push(`Overdue and unfinished:\n${summary.overdue.map(say).join("\n")}`);
  }
  if (summary.deadlines.length > 0) {
    parts.push(`Deadlines coming up:\n${summary.deadlines.map(say).join("\n")}`);
  }
  if (summary.tomorrow.length > 0) {
    parts.push(`Tomorrow:\n${summary.tomorrow.map(say).join("\n")}`);
  }
  if (summary.messages.length > 0) {
    parts.push(
      `Unread mail, ${summary.messages.length} message`
      + `${summary.messages.length === 1 ? "" : "s"}:\n`
      + mailLines(summary.messages).join("\n"),
    );
  } else {
    parts.push("No unread mail.");
  }

  return [...parts, ...notIncluded(summary)].join("\n\n");
}
