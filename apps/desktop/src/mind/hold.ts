import type { Reading } from "@/mind/reach";

/// How many readings without the raised finger it takes to lift the hold. A finger held up is not
/// read as up in every frame, and one doubtful frame would let the choice slip to whatever the
/// aiming hand happened to be over.
export const LET_GO = 6;

/// Whether the other hand is raising a finger: the shape of a one, or a point, which is the same
/// finger up with the thumb tucked in.
export function raised(seen: Reading | undefined): boolean {
  const grip = seen?.other?.grip;
  return grip === "one" || grip === "point";
}

/// The other hand holding the graph still. While it holds, what is lit stays lit and nothing else
/// is chosen, so a dense graph can be read along its links without the aim slipping. The hold
/// lifts when the finger comes down, or at once when no hand is in view at all.
export class Holding {
  private held = false;
  private doubted = 0;

  get holds(): boolean {
    return this.held;
  }

  saw(seen: Reading | undefined): boolean {
    if (!seen) {
      this.forget();
      return false;
    }
    if (raised(seen)) {
      this.held = true;
      this.doubted = 0;
      return true;
    }
    if (this.held) {
      this.doubted += 1;
      if (this.doubted >= LET_GO) this.forget();
    }
    return this.held;
  }

  forget(): void {
    this.held = false;
    this.doubted = 0;
  }
}
