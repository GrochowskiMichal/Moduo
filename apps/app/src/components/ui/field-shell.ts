import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Shared field chrome for text-entry controls (Input, Textarea, SelectTrigger).
 * Owns the surface, border, focus/invalid/disabled states, typography and
 * radius so the three primitives stay identical. Height + horizontal padding
 * stay with each component (they differ: input/select are single-line with a
 * height token, textarea grows).
 *
 * Variants:
 * - `filled` (default) — a visible well: bg-input + hairline border. Crisp,
 *   for standalone forms.
 * - `ghost` — borderless/transparent at rest; a hairline + the hover fill
 *   appear on hover, the focus edge on focus. The quiet, Linear-style
 *   inline-edit field.
 * - `bare` — no chrome at all (transparent, no border/shadow); for inline title
 *   and rename editors that must look like plain text until focused.
 *
 * Focus (MOD-160): a field marks focus on its own edge, the 1 px border turning
 * the focus colour (`--ring` at 50%), with no halo. The 2 px ring is the
 * keyboard's mark on buttons, rows and menu triggers, and a text field matches
 * `:focus-visible` on every click too, so a field ringed like them showed the
 * keyboard's mark to every mouse user (shadcn's input default). `bare` has no
 * edge to brighten, so it keeps that ring. Invalid pairs a destructive border
 * with a faint destructive ring.
 */
export const fieldShellVariants = cva(
  cn(
    "w-full min-w-0 rounded-md font-sans text-base text-foreground",
    "placeholder:text-muted-foreground",
    "outline-none transition-[color,background-color,border-color,box-shadow] duration-(--motion-fade) ease-(--ease-out)",
    "selection:bg-primary selection:text-primary-foreground",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/40",
  ),
  {
    variants: {
      variant: {
        filled: "border border-border bg-input focus-visible:border-ring/50",
        ghost: cn(
          "border border-transparent bg-transparent",
          "hover:border-hairline hover:bg-state-hover",
          "focus-visible:border-ring/50 focus-visible:bg-state-hover",
        ),
        bare: "border-0 bg-transparent shadow-none focus-visible:ring-2 focus-visible:ring-ring/50",
      },
    },
    defaultVariants: {
      variant: "filled",
    },
  },
);

/**
 * The same focus edge for a composite field whose chrome is a wrapper around
 * a bare text control (a comment box, a tag input): the wrapper's border turns
 * the focus colour while the text control inside it has focus, not when one of
 * its buttons does.
 */
export const FIELD_FOCUS_WITHIN = "has-[:is(input,textarea):focus]:border-ring/50";

export type FieldShellVariant = NonNullable<VariantProps<typeof fieldShellVariants>["variant"]>;
