// The widget's code (stage, picker, cards) loads only when a Soundspace is on
// the page, so it stays out of the first-load bundle. The engine and its sound
// generators load later still, on first play (`../store.ts`).

import { lazy, Suspense } from "react";

import type { WidgetComponentProps } from "../../dashboard/registry/types";

const SoundspaceWidget = lazy(() =>
  import("./soundspace-widget").then((m) => ({ default: m.SoundspaceWidget })),
);

export function SoundspaceWidgetLazy(props: WidgetComponentProps) {
  return (
    <Suspense fallback={null}>
      <SoundspaceWidget {...props} />
    </Suspense>
  );
}
