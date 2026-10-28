import type { Ask } from "#agent/tool.ts";
import type { WeekReader } from "#calendar/week.ts";

/// The week for the island, begun on Sunday or, as the settings may say, Monday. Asked for on its
/// own, nothing is asked of the user; pressed for, it may ask about a calendar not yet allowed.
export function calendarHandlers(reader: Pick<WeekReader, "week">, ask: Ask) {
  return {
    "calendar.week": async (params: Record<string, unknown>) => reader.week(params.ask === true ? ask : undefined, params.monday === true),
  };
}
