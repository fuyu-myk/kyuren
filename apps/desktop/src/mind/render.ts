import { drawCore } from "./core.ts";
import { crowding, orbScale } from "./crowd.ts";
import { HAZE, INK, rgbOf, shade, type Layer, type Rgb } from "./palette.ts";
import { scatter } from "./scatter.ts";
import type { Screen } from "./screen.ts";
import type { Node } from "./simulation.ts";
import { middleOf, type Camera, type Seen, type Size } from "./space.ts";

export type Drawn = {
  id: string;
  label: string;
  layer: Layer;
  kind: "note" | "entity" | "tool" | "step" | "core";
  weight: number;
  /// What a capability does, in its own words, for when one is being read rather than run.
  description?: string;
  running?: boolean;
};

export type Edge = { from: string; to: string; strength: number };

/// How large an orb is. Weight grows quickly at first and slowly afterwards, so a note mentioned
/// forty times is bigger than one mentioned four without being ten times the size.
export function radiusOf(weight: number, kind: Drawn["kind"]): number {
  if (kind === "core") return CORE;
  const base = kind === "entity" ? 6 : kind === "tool" ? 7 : 5;
  return base + Math.sqrt(Math.max(0, weight)) * 2.4;
}

/// Labels are drawn only when they can be read and only when there are few enough to take in.
/// Drawing a thousand of them costs more than the arrangement and says less.
export function labelled(count: number, zoom: number): boolean {
  return zoom > 0.55 && count <= 160;
}

/// How far a link bows away from a straight line, and where in its sway it currently sits.
export function bendOf(edge: Edge): { bow: number; sway: number } {
  const spread = scatter(`${edge.from}->${edge.to}`);
  const side = scatter(`${edge.to}<-${edge.from}`) < 0.5 ? -1 : 1;
  return { bow: (0.09 + spread * 0.17) * side, sway: spread * Math.PI * 2 };
}

const BREATH = 0.35;
const SWAY = 0.028;

/// A thread is drawn once, solid. It was drawn as light for a while, wide and faint under narrow
/// and bright, and across a thousand crossings that added up to a wash; a line that is simply
/// there reads at any size.
function stroked(
  canvas: CanvasRenderingContext2D,
  path: Path2D,
  strength: number,
  width: number,
  crowd: number,
): void {
  canvas.globalCompositeOperation = "source-over";
  canvas.strokeStyle = shade(INK.periwinkle, 0.38);
  canvas.globalAlpha = Math.min(1, strength * (1 - 0.55 * crowd));
  canvas.lineWidth = width * (1.2 - 0.5 * crowd);
  canvas.stroke(path);
}

/// Threads of like brightness and width, gathered to be stroked as one.
type Bundle = { path: Path2D; strength: number; width: number };

function bundleOf(band: Map<string, Bundle>, strength: number, width: number): Bundle {
  const level = Math.round(strength * 10) / 10;
  const wide = Math.round(width * 4) / 4;
  const key = `${level}|${wide}`;
  const had = band.get(key);
  if (had) return had;
  const made = { path: new Path2D(), strength: level, width: wide };
  band.set(key, made);
  return made;
}

/// Where a thread bows is settled by its name, so it is worked out once per thread rather than
/// once per thread per frame.
const bends = new WeakMap<Edge, ReturnType<typeof bendOf>>();

function bend(edge: Edge): ReturnType<typeof bendOf> {
  const had = bends.get(edge);
  if (had) return had;
  const made = bendOf(edge);
  bends.set(edge, made);
  return made;
}

function offscreen(seen: Seen, size: Size): boolean {
  return seen.x < -90 || seen.y < -90 || seen.x > size.width + 90 || seen.y > size.height + 90;
}

/// How much of an orb's size comes from being near rather than from what it is, and how dim the
/// far side of the whirlpool goes. Both are what make a flat canvas read as having depth.
const NEAREST_SIZE = 1.9;
const FURTHEST_SIZE = 0.45;
const FAR_SIDE = 0.42;

function held(near: number): number {
  return Math.max(FURTHEST_SIZE, Math.min(NEAREST_SIZE, near));
}

export function sizeOf(
  about: Drawn,
  seen: Seen,
  camera: Camera,
  rise: number,
  scale = 1,
): number {
  return radiusOf(about.weight, about.kind) * held(seen.near) * camera.zoom * rise * scale;
}

/// How large the thing at the middle is. It is an orb like the others as far as arranging and
/// taking hold of it go, and only drawn differently.
export const CORE = 28;

/// How far outside an orb the mark sits that says a hand has reached it, and how far a pointer
/// may miss an orb and still be taken to have meant it.
const REACHED = 9;
const TOUCH = 5;

const halos = new Map<string, HTMLCanvasElement>();

