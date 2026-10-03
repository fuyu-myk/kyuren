/// The island's outline in the panel's own points: flush with the top of the screen, rounded at
/// the bottom, and with a small concave ear at each top corner so the shape flows out of the screen
/// edge the way the notch does. Open along the top, which is the screen's edge and is never drawn.
export type Outline = {
  /// Left edge of the island's body, its width and height.
  x: number;
  width: number;
  height: number;
  /// Radius of the two bottom corners.
  radius: number;
  /// Radius of the two ears.
  ear: number;
};

export function outlineAt(panelWidth: number, width: number, height: number, radius: number, ear: number): Outline {
  return { x: (panelWidth - width) / 2, width, height, radius, ear };
}

function n(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/// The outline as an SVG path, starting at the top of the left ear and ending at the top of the
/// right one. Closing it along the top gives the filled shape; leaving it open gives the border.
export function outlinePath(o: Outline, closed: boolean): string {
  const r = Math.max(0, Math.min(o.radius, o.width / 2, o.height));
  const e = Math.max(0, Math.min(o.ear, o.height - r));
  const left = o.x;
  const right = o.x + o.width;
  const bottom = o.height;
  const parts = [
    `M ${n(left - e)} 0`,
    e > 0 ? `A ${n(e)} ${n(e)} 0 0 1 ${n(left)} ${n(e)}` : `L ${n(left)} 0`,
    `L ${n(left)} ${n(bottom - r)}`,
    r > 0 ? `A ${n(r)} ${n(r)} 0 0 0 ${n(left + r)} ${n(bottom)}` : "",
    `L ${n(right - r)} ${n(bottom)}`,
    r > 0 ? `A ${n(r)} ${n(r)} 0 0 0 ${n(right)} ${n(bottom - r)}` : "",
    `L ${n(right)} ${n(e)}`,
    e > 0 ? `A ${n(e)} ${n(e)} 0 0 1 ${n(right + e)} 0` : `L ${n(right)} 0`,
  ].filter(Boolean);
  return closed ? `${parts.join(" ")} Z` : parts.join(" ");
}

/// The island's whole footprint, ears included, for deciding where clicks land.
export function footprint(o: Outline): { x: number; y: number; width: number; height: number } {
  return { x: o.x - o.ear, y: 0, width: o.width + 2 * o.ear, height: o.height };
}
