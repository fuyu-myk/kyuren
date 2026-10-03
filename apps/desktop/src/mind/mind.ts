import { crowding, orbScale, roomFor } from "./crowd.ts";
import { LAYERS, type Layer } from "./palette.ts";
import { radiusOf, type Drawn, type Edge } from "./render.ts";
import { born, energy, reseed, step, type Node } from "./simulation.ts";
import { toward } from "./space.ts";
import type { Spot } from "./space.ts";
import { gather, whirl } from "./whirl.ts";

export type Incoming = {
  nodes: Drawn[];
  links: Edge[];
};

/// Kyuren itself, at the middle of its own mind. It is arranged and taken hold of exactly as
/// everything else is; the only thing it does differently is belong in the middle.
export const MIDDLE = "kyuren";

const KYUREN: Drawn = {
  id: MIDDLE,
  label: "Kyuren",
  layer: "capability",
  kind: "core",
  weight: 0,
};

/// How strongly an arm is held to the middle. Enough that dragging the middle brings the whirlpool
/// with it, loose enough that the arms trail rather than follow.
const SPOKE = 0.5;

/// How much of the canvas the whirlpool takes up. Seen from above at an angle it is an ellipse
/// rather than a circle, so it is given more room down the screen than across it.
const FILL = 0.46;
const SQUASH = 0.66;

/// The near arm is drawn larger than it is, so the room it needs is larger than its own width.
const PERSPECTIVE = 1.28;

/// How quickly an orb on its way out is drawn back into the middle.
const PULL = 4;

/// How many steps must pass with nothing moving before the arrangement is left alone, and how
/// little movement counts as none. A large mind at rest costs nothing to keep at rest.
const REST = 30;
const STILL = 0.05;

export function spanOf(size: { width: number; height: number }): number {
  const across = Math.min(size.width, size.height / SQUASH);
  return Math.max(200, (across * FILL) / PERSPECTIVE);
}

/// The state behind the whirlpool: what exists, where it belongs, and what is being looked at.
///
/// Kept apart from drawing and from the pointer so it can be arranged and asserted without a
/// canvas, which is the only way the awkward parts get tested at all.
export class Mind {
  private readonly placed = new Map<string, Node>();
  private readonly about = new Map<string, Drawn>([[MIDDLE, KYUREN]]);
  private edges: Edge[] = [];
  private spokes: Edge[] = [];
  private hidden = new Set<Layer>();
  private shown = new Set<string>([MIDDLE]);
  private threadsShown: Edge[] = [];
  private calm = false;
  private still = 0;
  private across = 420;
  focused: string | undefined;

  /// Takes what is known now and gives everything a place, reporting whatever is new.
  accept(incoming: Incoming): string[] {
    for (const one of incoming.nodes) this.about.set(one.id, one);

    const known = new Set(incoming.nodes.map((one) => one.id));
    for (const id of [...this.about.keys()]) {
      if (id === MIDDLE || known.has(id)) continue;
      this.about.delete(id);
      this.placed.delete(id);
    }

    this.edges = incoming.links.filter((one) => known.has(one.from) && known.has(one.to));
    if (this.focused && this.focused !== MIDDLE && !known.has(this.focused)) {
      this.focused = undefined;
    }

    return this.arrange();
  }

  /// Gives everything on show a place in the whirlpool.
  ///
  /// Only where each orb is going changes, never where it is: an arrangement that moved things
  /// outright would make a view read as a different mind rather than the same one, looked at
  /// differently.
  private arrange(): string[] {
    this.shown = this.reckon();
    const shown = [...this.about.values()].filter(
      (one) => one.id !== MIDDLE && this.shown.has(one.id),
    );
    const clusters = gather(
      shown.map((one) => ({ id: one.id, head: one.kind === "entity" || one.kind === "tool" })),
      this.edges,
    );

    // The middle is placed first so that it is the first thing to arrive and the last thing to go.
    const homes = new Map<string, Spot>([[MIDDLE, { x: 0, y: 0, lift: 0 }]]);
    const middle = radiusOf(0, "core");
    const crowd = crowding(shown.length);
    for (const [id, home] of whirl(clusters, this.across * roomFor(crowd), middle, crowd)) {
      homes.set(id, home);
    }

    const arriving: string[] = [];
    for (const [id, home] of homes) {
      const about = this.about.get(id);
      if (!about) continue;
      const size = radiusOf(about.weight, about.kind) * (id === MIDDLE ? 1 : orbScale(crowd));

      const had = this.placed.get(id);
      if (had) {
        had.home = home;
        had.size = size;
      } else {
        this.placed.set(id, born(id, home, size));
        arriving.push(id);
      }
    }

    this.spokes = clusters.map((one) => ({ from: MIDDLE, to: one.head, strength: SPOKE }));
    this.threadsShown = this.threads().filter(
      (one) => this.shown.has(one.from) && this.shown.has(one.to),
    );
    this.wake();
    return arriving;
  }

  private wake(): void {
    this.calm = false;
    this.still = 0;
  }