/// One glow per colour, drawn once and stamped. A gradient built per orb per frame is the
/// difference between a thousand orbs at sixty frames and a thousand orbs at twelve.
function halo(colour: Rgb): HTMLCanvasElement {
  const key = colour.join();
  const had = halos.get(key);
  if (had) return had;

  const sprite = document.createElement("canvas");
  sprite.width = 64;
  sprite.height = 64;
  const paint = sprite.getContext("2d")!;
  const glow = paint.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, shade(colour, 0.85));
  glow.addColorStop(0.28, shade(colour, 0.3));
  glow.addColorStop(1, shade(colour, 0));
  paint.fillStyle = glow;
  paint.fillRect(0, 0, 64, 64);

  halos.set(key, sprite);
  return sprite;
}

export type Scene = {
  size: Size;
  screen: Screen;
  nodes: Node[];
  drawn: Map<string, Drawn>;
  edges: Edge[];
  camera: Camera;
  focus: string | undefined;
  /// Seconds since the mind opened, for the sway of the links and the turn of the core.
  moment: number;
  /// How far along a given orb is in arriving, from nothing to fully here.
  rise: (id: string) => number;
  /// How present the whole thing is: one while it is up, falling to nothing as it is dismissed.
  shown: number;
  /// What a hand would take hold of if it closed now. A hand cannot aim the way a pointer can, so
  /// what it has reached is shown rather than found out by pinching and missing.
  reaching?: string;
};

type Piece = { depth: number; node: Node };

function heads(about: Drawn): boolean {
  return about.kind === "entity" || about.kind === "tool";
}

export function draw(canvas: CanvasRenderingContext2D, scene: Scene): void {
  const { size, screen, camera, focus, shown } = scene;

  canvas.globalCompositeOperation = "source-over";
  canvas.globalAlpha = 1;
  canvas.clearRect(0, 0, size.width, size.height);
  if (shown <= 0.001) return;

  const middle = middleOf(size);
  const haze = canvas.createRadialGradient(
    middle.x,
    middle.y,
    0,
    middle.x,
    middle.y,
    Math.max(size.width, size.height) * 0.66,
  );
  for (const stop of HAZE) haze.addColorStop(stop.at, stop.colour);
  canvas.globalAlpha = shown;
  canvas.fillStyle = haze;
  canvas.fillRect(0, 0, size.width, size.height);

  const near = focus ? new Set<string>([focus]) : undefined;
  if (near) {
    for (const edge of scene.edges) {
      if (edge.from === focus) near.add(edge.to);
      if (edge.to === focus) near.add(edge.from);
    }
  }

  // Every thread first, then every orb back to front, then the middle: nothing is drawn across
  // an orb, and the near arm still passes in front of the far one. Threads are gathered into
  // bundles of like brightness and width and stroked once per bundle, because stroking each of
  // ten thousand threads on its own is what made a large mind crawl.
  const orbs: Piece[] = [];
  let core: Node | undefined;
  for (const node of scene.nodes) {
    const seen = screen.at(node.id);
    if (!seen) continue;
    if (scene.drawn.get(node.id)?.kind === "core") {
      core = node;
      continue;
    }
    orbs.push({ depth: seen.depth, node });
  }
  orbs.sort((one, two) => one.depth - two.depth);

  const bundles = new Map<string, Bundle>();
  for (const edge of scene.edges) {
    const from = screen.at(edge.from);
    const to = screen.at(edge.to);
    if (!from || !to) continue;
    if (offscreen(from, size) && offscreen(to, size)) continue;
    const rise = Math.min(scene.rise(edge.from), scene.rise(edge.to));
    if (rise <= 0.01) continue;

    const lit = near ? near.has(edge.from) && near.has(edge.to) : undefined;
    // A thread out of the middle is quieter than one between two things it remembers: it says
    // where an arm hangs from, not that two things belong together.
    const spoke = scene.drawn.get(edge.from)?.kind === "core";
    const depth = held((from.near + to.near) / 2);
    const strength =
      shown * rise * (lit === undefined ? 0.85 : lit ? 1.2 : 0.1) * depth * (spoke ? 0.85 : 1);
    if (strength < 0.03) continue;
    const bundle = bundleOf(bundles, strength, (lit ? 2.1 : 1.6) * depth);

    const { bow, sway } = bend(edge);
    const bent = bow + Math.sin(scene.moment * BREATH + sway) * SWAY;
    const across = to.x - from.x;
    const down = to.y - from.y;
    bundle.path.moveTo(from.x, from.y);
    bundle.path.quadraticCurveTo(
      (from.x + to.x) / 2 + down * bent,
      (from.y + to.y) / 2 - across * bent,
      to.x,
      to.y,
    );
  }

  const showLabels = labelled(scene.nodes.length, camera.zoom);
  const crowd = crowding(scene.nodes.length);
  const scale = orbScale(crowd);

  const orb = (node: Node): void => {
    const about = scene.drawn.get(node.id);
    const seen = screen.at(node.id)!;
    const rise = scene.rise(node.id);
    if (!about || rise <= 0.01) return;
    if (seen.x < -90 || seen.y < -90 || seen.x > size.width + 90 || seen.y > size.height + 90) {
      return;
    }

    const radius = sizeOf(about, seen, camera, rise, scale);
    const dimmed = near !== undefined && !near.has(node.id);

    const colour = about.running ? INK.running : rgbOf(about.layer);
    // The far side of the whirlpool is dimmer, which is most of what tells one side from the other.
    const depth = FAR_SIDE + (1 - FAR_SIDE) * Math.min(1, held(seen.near));
    const strength = shown * depth * (dimmed ? 0.16 : 1);

    // An orb is a solid disc in the colour of its layer. Only a running step glows, since it
    // keeps announcing itself so the live layer can be found without reading it.
    if (about.running) {
      const pulse = 1.25 + Math.sin(scene.moment * 4.2) * 0.45;
      const spread = radius * (2.2 - 0.9 * crowd) * pulse;
      canvas.globalCompositeOperation = "lighter";
      canvas.globalAlpha = strength;
      canvas.drawImage(halo(colour), seen.x - spread, seen.y - spread, spread * 2, spread * 2);
    }

    canvas.globalCompositeOperation = "source-over";
    canvas.globalAlpha = strength;
    canvas.fillStyle = shade(colour, 1);
    canvas.beginPath();
    canvas.arc(seen.x, seen.y, radius * (about.kind === "entity" ? 0.62 : 0.5), 0, Math.PI * 2);
    canvas.fill();

    if (about.kind === "entity" || about.kind === "tool") {
      canvas.globalAlpha = strength * 0.7 * (1 - 0.4 * crowd);
      canvas.strokeStyle = shade(colour, 0.9);
      canvas.lineWidth = 1.4;
      canvas.beginPath();
      canvas.arc(seen.x, seen.y, radius, 0, Math.PI * 2);
      canvas.stroke();
    }

    if (node.id === scene.reaching) {
      canvas.globalAlpha = shown * 0.85;
      canvas.strokeStyle = shade(INK.periwinkle, 0.9);
      canvas.lineWidth = 1.6;
      canvas.beginPath();
      canvas.arc(seen.x, seen.y, radius + REACHED, 0, Math.PI * 2);
      canvas.stroke();
    }

    if (showLabels && !dimmed && rise > 0.5) {
      // What a cluster is about is named brightly; what is in it is named quietly, so a crowded
      // arm reads as one thing with parts rather than as a heap of words.
      canvas.globalAlpha = shown * rise * depth * (heads(about) ? 0.85 : 0.4);
      canvas.fillStyle = shade(INK.periwinkle, 0.95);
      canvas.font = `${about.kind === "note" ? 10 : 11}px ui-sans-serif, system-ui, sans-serif`;
      canvas.textAlign = "center";
      canvas.fillText(about.label, seen.x, seen.y - radius - 7);
    }
  
  };

  for (const bundle of bundles.values()) {
    stroked(canvas, bundle.path, bundle.strength, bundle.width, crowd);
  }
  for (const piece of orbs) orb(piece.node);

  // The middle is not named. It is the whole, and the one thing on screen that needs no label.
  if (core) {
    const seen = screen.at(core.id)!;
    const about = scene.drawn.get(core.id)!;
    const rise = scene.rise(core.id);
    const onScreen =
      seen.x >= -90 && seen.y >= -90 && seen.x <= size.width + 90 && seen.y <= size.height + 90;
    if (rise > 0.01 && onScreen) {
      const dimmed = near !== undefined && !near.has(core.id);
      const radius = sizeOf(about, seen, camera, rise);
      drawCore(canvas, seen, radius, scene.moment, shown * rise * (dimmed ? 0.45 : 1));
    }
  }

  canvas.globalAlpha = 1;
}

