import type { Called } from "#agent/loop.ts";
import type { Route } from "#model/route.ts";

/// A turn that failed part way, with what it had already done: its calls were made all the same,
/// and a run that has to say it failed says what it did first, and whether it read the notes.
export class TurnFailed extends Error {
  readonly called: Called[];
  readonly route: Route;
  readonly model: string;
  readonly exposed: boolean;

  constructor(reason: string, called: Called[], route: Route, model: string, exposed = false) {
    super(reason);
    this.called = called.map((one) => ({ ...one }));
    this.route = route;
    this.model = model;
    this.exposed = exposed;
  }
}
