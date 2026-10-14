import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The three density steps a kit story is shown at (DS-6, tasks-v3 AC14.1). The
 * density tokens live on `[data-density]` attribute selectors (tokens.css §7),
 * so a wrapper re-scopes everything under it, whatever the Storybook toolbar
 * sets on <html>.
 */
const DENSITIES = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
  { value: "dense", label: "Dense" },
] as const;

type Density = (typeof DENSITIES)[number]["value"];

/**
 * Renders `children` once per density, side by side (`row`) or stacked
 * (`column`, for wide pieces such as a toolbar). Each copy is wrapped in
 * `data-density` and `data-testid="density-<step>"`, which
 * `tests/visual/kit.spec.ts` reads. Pass a function to vary the content by step.
 */
function AtThreeDensities({
  children,
  direction = "row",
  className,
}: {
  children: React.ReactNode | ((density: Density) => React.ReactNode);
  direction?: "row" | "column";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex gap-8",
        direction === "row" ? "flex-row flex-wrap items-start" : "flex-col",
        className,
      )}
    >
      {DENSITIES.map(({ value, label }) => (
        <section
          key={value}
          data-density={value}
          data-testid={`density-${value}`}
          aria-label={label}
          className="flex min-w-0 flex-col gap-2"
        >
          <p className="font-sans text-xs text-muted-foreground">{label}</p>
          {typeof children === "function" ? children(value) : children}
        </section>
      ))}
    </div>
  );
}

export type { Density };
export { AtThreeDensities, DENSITIES };