/// Which orb is under a point, if any. Nearest to the eye wins, so an orb passing in front of
/// another is the one that gets picked, exactly as it looks.
export function nodeAt(
  point: { x: number; y: number },
  nodes: Node[],
  drawn: Map<string, Drawn>,
  screen: Screen,
  camera: Camera,
  rise: (id: string) => number = () => 1,
  /// How far past an orb still counts as reaching for it. A pointer is aimed and gets none of
  /// this; a hand in the air cannot hold still to a pixel and would otherwise catch nothing but
  /// the largest thing on screen.
  slack = 0,
): Node | undefined {
  let found: Node | undefined;
  let nearest = -Infinity;
  let reached: Node | undefined;
  let closest = Infinity;
  const scale = orbScale(crowding(nodes.length));

  for (const node of nodes) {
    const about = drawn.get(node.id);
    const seen = screen.at(node.id);
    if (!about || !seen) continue;

    const radius = sizeOf(about, seen, camera, Math.max(0.4, rise(node.id)), scale);
    const away = Math.hypot(seen.x - point.x, seen.y - point.y);
    if (away <= radius + TOUCH && seen.depth > nearest) {
      nearest = seen.depth;
      found = node;
    }
    if (away <= radius + slack && away < closest) {
      closest = away;
      reached = node;
    }
  }

  // What is actually under the point wins, so a crowd is picked through rather than snapped past.
  return found ?? reached;
}
