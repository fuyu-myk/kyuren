import type { Called } from "#agent/loop.ts";
import type { Route } from "#model/route.ts";
import type { Spent } from "#playbook/runlog.ts";

export type Unfinished = {
  called: Called[];
  route: Route;
  model: string;
  exposed?: boolean;
  /// What the steps it did finish cost.
  spent?: Spent;
};

/// A turn that failed part way, with what it had already done: its calls were made all the same,
/// and a run that has to say it failed says what it did first, what that cost, and whether it read
/// the notes.
export class TurnFailed extends Error {
  readonly called: Called[];
  readonly route: Route;
  readonly model: string;
  readonly exposed: boolean;
  readonly spent: Spent | undefined;

  constructor(reason: string, so: Unfinished) {
    super(reason);
    this.called = so.called.map((one) => ({ ...one }));
    this.route = so.route;
    this.model = so.model;
    this.exposed = so.exposed === true;
    this.spent = so.spent;
  }
}
