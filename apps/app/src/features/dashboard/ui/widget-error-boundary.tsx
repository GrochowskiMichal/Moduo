// DB-5 — per-widget error boundary (spec §States). A widget body that throws on
// render shows a quiet, retryable message inside its frame; the rest of the grid
// keeps working (one bad widget never takes the page down). Async read failures
// are handled by each source's `error` flag + empty state — this catches the
// render-time crash a data-shape surprise could cause.

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Bumping this (e.g. the widget id/size) resets the boundary after a swap. */
  resetKey?: string;
}

interface State {
  failed: boolean;
}

export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidUpdate(prev: Props): void {
    // A resize/instance swap resets so a transient crash can recover.
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("[dashboard] widget crashed", error, info.componentStack);
  }

  private retry = (): void => this.setState({ failed: false });

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid h-full place-items-center gap-1.5 px-3 text-center">
        <p className="text-sm text-muted-foreground">Couldn't load this widget.</p>
        <button
          type="button"
          onClick={this.retry}
          className="rounded-sm text-xs text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Try again
        </button>
      </div>
    );
  }
}
