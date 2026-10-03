import { asFacts, digest } from "#brief/digest.ts";
import { writeNote } from "#brief/vault.ts";
import type { Ask } from "#agent/tool.ts";
import { appleCalendar } from "#connect/apple/calendar.ts";
import { appleMail } from "#connect/apple/mail.ts";
import { googleCalendar } from "#connect/google/calendar.ts";
import { microsoftCalendar } from "#connect/microsoft/calendar.ts";
import { microsoftMail } from "#connect/microsoft/mail.ts";
import { gmail } from "#connect/google/gmail.ts";
import { notionSource } from "#connect/notion/source.ts";
import { gather } from "#connect/read.ts";
import { spanAround, type Source } from "#connect/source.ts";
import type { Gate } from "#permission/gate.ts";

export const BACK_DAYS = 14;

/// How far either side of today the brief looks. Backwards so nothing overdue goes unmentioned.
/// Forwards is generous because only deadlines survive that far: events beyond tomorrow are
/// dropped, so a longer horizon adds warnings rather than a timetable.
const BACK = BACK_DAYS;
export const FORWARD_DAYS = 21;
const FORWARD = FORWARD_DAYS;

export const SOURCES: Source[] = [
  appleCalendar,
  appleMail,
  googleCalendar,
  gmail,
  microsoftCalendar,
  microsoftMail,
  notionSource,
];

export function briefHandlers(gate: Gate, ask: Ask, vault: string) {
  return {
    "brief.today": async () => {
      const gathered = await gather(SOURCES, spanAround(new Date(), BACK, FORWARD), gate, ask);
      const summary = digest(gathered);
      const note = await writeNote(vault, summary, gathered.read).catch(() => undefined);

      return {
        facts: asFacts(summary),
        note,
        read: gathered.read,
        refused: gathered.refused,
        unavailable: gathered.unavailable,
        failed: gathered.failed,
        counts: {
          today: summary.now.length,
          overdue: summary.overdue.length,
          deadlines: summary.deadlines.length,
          tomorrow: summary.tomorrow.length,
          messages: summary.messages.length,
        },
      };
    },
  };
}
