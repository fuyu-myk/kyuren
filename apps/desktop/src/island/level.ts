import type { Voice } from "./channels.ts";

const SPIN: Record<Voice, number> = {
  idle: 1,
  listening: 1.2,
  thinking: 2.4,
  speaking: 1.5,
};

const SCALE: Record<Voice, number> = {
  idle: 1,
  listening: 1.04,
  thinking: 0.66,
  speaking: 1,
};

export function spinFor(voice: Voice): number {
  return SPIN[voice];
}

export function scaleFor(voice: Voice): number {
  return SCALE[voice];
}

function thinking(t: number): number {
  return 0.46 + 0.2 * Math.sin(t * 5.1) + 0.12 * Math.sin(t * 8.7 + 1.3);
}

function resting(t: number): number {
  return 0.13 + 0.05 * Math.sin(t * 0.7) + 0.02 * Math.sin(t * 1.9 + 0.6);
}

// Thinking has nothing to listen to, so it is the one state the icosahedron animates by itself.
// Listening and speaking both ride the energy channel: the microphone feeds it while Kyuren
// listens and the reply being played feeds it while Kyuren talks, so it moves with whichever
// voice is live.
export function levelFor(voice: Voice, energy: number, t: number): number {
  if (voice === "thinking") return thinking(t);
  return Math.max(energy, resting(t));
}
