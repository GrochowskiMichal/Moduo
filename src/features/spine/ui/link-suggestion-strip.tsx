// Connective-tissue spine — the LinkSuggestionStrip (block CT-6).
//
// A quiet, one-tap affordance at the top of an EntityHub: the single highest-
// ranked deterministic suggestion ("Link to Acme Corp? · Same email domain")
// with Link (accept → entity_link origin='suggest') and Dismiss (remembered).
// Max one at rest; nothing rendered when there is none; never auto-applied; no
// sparkle (AC11, AC14). Neutral monochrome type icon — accent appears only on
// the one primary action, the Link button (R5). Tokens only.
//
// `LinkSuggestionStrip` is presentational + controlled; `EntityLinkSuggestions`
// wires it to `useLinkSuggestions` for live mounting (CT-7 composes it above the
// hub, since the hub itself isn't mounted on a live surface until Tasks adopts
// the spine).

import { Button } from "@/components/ui/button";
import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { cn } from "@/lib/utils";
import { useLinkSuggestions } from "../hooks/use-link-suggestions";
import { resolveEntityIcon } from "../icon-map";
import { type LinkSuggestion, suggestionReason } from "../suggest";

export type LinkSuggestionStripProps = {
  /** The suggestion to show, or null to render nothing (max one at rest). */
  suggestion: LinkSuggestion | null;
  busy?: boolean;
  onAccept?: () => void;
  onDismiss?: () => void;
  className?: string;
};

export function LinkSuggestionStrip({
  suggestion,
  busy = false,
  onAccept,
  onDismiss,
  className,
}: LinkSuggestionStripProps) {
  if (!suggestion) return null; // nothing at rest — never an empty box
  const Icon = resolveEntityIcon(suggestion.other.type, suggestion.icon);

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm",
        className,
      )}
    >
      <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-foreground">
        Link to <span className="font-medium">{suggestion.label}</span>?
        <span className="ml-1 text-xs text-muted-foreground">· {suggestionReason(suggestion)}</span>
      </span>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onDismiss}>
        Dismiss
      </Button>
      <Button type="button" size="sm" disabled={busy} onClick={onAccept}>
        Link
      </Button>
    </div>
  );
}

export type EntityLinkSuggestionsProps = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  focus: EntityRef | null;
  /** Called after a suggestion is accepted (so the hub can reload its links). */
  onLinked?: () => void;
  className?: string;
};

/**
 * Live strip: fetches + scores suggestions for the focus entity and renders the
 * top one with optimistic accept / dismiss. Mount above the EntityHub.
 */
export function EntityLinkSuggestions({
  runtime,
  workspaceId,
  focus,
  onLinked,
  className,
}: EntityLinkSuggestionsProps) {
  const { current, busy, accept, dismiss } = useLinkSuggestions(
    runtime,
    workspaceId,
    focus,
    onLinked,
  );
  return (
    <LinkSuggestionStrip
      suggestion={current}
      busy={busy}
      onAccept={() => void accept()}
      onDismiss={() => void dismiss()}
      className={className}
    />
  );
}
