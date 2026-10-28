import { today } from "#brief/day.ts";
import { writeEvening } from "#brief/vault.ts";
import { gatherRecap, sharedReaders, type Readers, type Recap } from "#recap/gather.ts";
import { recapNote } from "#recap/say.ts";

/// The hour the evening's recap is written on its own, once a day.
export const EVENING_HOUR = 18;
/// How often the clock is looked at. A timer set for six would fire late after the Mac slept.
const LOOK_EVERY = 60_000;

/// Gathers the day's work and writes it into the day's note: what was gathered, and where it was
/// written unless it could not be.
export async function recapDay(vault: string, now = new Date(), readers: Readers = sharedReaders()): Promise<{ recap: Recap; note?: string }> {
  const recap = await gatherRecap(now, readers);
  const note = await writeEvening(vault, recap.day, recapNote(recap)).catch(() => undefined);
  return { recap, note };
}

export function due(now: Date, written: string | undefined): boolean {
  return now.getHours() >= EVENING_HOUR && written !== today(now);
}

/// Writes the evening's recap on its own, the first minute from six that the app is running each
/// day. Written again later the same day, it replaces itself.
export function startEvenings(vault: string, recap = (now: Date) => recapDay(vault, now)): () => void {
  let written: string | undefined;
  const timer = setInterval(() => {
    const now = new Date();
    if (!due(now, written)) return;
    written = today(now);
    void recap(now).catch(() => undefined);
  }, LOOK_EVERY);
  return () => clearInterval(timer);
}
