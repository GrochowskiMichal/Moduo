import { Component, type ComponentType, lazy, type ReactNode, Suspense, useState } from "react";

import { Button } from "../../components/ui/button";

/**
 * A Settings section loaded as its own chunk. A plain `React.lazy` keeps a
 * failed import forever, so a section opened offline (the web app has no
 * service worker: the chunk is fetched on first open) stayed broken after the
 * network came back. This one forgets a failed load, so Retry imports again.
 */
export type LazySection = {
  current: () => ComponentType;
  reset: () => void;
};

export function lazySection(load: () => Promise<ComponentType>): LazySection {
  const make = () => lazy(() => load().then((C) => ({ default: C })));
  let current = make();
  return {
    current: () => current,
    reset: () => {
      current = make();
    },
  };
}

type BoundaryProps = { onRetry: () => void; children: ReactNode };

class SectionBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="mx-auto flex w-full max-w-3xl flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          This section couldn't load. Check your connection and try again.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            this.props.onRetry();
            this.setState({ failed: false });
          }}
        >
          Retry
        </Button>
      </div>
    );
  }
}

/**
 * Renders a section, eager or lazy. A lazy one that fails to load shows a
 * Retry inside Settings instead of taking the whole app down.
 */
export function SettingsSectionView({ section }: { section: ComponentType | LazySection }) {
  const [, setAttempt] = useState(0);
  if (!("current" in section)) {
    const Eager = section;
    return <Eager />;
  }
  const Section = section.current();
  return (
    <SectionBoundary
      onRetry={() => {
        section.reset();
        setAttempt((n) => n + 1);
      }}
    >
      <Suspense fallback={null}>
        <Section />
      </Suspense>
    </SectionBoundary>
  );
}
