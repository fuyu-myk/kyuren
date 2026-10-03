export const APPEAR_SECONDS = 0.5;
export const DISMISS_SECONDS = 0.28;

const TURN = Math.PI * 2;

export type Transition = { kind: "appear" | "dismiss"; at: number } | null;

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

export function progress(transition: Transition, t: number): number {
  if (!transition) return 1;
  const span = transition.kind === "appear" ? APPEAR_SECONDS : DISMISS_SECONDS;
  return Math.min(1, (t - transition.at) / span);
}

export function presence(transition: Transition, t: number): number {
  if (!transition) return 1;
  const p = progress(transition, t);

  if (transition.kind === "appear") {
    return p >= 1 ? 1 : Math.max(0, easeOutBack(p));
  }
  return (1 - p) ** 2.2 * (1 + 1.4 * Math.sin(p * Math.PI * 0.8));
}

export function spinOffset(transition: Transition, t: number): number {
  if (!transition) return 0;
  const p = progress(transition, t);

  if (transition.kind === "appear") {
    return -TURN * (1 - p) ** 3;
  }
  return TURN * p ** 1.6;
}
