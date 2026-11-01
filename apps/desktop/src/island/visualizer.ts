/// How many bands the music comes in, from the bass up.
export const BANDS = 24;

/// The island's own lavender and pink, for a cover with no colour to take or none at all.
export const FALLBACK: [string, string] = ["hsl(232 97% 85%)", "hsl(316 72% 86%)"];

/// How many steps the response behind the bars is drawn through, finer than the bars.
export const RESPONSE = 64;

/// How much a hit lifts a bar, as a share of its own height.
const LIFT = 0.4;

/// A loud master's usual level, as the bars stand for it, and where the response stands for it
/// instead: above the bars, moving twice as far as they do for a step in loudness.
const USUAL = 0.56;
const RESTING = 0.62;
const KEENNESS = 2;
/// Past this the response eases into the top rather than flattening against it.
const KNEE = 0.8;

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

/// A bar as a hit lifts it: the louder it already stands the more, and never past full.
export function struck(level: number, impact: number): number {
  return Math.min(1, level * (1 + LIFT * impact));
}

/// A step of the response as the analyser draws it: above the bars and keener than they are.
export function analysed(level: number): number {
  const raised = RESTING + KEENNESS * (level - USUAL);
  if (raised <= KNEE) return Math.max(0, raised);
  return KNEE + (1 - KNEE) * Math.tanh((raised - KNEE) / (1 - KNEE));
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
