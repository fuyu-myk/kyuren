/// How many bands the music comes in, from the bass up.
export const BANDS = 24;

/// The island's own lavender and pink, for a cover with no colour to take or none at all.
export const FALLBACK: [string, string] = ["hsl(232 97% 85%)", "hsl(316 72% 86%)"];

/// The parts of the spectrum given a bell each, by band: the bass, the low and the high middle, and
/// the treble.
export const REGIONS: Array<[number, number]> = [
  [0, 5],
  [6, 11],
  [12, 17],
  [18, 23],
];

/// A bell of the response, as an equaliser draws one: where it stands and how wide, in bands, and
/// how tall.
export type Bell = { centre: number; height: number; width: number };

/// Each level eased toward what is heard over a frame of `dt` ms: within `rise` ms on the way up
/// and `fall` on the way down, so a beat lands at once and dies away.
export function follow(shown: number[], heard: number[], dt: number, rise: number, fall: number): number[] {
  return shown.map((level, index) => {
    const target = heard[index] ?? 0;
    const pace = 1 - Math.exp(-dt / (target > level ? rise : fall));
    return level + (target - level) * pace;
  });
}

export function settled(levels: number[]): boolean {
  return levels.every((level) => level < 0.005);
}

/// A bell for each part of the music, as tall as that part's loudest band and standing over where
/// its loudness gathers, as wide as it is spread.
export function bellsOf(levels: number[]): Bell[] {
  return REGIONS.map(([from, to]) => {
    const part = levels.slice(from, to + 1);
    const height = Math.max(0, ...part);
    // Raised to the fourth, the loudest bands decide where the bell stands.
    const weights = part.map((level) => level ** 4);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total === 0) return { centre: (from + to) / 2, height: 0, width: 1.5 };
    const centre = from + weights.reduce((sum, weight, index) => sum + weight * index, 0) / total;
    const spread = Math.sqrt(weights.reduce((sum, weight, index) => sum + weight * (from + index - centre) ** 2, 0) / total);
    return { centre, height, width: Math.min(2.5, Math.max(1, 0.8 + 1.5 * spread)) };
  });
}

/// How tall a bell stands at a place along the bands.
export function bellAt(bell: Bell, at: number): number {
  return bell.height * Math.exp(-((at - bell.centre) ** 2) / (2 * bell.width ** 2));
}

/// The bells eased toward where the music puts them, gliding along rather than jumping between
/// bands, rising with a beat and settling after it.
export function followBells(shown: Bell[], wanted: Bell[], dt: number): Bell[] {
  const centres = follow(shown.map((bell) => bell.centre), wanted.map((bell) => bell.centre), dt, 90, 90);
  const heights = follow(shown.map((bell) => bell.height), wanted.map((bell) => bell.height), dt, 40, 140);
  const widths = follow(shown.map((bell) => bell.width), wanted.map((bell) => bell.width), dt, 120, 120);
  return wanted.map((_, index) => ({ centre: centres[index]!, height: heights[index]!, width: widths[index]! }));
}

type Rgb = [number, number, number];

/// The colour of the pixels between two columns, the vivid ones counting most, or none when they
/// are all near grey.
function colourOf(pixels: ArrayLike<number>, width: number, height: number, from: number, to: number): Rgb | null {
  let weight = 0;
  const sum: Rgb = [0, 0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = from; x < to; x++) {
      const at = (y * width + x) * 4;
      const [r, g, b] = [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!];
      const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      weight += chroma;
      sum[0] += r * chroma;
      sum[1] += g * chroma;
      sum[2] += b * chroma;
    }
  }
  const counted = height * (to - from);
  if (counted === 0 || weight / counted < 0.08) return null;
  return [sum[0] / weight, sum[1] / weight, sum[2] / weight];
}

/// A colour bright and full enough to read against the island's black.
function lifted([r, g, b]: Rgb): string {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const high = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  const lightness = (high + low) / 2;
  const chroma = high - low;
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (chroma > 0) {
    if (high === red) hue = ((green - blue) / chroma + 6) % 6;
    else if (high === green) hue = (blue - red) / chroma + 2;
    else hue = (red - green) / chroma + 4;
  }
  const s = Math.max(0.5, saturation);
  const l = Math.min(0.8, Math.max(0.62, lightness));
  return `hsl(${Math.round(hue * 60)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

/// The two colours the bars run between, taken from the cover's left and right halves.
export function paletteOf(pixels: ArrayLike<number>, width: number, height: number): [string, string] {
  const left = colourOf(pixels, width, height, 0, Math.floor(width / 2));
  const right = colourOf(pixels, width, height, Math.floor(width / 2), width);
  if (!left && !right) return FALLBACK;
  return [lifted(left ?? right!), lifted(right ?? left!)];
}
