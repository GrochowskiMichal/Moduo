// Connective-tissue spine — the LinkSuggestionStrip data hook (block CT-6).
//
// Fetches the deterministic server suggestions for a focus entity, scores them
// into one ranked queue, and exposes the single top suggestion plus optimistic
// accept / dismiss. Accept writes an `entity_link(origin='suggest')`; dismiss
// records a decline so the pair is never re-offered. A failed read degrades to
// "no suggestion" (a suggestion strip must never break the hub — gotchas: wrap a
// new RPC on a hot read path and degrade gracefully).

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { deriveLinkKey, type EntityRef } from "../../../lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { scoreSuggestions, topSuggestion, type LinkSuggestion, type RawLinkSuggestion } from "../suggest";

export type LinkSuggestionsStatus = "loading" | "ready" | "error";

export type UseLinkSuggestionsResult = {
  status: LinkSuggestionsStatus;
  /** The single suggestion to show at rest (max one), or null. */
  current: LinkSuggestion | null;
  busy: boolean;
  /** Accept the current suggestion → link with origin='suggest'. Optimistic. */
  accept: () => Promise<void>;
  /** Dismiss the current suggestion → record a decline (remembered). Optimistic. */
  dismiss: () => Promise<void>;
  /** Re-fetch suggestions (e.g. after the hub's links changed). */
  reload: () => void;
};

export function useLinkSuggestions(
  runtime: ModuoRuntime | null,
  workspaceId: string | null,
  focus: EntityRef | null,
  onLinked?: () => void,
): UseLinkSuggestionsResult {
  const [raw, setRaw] = useState<RawLinkSuggestion[]>([]);
  const [status, setStatus] = useState<LinkSuggestionsStatus>("loading");
  const [busy, setBusy] = useState(false);
  // Pairs resolved this session (accepted or declined) — optimistic suppression
  // so the queue advances instantly without waiting for a re-fetch.
  const [resolved, setResolved] = useState<string[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const focusType = focus?.type ?? null;
  const focusId = focus?.id ?? null;

  const reload = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    if (!runtime || !workspaceId || !focusType || !focusId) return;
    let active = true;
    setStatus("loading");
    setResolved([]);
    void (async () => {
      try {
        const rows = await runtime.spine.suggestLinks({
          workspaceId,
          entityType: focusType,
          entityId: focusId,
        });
        if (!active) return;
        setRaw(rows);
        setStatus("ready");
      } catch {
        // A suggestion read must never break the hub — degrade to none.
        if (active) {
          setRaw([]);
          setStatus("ready");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [runtime, workspaceId, focusType, focusId, refreshTick]);

  const focusRef = useMemo<EntityRef | null>(
    () => (focusType && focusId ? { type: focusType, id: focusId } : null),
    [focusType, focusId],
  );

  const suggestions = useMemo(
    () => (focusRef ? scoreSuggestions(focusRef, raw, { declinedPairKeys: resolved }) : []),
    [focusRef, raw, resolved],
  );

  const current = topSuggestion(suggestions);

  const markResolved = useCallback(
    (suggestion: LinkSuggestion) => {
      if (!focusRef) return;
      const key = deriveLinkKey(focusRef, suggestion.other);
      setResolved((prev) => (prev.includes(key) ? prev : [...prev, key]));
    },
    [focusRef],
  );

  const accept = useCallback(async () => {
    if (!runtime || !workspaceId || !focusRef || !current || busy) return;
    const suggestion = current;
    setBusy(true);
    markResolved(suggestion); // optimistic: advance the queue immediately
    try {
      await runtime.spine.createLink({
        workspaceId,
        source: focusRef,
        target: suggestion.other,
        relationKind: suggestion.suggestedKind,
        origin: "suggest",
        targetLabel: suggestion.label,
        targetIcon: suggestion.icon,
      });
      onLinked?.();
    } catch (err) {
      // The pair stays suppressed for this session; a reload re-surfaces it.
      toast.error("Couldn’t add the link", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }, [runtime, workspaceId, focusRef, current, busy, markResolved, onLinked]);

  const dismiss = useCallback(async () => {
    if (!runtime || !workspaceId || !focusRef || !current || busy) return;
    const suggestion = current;
    setBusy(true);
    markResolved(suggestion); // optimistic: advance the queue immediately
    try {
      await runtime.spine.declineSuggestion({
        workspaceId,
        source: focusRef,
        target: suggestion.other,
      });
    } catch (err) {
      toast.error("Couldn’t dismiss the suggestion", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }, [runtime, workspaceId, focusRef, current, busy, markResolved]);

  return { status, current, busy, accept, dismiss, reload };
}
