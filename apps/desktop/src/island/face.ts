import { progress, type Transition } from "./appear.ts";
import type { Voice } from "./channels.ts";
import { levelFor, scaleFor, spinFor } from "./level.ts";
import { freshly, moveFace, RESTING, type FaceMotion, type Place } from "./place.ts";
import { step, type Spring } from "./spring.ts";

const SMOOTHING = 9;
const PUNCH_SMOOTHING = 26;
const QUIET_SCALE = 0.7;
const LOUD_SCALE = 0.78;

/// The icosahedron on the island as numbers: how lively it is, how big, how far turned, whether
/// it is arriving or leaving, and where it stands.
export type Face = {
  t: number;
  level: number;
  punch: number;
  scale: Spring;
  clock: number;
  transition: Transition;
  motion: FaceMotion;
};

export const FACE: Face = {
  t: 0,
  level: 0,
  punch: 0,
  scale: { value: 1, velocity: 0 },
  clock: 0,
  transition: null,
  motion: RESTING,
};

export function stepFace(face: Face, to: Place, voice: Voice, energy: number, dt: number): Face {
  const t = face.t + dt;
  const fresh = freshly(face.motion.place, to, face.motion.alpha);
  // A finished collapse holds it at nothing only while it is put away; placed anywhere else, it
  // lets go, or a fold followed by another tab would keep it from ever being drawn again.
  const over = face.transition !== null && progress(face.transition, t) >= 1;
  const ended = over && (face.transition?.kind === "appear" || to !== "gone");
  const transition: Transition = fresh ? { kind: fresh, at: t } : ended ? null : face.transition;
  const aim = levelFor(voice, energy, t);
  const level = face.level + (aim - face.level) * (1 - Math.exp(-dt * SMOOTHING));
  const punch = face.punch + (aim - face.punch) * (1 - Math.exp(-dt * PUNCH_SMOOTHING));
  const scale = step(face.scale, scaleFor(voice) * (QUIET_SCALE + punch * LOUD_SCALE), dt);
  // One clock turns the frame, the rings, the sway of the rays and the motes, and runs faster the
  // livelier it is, which is how one number makes all of it move as one.
  const clock = face.clock + dt * spinFor(voice) * (1 + level * 0.6);
  return { t, level, punch, scale, clock, transition, motion: moveFace(face.motion, to, dt) };
}

/// Nothing to draw and nothing moving: put away, faded out, and done collapsing.
export function atRest(face: Face): boolean {
  const collapsing = face.transition?.kind === "dismiss" && progress(face.transition, face.t) < 1;
  return face.motion.place !== "center" && face.motion.alpha < 0.01 && !collapsing;
}
