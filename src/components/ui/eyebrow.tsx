import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * The ONE section-eyebrow spec (DESIGN_RULES R4): body face at `text-2xs` —
 * the display face reads too large at 11px — medium weight, uppercase, wide
 * tracking, muted. Before DF-18 this string was written ~4 ways across the app
 * (`text-xs` in Notes/Settings/notifications, `font-display` in Execute, and a
 * `text-xs uppercase` dialect inside the shadcn menu primitives); extracting it
 * is what stops it drifting again.
 *
 * Every small-caps label in the app routes through here — including the ones
 * that aren't section headers, so there is exactly one place the 11px small-caps
 * spec lives (the `eyebrow drift guard` test enforces that):
 * - `default` — a section/group header.
 * - `muted` — a sub-header nested under another eyebrow (calendar rail accounts).
 * - `tag` — the trailing entity-kind tag on a row ("PERSON", "REFERENCES") and
 *   inline metadata prefixes. Same type, quieter weight: it labels the row it
 *   sits in, so it must not compete with the row's own text.
 * - `strong` — the rare label that IS the emphasis, not a quiet header: the
 *   recovery-phrase heading on the auth screen, the badge naming an embedded
 *   canvas. Heavier weight + wider tracking, still on the one 11px step — this
 *   exists so "make it louder" stays inside the spec instead of forking it into
 *   another `text-xs font-bold tracking-widest` one-off. Use it sparingly.
 *
 * Use `eyebrowVariants()` directly when the recipe has to live on a control
 * that already owns its element (a collapsible section `<button>`).
 */
const eyebrowVariants = cva("font-sans text-2xs font-medium uppercase tracking-wide", {
  variants: {
    tone: {
      default: "text-muted-foreground",
      muted: "text-muted-foreground/70",
      tag: "font-normal text-muted-foreground/70",
      strong: "font-semibold tracking-widest text-muted-foreground",
      /** Colour comes from the parent (selected/hover states own it). */
      inherit: "",
    },
  },
  defaultVariants: { tone: "default" },
});

/** Tags an eyebrow is allowed to render as — label semantics only, never a control. */
type EyebrowTag = "span" | "div" | "p" | "h2" | "h3" | "h4" | "dt";

type EyebrowProps = React.ComponentProps<"span"> &
  VariantProps<typeof eyebrowVariants> & {
    /** Keep the heading/definition-list semantics of the markup it replaces. */
    as?: EyebrowTag;
    /** For an element that carries its own props (a `<label htmlFor>`). */
    asChild?: boolean;
  };

function Eyebrow({ className, tone, as = "span", asChild = false, ...props }: EyebrowProps) {
  const Comp = asChild ? Slot.Root : (as as React.ElementType);
  return <Comp data-slot="eyebrow" className={cn(eyebrowVariants({ tone }), className)} {...props} />;
}

export { Eyebrow, eyebrowVariants };
