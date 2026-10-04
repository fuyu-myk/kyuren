/// The turns in progress, each under the name whoever started it gave it, so that one can be
/// stopped. A turn begun under a name already in use stops the one before it, as a new question
/// replaces an old one.
export class Turns {
  private readonly running = new Map<string, AbortController>();

  begin(id: string): AbortController {
    this.running.get(id)?.abort();
    const controller = new AbortController();
    this.running.set(id, controller);
    return controller;
  }

  stop(id: string): boolean {
    const controller = this.running.get(id);
    controller?.abort();
    return controller !== undefined;
  }

  /// A turn that has ended lets go of its name, unless a newer turn has taken the name since.
  end(id: string, controller: AbortController): void {
    if (this.running.get(id) === controller) this.running.delete(id);
  }
}