  /// Whether the arrangement has come to rest and is being left alone.
  resting(): boolean {
    return this.calm;
  }

  /// What is on show: the middle, everything on a layer that is on, and anyone who is in a note
  /// that is on show, whichever layer they belong to. A person is not filed under one folder.
  private reckon(): Set<string> {
    const shown = new Set<string>([MIDDLE]);
    for (const one of this.about.values()) {
      if (one.id !== MIDDLE && !this.hidden.has(one.layer)) shown.add(one.id);
    }
    for (const edge of this.edges) {
      for (const [self, other] of [[edge.from, edge.to], [edge.to, edge.from]] as const) {
        if (this.about.get(self)?.kind !== "entity") continue;
        if (shown.has(other) && this.about.get(other)?.kind === "note") shown.add(self);
      }
    }
    return shown;
  }

  /// Every thread in the mind: what it remembers about what, and what hangs off the middle.
  private threads(): Edge[] {
    return [...this.edges, ...this.spokes];
  }

  /// The whirlpool is sized to the window it is shown in, so it fills a large screen and still
  /// fits a small one.
  fill(across: number): void {
    if (Math.abs(across - this.across) < 1) return;
    this.across = across;
    this.arrange();
  }

  layers(): Layer[] {
    return LAYERS.filter((one) => !this.hidden.has(one));
  }

  showing(layer: Layer): boolean {
    return !this.hidden.has(layer);
  }

  /// Turns a layer on or off.
  toggle(layer: Layer): { left: string[]; returned: string[] } {
    const next = new Set(this.hidden);
    if (next.has(layer)) next.delete(layer);
    else next.add(layer);
    return this.apply(next);
  }

  /// One layer alone, or everything when none is named.
  only(layer: Layer | undefined): { left: string[]; returned: string[] } {
    return this.apply(new Set(LAYERS.filter((one) => layer !== undefined && one !== layer)));
  }

  /// Moves to another set of hidden layers, saying what has left and what has come back so that
  /// both can be seen happening. What returns is born in the middle again: it went back into
  /// Kyuren when it was put away, so that is where it has to come out of.
  private apply(hidden: Set<Layer>): { left: string[]; returned: string[] } {
    const before = this.shown;
    this.hidden = hidden;
    const after = this.reckon();
    const left = [...before].filter((id) => !after.has(id));
    const returned = [...after].filter((id) => !before.has(id));
    for (const id of returned) this.placed.delete(id);

    this.arrange();
    if (this.focused && !this.shown.has(this.focused)) this.focused = undefined;
    return { left, returned };
  }

  visible(): Node[] {
    return [...this.placed.values()].filter((node) => this.shown.has(node.id));
  }

  visibleEdges(): Edge[] {
    return this.threadsShown;
  }

  /// Everything that should be drawn: what is on show, and whatever is still on its way out.
  onStage(going: string[]): Node[] {
    const shown = this.visible();
    const here = new Set(shown.map((one) => one.id));
    for (const id of going) {
      const node = this.placed.get(id);
      if (node && !here.has(id)) shown.push(node);
    }
    return shown;
  }

  drawn(): Map<string, Drawn> {
    return this.about;
  }

  node(id: string): Node | undefined {
    return this.placed.get(id);
  }

  describe(id: string): Drawn | undefined {
    return this.about.get(id);
  }

  /// One step of the arrangement, over what is on show. Hidden layers are left where they are
  /// rather than being simulated out of sight, and once nothing moves, nothing is stepped until
  /// something is touched, shown or put away.
  settle(seconds: number): void {
    if (this.calm) return;
    const shown = this.visible();
    step(shown, this.threadsShown, seconds);

    if (energy(shown) < STILL) {
      this.still += 1;
      if (this.still >= REST) this.calm = true;
    } else {
      this.still = 0;
    }
  }

  /// Puts everything back in the middle, ready to be thrown out again.
  ///
  /// Being summoned should look like being summoned. Without this, a mind that has been shown once
  /// is found sitting where it was left, and only the dim over the screen ever animates.
  rewind(): void {
    for (const node of this.placed.values()) reseed(node);
    this.wake();
  }

  /// Draws orbs back into the middle as they go, which is their arrival run backwards.
  recall(ids: string[], seconds: number): void {
    for (const id of ids) {
      const node = this.placed.get(id);
      if (!node) continue;
      node.x = toward(node.x, 0, seconds, PULL);
      node.y = toward(node.y, 0, seconds, PULL);
      node.lift = toward(node.lift, 0, seconds, PULL);
      node.vx = 0;
      node.vy = 0;
    }
  }

  hold(id: string, x: number, y: number): void {
    const node = this.placed.get(id);
    if (!node) return;
    this.wake();
    node.pinned = true;
    node.x = x;
    node.y = y;
    node.vx = 0;
    node.vy = 0;
  }

  release(id: string): void {
    const node = this.placed.get(id);
    if (node) node.pinned = false;
    this.wake();
  }
}
