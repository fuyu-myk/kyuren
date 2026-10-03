export type Layer = "memory" | "reasoning" | "capability" | "connected";

/// In the order a fist walks them.
export const LAYERS = ["memory", "reasoning", "capability", "connected"] as const;

export type Rgb = readonly [number, number, number];

/// Light periwinkle, and each layer a tint of it. Everything sits in the same pale family so the
/// graph reads as one thing at a glance, while still saying which part of the mind is which.
export const INK = {
  periwinkle: [223, 227, 255],
  memory: [199, 206, 252],
  reasoning: [244, 227, 178],
  capability: [186, 232, 186],
  connected: [178, 226, 230],
  running: [244, 202, 235],
} as const satisfies Record<string, Rgb>;

/// The dim laid over whatever is on screen: thinnest in the middle, where the graph is, and
/// almost solid at the corners. What is behind stays legible as shape without competing.
export const HAZE = [
  { at: 0, colour: "rgba(17, 17, 27, 0.58)" },
  { at: 0.45, colour: "rgba(13, 13, 22, 0.82)" },
  { at: 1, colour: "rgba(7, 7, 13, 0.95)" },
] as const;

export function rgbOf(layer: Layer): Rgb {
  return INK[layer];
}

export function shade(colour: Rgb, alpha: number): string {
  return `rgba(${colour[0]}, ${colour[1]}, ${colour[2]}, ${alpha})`;
}

export function colourOf(layer: Layer): string {
  return shade(rgbOf(layer), 1);
}
