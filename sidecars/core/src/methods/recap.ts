import { recapDay } from "#recap/evening.ts";
import { recapNote, recapSpeech } from "#recap/say.ts";

/// The evening's recap asked for from the window: written into the day's note, and shown.
export function recapHandlers(vault: string) {
  return {
    "recap.today": async () => {
      const { recap, note } = await recapDay(vault);
      return { facts: recapNote(recap), spoken: recapSpeech(recap), note };
    },
  };
}
