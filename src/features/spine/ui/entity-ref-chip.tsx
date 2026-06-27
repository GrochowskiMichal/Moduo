// Connective-tissue spine — the neutral EntityRefChip (block CT-4).
//
// Mirrors TagChip's borderless inline *layout*, but is MONOCHROME by design: a
// type glyph + label, no `data-label`, no hue (DESIGN_BRIEF Component Inventory;
// DESIGN_RULES R5 — color stays reserved for tags + status). The type icon, not
// color, distinguishes a task from a contact. Rendered in prose by the Lexical
// `EntityRefNode`, in `@mention` / `/ref` picker results, and in property
// values. Tombstoned targets render struck-through + dimmed ("Deleted [type]").

import type { MouseEventHandler } from "react";
import { cn } from "@/lib/utils";
import { resolveEntityIcon } from "../icon-map";

export type EntityRefChipProps = {
  /** The polymorphic entity type — drives the type glyph. */
  type: string;
  label: string;
  /** Registry icon hint; falls back to the type glyph. */
  icon?: string | null;
  /** A deleted target — render dimmed + struck-through (no link gestures). */
  tombstoned?: boolean;
  /** Makes the chip a button (e.g. deep-link to the entity's hub). */
  onClick?: MouseEventHandler<HTMLElement>;
  /** Renders a trailing ✕ that detaches the ref. */
  onRemove?: () => void;
  className?: string;
};

export function EntityRefChip({
  type,
  label,
  icon,
  tombstoned,
  onClick,
  onRemove,
  className,
}: EntityRefChipProps) {
  const Icon = resolveEntityIcon(type, icon);
  const a11yLabel = tombstoned ? `Deleted ${type}: ${label}` : `${type}: ${label}`;
  const body = (
    <>
      <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
    </>
  );
  const surface = cn(
    "inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 align-baseline text-sm text-foreground",
    tombstoned && "text-muted-foreground line-through opacity-70",
  );

  return (
    <span className={cn("inline-flex max-w-full items-center gap-0.5", className)}>
      {onClick ? (
        <button
          type="button"
          aria-label={a11yLabel}
          onClick={onClick}
          className={cn(
            surface,
            "transition-colors duration-(--motion-fade) ease-(--ease-out)",
            "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {body}
        </button>
      ) : (
        <span aria-label={a11yLabel} className={surface}>
          {body}
        </span>
      )}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={cn(
            "flex size-3.5 shrink-0 items-center justify-center rounded-full text-muted-foreground",
            "transition-colors duration-(--motion-fade) ease-(--ease-out)",
            "hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
