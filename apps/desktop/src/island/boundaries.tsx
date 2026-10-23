import { Component, Fragment, type ReactNode } from "react";
import { command } from "@/island/channels";

type PageProps = {
  children: ReactNode;
  /// What else to put back before the page is tried again, such as a place it could not be left.
  onRetry?: () => void;
};

/// A page that fails to draw says so in its place and is tried again when asked, while the island
/// around it, its tabs and every other page go on working.
export class PageBoundary extends Component<PageProps, { failed: string | null }> {
  state: { failed: string | null } = { failed: null };

  static getDerivedStateFromError(failure: unknown): { failed: string } {
    const said = failure instanceof Error ? failure.message || failure.name : String(failure);
    return { failed: said.split("\n")[0] ?? "" };
  }

  render() {
    if (this.state.failed === null) return this.props.children;
    return (
      <div className="view failed">
        <p className="empty">This page could not be shown: {this.state.failed}</p>
        <button
          type="button"
          onClick={() => {
            this.props.onRetry?.();
            this.setState({ failed: null });
          }}
        >
          try again
        </button>
      </div>
    );
  }
}

/// The longest the island waits to be started again, however often it has failed.
const LONGEST = 60_000;
/// Failures closer together than this count as failing again.
const TOGETHER = 120_000;

/// The island failing as a whole leaves nothing drawn, so the host is told it is gone, with no part
/// of the screen kept to catch clicks for it, no keyboard and no summons, and a short notice says
/// so. It is started again a second later, and twice as long after each time it fails again soon
/// after, so data it cannot draw is not tried as fast as it fails.
export class IslandBoundary extends Component<{ children: ReactNode }, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };
  private failures: number[] = [];
  private again: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(): void {
    for (const [name, args] of [
      ["island_rect", { x: 0, y: 0, width: 0, height: 0 }],
      ["island_mode", { shown: false }],
      ["island_focus", { on: false }],
      ["island_dismiss", undefined],
    ] as const) {
      void command(name, args).catch(() => undefined);
    }
    const now = Date.now();
    this.failures = [...this.failures.filter((at) => now - at < TOGETHER), now];
    clearTimeout(this.again);
    this.again = setTimeout(
      () => this.setState((was) => ({ failed: false, attempt: was.attempt + 1 })),
      Math.min(LONGEST, 1_000 * 2 ** (this.failures.length - 1)),
    );
  }

  componentWillUnmount(): void {
    clearTimeout(this.again);
  }

  render() {
    if (this.state.failed) return <p className="island-failed">The island ran into a problem and is starting again.</p>;
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
