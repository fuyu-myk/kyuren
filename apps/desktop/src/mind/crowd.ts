/// How crowded the mind is, from none at a few dozen orbs to full at several hundred. Glow is
/// drawn additively and orbs are drawn full size, and what reads as light and body around
/// thirty orbs reads as a wash around a thousand; everything lit, sized or spread for a crowd
/// follows this one number, so a small mind is exactly what it was.
const SPARSE = 80;
const DENSE = 700;

export function crowding(count: number): number {
  return Math.max(0, Math.min(1, (count - SPARSE) / (DENSE - SPARSE)));
}

/// How much smaller an orb is drawn, and collided with, in a crowd.
export function orbScale(crowd: number): number {
  return 1 - 0.5 * crowd;
}

/// How much more of the screen a crowded whirlpool may take.
export function roomFor(crowd: number): number {
  return 1 + 0.2 * crowd;
}
