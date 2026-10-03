/// How long one orb takes to arrive or to leave, how long a whole whirlpool takes to finish
/// arriving, and how long it takes to go.
///
/// The spans are fixed rather than per orb: a thousand notes should bloom in the same moment a
/// dozen do, otherwise a full mind takes a minute to show itself. Leaving is the quicker of the
/// two, because waiting for something you have already dismissed is the worse wait.
export const RISE = 0.34;
export const SPAN = 0.55;
export const SHUT = 0.3;

export function smoothstep(x: number): number {
  const held = Math.max(0, Math.min(1, x));
  return held * held * (3 - 2 * held);
}

/// How much of each orb is here: nothing before it arrives, all of it once it has, and nothing
/// again once it has been sent away.
export class Presence {
  private readonly born = new Map<string, number>();
  private readonly going = new Map<string, number>();

  note(ids: string[], now: number): void {
    const arriving = ids.filter((id) => !this.born.has(id) || this.going.has(id));
    for (const [at, id] of arriving.entries()) {
      this.born.set(id, now + (at / Math.max(1, arriving.length)) * SPAN);
      this.going.delete(id);
    }
  }

  /// Sends orbs away, last first. Undoing an arrival in the order it happened would leave the
  /// middle of the whirlpool hanging there after its arms had gone.
  dismiss(ids: string[], now: number): void {
    const leaving = ids.filter((id) => this.born.has(id) && !this.going.has(id)).reverse();
    for (const [at, id] of leaving.entries()) {
      this.going.set(id, now + (at / Math.max(1, leaving.length)) * SHUT);
    }
  }

  of(id: string, now: number): number {
    const born = this.born.get(id);
    if (born === undefined) return 0;

    const here = smoothstep((now - born) / RISE);
    const goes = this.going.get(id);
    return goes === undefined ? here : Math.min(here, 1 - smoothstep((now - goes) / RISE));
  }

  /// What is on its way out but not yet gone, so it can still be drawn and still be drawn back in.
  leaving(now: number): string[] {
    return [...this.going.keys()].filter((id) => this.of(id, now) > 0);
  }

  /// Whether everything sent away has finished going.
  settled(now: number): boolean {
    return this.leaving(now).length === 0;
  }

  forget(): void {
    this.born.clear();
    this.going.clear();
  }
}
