import type { Tab } from "./fsm.ts";
import { stepWith, type Spring } from "./spring.ts";

/// Where the icosahedron is: in the middle of the voice tab, moved aside while another tab is
/// showing, risen away once a chat has started, and nowhere while the island is not open round it.
export type Place = "center" | "aside" | "above" | "gone";

export type View = { open: boolean; ready: boolean; tab: Tab; chatting: boolean };

/// How far from the middle it must go to be wholly outside the island: half the open island, and
/// the farthest its light reaches beyond that. Another tab sweeps it a little past this, and a
/// chat sends it up by RISE.
export const REACH = 400 + 130;
export const AWAY = REACH + 30;
export const RISE = 70;

const SLIDE = { stiffness: 210, damping: 30 };
const FADE = 12;

export type FaceMotion = { place: Place; x: Spring; y: Spring; alpha: number };

export const RESTING: FaceMotion = {
  place: "gone",
  x: { value: 0, velocity: 0 },
  y: { value: 0, velocity: 0 },
  alpha: 0,
};

export function placeOf(view: View): Place {
  if (!view.open || !view.ready) return "gone";
  if (view.tab !== "voice") return "aside";
  return view.chatting ? "above" : "center";
}

function spot(place: Place, from: FaceMotion): { x: number; y: number } {
  if (place === "aside") return { x: -AWAY, y: 0 };
  if (place === "above") return { x: 0, y: -RISE };
  if (place === "center") return { x: 0, y: 0 };
  return { x: from.x.value, y: from.y.value };
}

export function moveFace(m: FaceMotion, to: Place, dt: number): FaceMotion {
  const goal = spot(to, m);
  // Out of sight it does not travel: it is put where it will be seen from, so an island opening
  // shows it in place, and a tab coming back slides it in from the side it left by.
  const jump = m.place === "gone" && to !== "gone";
  const x = jump ? { value: goal.x, velocity: 0 } : stepWith(m.x, goal.x, dt, SLIDE.stiffness, SLIDE.damping);
  const y = jump ? { value: goal.y, velocity: 0 } : stepWith(m.y, goal.y, dt, SLIDE.stiffness, SLIDE.damping);
  return { place: to, x, y, alpha: shown(m, to, x.value, dt) };
}

/// How much of it shows. A sweep to the side is carried out whole, the island's edge hiding it as
/// it goes: faded on the way, it was seen to stop halfway and vanish. It comes back whole too.
function shown(m: FaceMotion, to: Place, x: number, dt: number): number {
  if (to === "aside") return x <= -REACH ? 0 : m.alpha;
  if (to === "center" && m.place === "aside") return 1;
  const goal = to === "center" ? 1 : 0;
  const alpha = m.alpha + (goal - m.alpha) * (1 - Math.exp(-dt * FADE));
  return Math.abs(goal - alpha) < 0.001 ? goal : alpha;
}

/// A fresh appearance spins it in, as the corner orb did when summoned, and a visible one
/// collapses as the island folds. Coming back from another tab is not fresh: it slides.
export function freshly(from: Place, to: Place, alpha: number): "appear" | "dismiss" | null {
  if (to === "center" && (from === "gone" || from === "above")) return "appear";
  if (to === "gone" && from === "center" && alpha > 0.5) return "dismiss";
  return null;
}
