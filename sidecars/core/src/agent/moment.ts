import type { ModelMessage } from "ai";
import type { Said } from "#agent/loop.ts";

function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/// When the turn is taking place, as the model is told it. Without it a model knows the date only
/// from whatever a tool happens to say, and guesses the year.
export function moment(at: Date = new Date(), zone: string = localZone()): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: zone,
  }).format(at);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone })
    .format(at)
    .toLowerCase();
  return `It is ${day.replace(",", "")}, ${time}, in the ${zone} time zone.`;
}

/// The conversation as sent. Only the turn's own message carries the moment: in the system prompt
/// it would change every minute and void the cache of everything after it, and in the history it
/// would put words in the user's mouth.
export function messagesFor(
  history: Said[],
  prompt: string,
  at: Date = new Date(),
  zone: string = localZone(),
): ModelMessage[] {
  return [
    ...history.map((one) => ({ role: one.role, content: one.text })),
    { role: "user", content: `${moment(at, zone)}\n\n${prompt}` },
  ];
}
