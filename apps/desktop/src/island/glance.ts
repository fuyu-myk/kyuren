/// The machine as the host last sampled it, with the network's recent past for the graph.
export type Traffic = { at: number; up: number; down: number };
export type Snapshot = {
  cpu: number;
  gpu: number | null;
  ram: number;
  disk: { used: number; total: number } | null;
  traffic: Traffic[];
};

/// The least the graph's scale may be, in bytes a second, so a quiet network draws near the
/// middle line rather than filling the graph with noise.
const QUIET = 10_000;

function short(value: number): string {
  return value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
}

/// A rate in the unit that keeps it short.
export function rate(bytes: number): string {
  if (bytes >= 1_000_000) return `${short(bytes / 1_000_000)} MB/s`;
  return `${short(bytes / 1_000)} KB/s`;
}

/// One scale for both directions: the busiest moment either way, or QUIET if that is less.
export function ceiling(traffic: Traffic[]): number {
  return traffic.reduce((most, one) => Math.max(most, one.up, one.down), QUIET);
}

/// The sample under the cursor, across a graph `width` wide holding `count` samples.
export function nearest(x: number, width: number, count: number): number {
  if (count === 0) return -1;
  const at = Math.round((Math.min(Math.max(x, 0), width) / width) * (count - 1));
  return Math.min(count - 1, Math.max(0, at));
}

/// The pomodoro as the host keeps it: a period running to a time, or stopped with time left.
export type Clock = { period: "focus" | "short" | "long"; endsAt: number | null; left: number; done: number };

export function remaining(clock: Clock, now: number): number {
  return clock.endsAt === null ? clock.left : Math.max(0, clock.endsAt - now);
}

/// Minutes and seconds left, the last second counting until it is wholly gone.
export function countdown(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(Math.floor(seconds / 60))}:${two(seconds % 60)}`;
}

/// What plays, as the host last heard it: the position as it was at `at`, in seconds.
export type Playing = {
  player: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  position: number | null;
  at: number;
  playing: boolean;
  track: string | null;
  volume: number | null;
};

/// Where it is now: moved on from what the player last said while it plays, never past the end.
export function played(playing: Playing, now: number): number | null {
  if (playing.position === null) return null;
  const moved = playing.playing ? (now - playing.at) / 1000 : 0;
  return Math.min(playing.duration, Math.max(0, playing.position + moved));
}

/// A track's time, as minutes and seconds.
export function minutes(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
