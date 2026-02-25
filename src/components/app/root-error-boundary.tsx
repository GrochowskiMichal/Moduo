import { Component, type ErrorInfo, type ReactNode } from "react";

type RootErrorBoundaryProps = {
  children: ReactNode;
};

type RootErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string | null;
};

export class RootErrorBoundary extends Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  state: RootErrorBoundaryState = {
    hasError: false,
    errorMessage: null,
  };

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || "Unexpected error",
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Root application error:", error, errorInfo);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6 text-zinc-100">
        <section className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
          <h1 className="text-xl font-semibold">App recovered from a runtime error</h1>
          <p className="mt-2 text-sm text-zinc-300">
            The interface hit an unexpected error (often during rapid layout transitions like
            fullscreen). Reload to continue.
          </p>
          {this.state.errorMessage ? (
            <pre className="mt-4 overflow-auto rounded-md bg-zinc-950 p-3 text-xs text-zinc-300">
              {this.state.errorMessage}
            </pre>
          ) : null}
          <button
            type="button"
            className="mt-5 rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200"
            onClick={this.handleReload}
          >
            Reload app
          </button>
        </section>
      </main>
    );
  }
}
