// Connective-tissue spine — the quiet "Link?" suggestion strip (block CT-6).
//
// Presentational + controlled: it renders the single at-rest suggestion (max one
// — AC11) and offers one-tap Link / dismiss. Data + handlers come from
// `useLinkSuggestions`; this file owns only the look. Neutral and monochrome —
// the type icon (not color) distinguishes the target, the reason is paired with
// an icon + label (never color-only), and the pink accent is reserved (R5). It
// reads as ambient, never a wall (DESIGN_BRIEF Experience Principle 3).

import { Link2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import type { EntityRef } from "@/lib/entity-links";
import { resolveEntityIcon } from "../icon-map";
import { suggestionReason, type LinkSuggestion } from "../suggest";

export type LinkSuggestionStripProps = {
  /** The single suggestion to show, or null to render nothing. */
  suggestion: LinkSuggestion | null;
  /** Persist the suggested link (origin='suggest'). */
  onAccept: () => void;
  /** Record a "no" so the pair is never re-offered. */
  onDismiss: () => void;
  /** Open the suggested target's hub (optional). */
  onOpen?: (ref: EntityRef) => void;
  /** A mutation is in flight — disables both actions. */
  busy?: boolean;
  className?: string;
};

export function LinkSuggestionStrip({
  suggestion,
  onAccept,
  onDismiss,
  onOpen,
  busy = false,
  className,
}: LinkSuggestionStripProps) {
  if (!suggestion) return null;

  const TargetIcon = resolveEntityIcon(suggestion.target.type, suggestion.icon);
  const reason = suggestionReason(suggestion.signals);

  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-md border border-dashed border-border bg-card px-2.5 py-2 text-sm",
        className,
      )}
    >
      <Link2 className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
      <button
        type="button"
        onClick={() => onOpen?.(suggestion.target)}
        disabled={!onOpen}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          onOpen ? "cursor-pointer" : "cursor-default",
        )}
      >
        <TargetIcon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate text-foreground">{suggestion.label}</span>
        <span className="min-w-0 shrink truncate text-xs text-muted-foreground">· {reason}</span>
      </button>

      <Button type="button" size="sm" variant="secondary" onClick={onAccept} disabled={busy}>
        Link
      </Button>
      <IconButton
        icon={X}
        label="Dismiss suggestion"
        tooltip="Dismiss"
        size="sm"
        variant="ghost"
        onClick={onDismiss}
        disabled={busy}
        className="shrink-0"
      />
    </div>
  );
}
