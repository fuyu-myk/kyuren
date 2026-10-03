import type { Node } from "./simulation.ts";
import { look, type Camera, type Seen, type Size } from "./space.ts";
import { follow, start, type Trail } from "./trail.ts";

/// Where everything is drawn, which is a little behind where it now is.
///
/// The lag is the point: orbs sweep after the whirlpool as it turns instead of moving with it,
/// which is what makes an arrangement of circles read as something liquid.
export class Screen {
  private readonly trails = new Map<string, Trail>();
  private readonly shown = new Map<string, Seen>();

  place(nodes: Node[], camera: Camera, size: Size, seconds: number): void {
    const here = new Set<string>();

    for (const node of nodes) {
      here.add(node.id);
      const at = look(node, camera, size);
      const had = this.trails.get(node.id);
      const trail = had ? follow(had, at.x, at.y, seconds) : start(at.x, at.y);
      this.trails.set(node.id, trail);
      this.shown.set(node.id, { ...at, x: trail.x, y: trail.y });
    }

    for (const id of [...this.trails.keys()]) {
      if (here.has(id)) continue;
      this.trails.delete(id);
      this.shown.delete(id);
    }
  }

  /// Drops what it knew, so that a whirlpool shown again is not drawn sweeping in from wherever
  /// it happened to be when it was last put away.
  forget(): void {
    this.trails.clear();
    this.shown.clear();
  }

  at(id: string): Seen | undefined {
    return this.shown.get(id);
  }

  every(): Array<[string, Seen]> {
    return [...this.shown.entries()];
  }
}
