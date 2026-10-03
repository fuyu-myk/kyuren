import type { Point } from "./space.ts";

export type Grip = "pinch" | "point" | "one" | "open" | "fist" | "unsure";

/// One hand as the perception sidecar saw it: where it is aiming, what it is doing, and its
/// joints as pairs of numbers across the camera's view, wrist first. No image of it ever
/// arrives here.
export type Reading = {
  x: number;
  y: number;
  hand: number[];
  grip: Grip;
  pinch: number;
  /// The other hand, when two are in view. It holds rather than aims.
  other?: Reading;
};

export type Intent =
  | { act: "grab"; at: Point }
  | { act: "move"; at: Point }
  | { act: "drop" }
  | { act: "read"; at: Point }
  | { act: "layer" }
  | { act: "idle" };

/// How long a hand must stay closed before it counts as asking for the next layer. A fist is easy
/// to make by accident on the way to somewhere else, and changing what the graph is showing is not
/// something to do by accident.
export const HELD = 15;

/// How many readings of an opened hand it takes to let go. A pinch held while the hand moves is
/// not perfectly steady, and one doubtful reading mid drag would drop what is being carried and
/// leave it wherever it happened to be, which is indistinguishable from not being able to drag.
export const RELEASE = 4;

const IDLE: Intent = { act: "idle" };

/// A hand, read as intent. One gesture is one request: a fist held closed asks for the next layer
/// once, not thirty times a second, and letting go of a node is not also asking for anything else.
///
/// The aim is taken as read. For a pinch it is the point between thumb and index, which the two
/// converge on as they close, so it holds still while the hand commits and needs no remembering.
export class Reaching {
  private holding = false;
  private closed = 0;
  private parted = 0;
  private last: Point | undefined;

  get held(): boolean {
    return this.holding;
  }

  /// Where the hand is aiming, as last seen.
  get aim(): Point | undefined {
    return this.last;
  }

  saw(seen: Reading | undefined): Intent {
    if (!seen) {
      const dropping = this.holding;
      this.forget();
      return dropping ? { act: "drop" } : IDLE;
    }

    if (seen.grip !== "fist") this.closed = 0;
    const at = { x: seen.x, y: seen.y };
    this.last = at;

    if (seen.grip === "pinch") {
      // One pinch reading in the middle of letting go pauses the release; it does not start it
      // over. Starting over is how a hand opening slowly through the threshold never lets go.
      this.parted = Math.max(0, this.parted - 1);
      if (this.holding) return { act: "move", at };
      this.holding = true;
      return { act: "grab", at };
    }

    // Anything that is not a pinch is letting go, and letting go is all it is: the gesture that
    // follows is asked for on its own frame rather than bundled into the release.
    if (this.holding) {
      this.parted += 1;
      if (this.parted < RELEASE) return { act: "move", at };
      this.holding = false;
      this.parted = 0;
      return { act: "drop" };
    }

    if (seen.grip === "fist") {
      this.closed += 1;
      return this.closed === HELD ? { act: "layer" } : IDLE;
    }

    if (seen.grip === "point") return { act: "read", at };

    return IDLE;
  }

  forget(): void {
    this.holding = false;
    this.closed = 0;
    this.parted = 0;
    this.last = undefined;
  }
}

/// A hand never reaches the corners of what the camera sees, so the middle of its view is
/// stretched to cover the whole window and anything past that is clamped to the edge. Without it
/// the far side of the graph would be unreachable without leaving the frame.
const SPREAD = 1.6;

export function onto(at: Point, size: { width: number; height: number }): Point {
  const put = (value: number) => Math.max(0, Math.min(1, (value - 0.5) * SPREAD + 0.5));
  return { x: put(at.x) * size.width, y: put(at.y) * size.height };
}
