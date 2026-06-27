// Connective-tissue spine — the auto-suggest data hook (block CT-6).
//
// Fetches deterministic candidates for the focus entity, runs them through the
// pure `buildSuggestions` scorer, and exposes the single at-rest suggestion plus
// one-tap `accept` / `dismiss` (AC11). Accept calls the existing
// `createLink(origin='suggest')`; dismiss records a decline so the pair never
// returns. Graceful-degrade: `links_suggest` is a NEW RPC on a read path, so the
// fetch is wrapped — until the migration deploys the call 404s and we simply show
// no strip rather than break the host surface (gotchas: new RPC on a hot read).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import {
  acceptSuggestionInput,
  buildSuggestions,
  selectTopSuggestion,
  type LinkSuggestion,
  type SuggestionCandidate,
} from "../suggest";

export type LinkSuggestionsStatus = "loading" | "ready" | "error";

export type UseLinkSuggestionsResult = {
  status: LinkSuggestionsStatus;
  /** The single suggestion to show at rest (max one — AC11), or null. */
  suggestion: LinkSuggestion | null;
  /** How many ranked suggestions remain (incl. the current one). */
  remaining: number;
  /** A mutation (accept/dismiss) is in flight — disable the strip's controls. */
  busy: boolean;
  /** Persist the current suggestion as a link (origin='suggest'), then advance. */
  accept: () => Promise<void>;
  /** Record a "no" for the current pair, then advance. */
  dismiss: () => Promise<void>;
};

const EMPTY: SuggestionCandidate[] = [];

export function useLinkSuggestions(
  runtime: ModuoRuntime | null,
  workspaceId: string | null,
  focus: EntityRef | null,
  opts?: { canEdit?: boolean; focusLabel?: string; focusIcon?: string | null },
): UseLinkSuggestionsResult {
  const canEdit = opts?.canEdit ?? false;
  const focusLabel = opts?.focusLabel;
  const focusIcon = opts?.focusIcon ?? null;

  const [status, setStatus] = useState<LinkSuggestionsStatus>("loading");
  const [candidates, setCandidates] = useState<SuggestionCandidate[]>(EMPTY);
  // Pairs resolved this session (accepted or declined) — hidden optimistically
  // so the strip advances immediately without waiting for a re-fetch.
  const [resolved, setResolved] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  const focusType = focus?.type ?? null;
  const focusId = focus?.id ?? null;

  useEffect(() => {
    // No edit access → no link gestures at all (mirrors the hub; AC11/edge cases).
    if (!runtime || !workspaceId || !focusType || !focusId || !canEdit) {
      setCandidates(EMPTY);
      setResolved(new Set());
      setStatus("ready");
      return;
    }
    let active = true;
    setStatus("loading");
    setResolved(new Set());
    void (async () => {
      try {
        const rows = await runtime.spine.suggestLinks({
          workspaceId,
          entityType: focusType,
          entityId: focusId,
        });
        if (!active) return;
        setCandidates(rows);
        setStatus("ready");
      } catch {
        // New RPC not yet deployed (or a transient read error): degrade to no
        // strip rather than surfacing an error on a passive, ambient surface.
        if (!active) return;
        setCandidates(EMPTY);
        setStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [runtime, workspaceId, focusType, focusId, canEdit]);

  const ranked = useMemo(() => {
    if (!focusType || !focusId) return [];
    const built = buildSuggestions({ type: focusType, id: focusId }, candidates);
    return built.filter((s) => !resolved.has(s.pairKey));
  }, [candidates, resolved, focusType, focusId]);

  const suggestion = selectTopSuggestion(ranked);

  const resolve = useCallback((pairKey: string) => {
    setResolved((prev) => {
      const next = new Set(prev);
      next.add(pairKey);
      return next;
    });
  }, []);

  const unresolve = useCallback((pairKey: string) => {
    setResolved((prev) => {
      if (!prev.has(pairKey)) return prev;
      const next = new Set(prev);
      next.delete(pairKey);
      return next;
    });
  }, []);

  const accept = useCallback(async () => {
    if (!runtime || !workspaceId || !focus || !suggestion || busy) return;
    resolve(suggestion.pairKey); // optimistic advance
    setBusy(true);
    try {
      await runtime.spine.createLink({
        workspaceId,
        ...acceptSuggestionInput(focus, suggestion, { focusLabel, focusIcon }),
      });
    } catch (err) {
      unresolve(suggestion.pairKey); // revert — the suggestion comes back
      throw err;
    } finally {
      setBusy(false);
    }
  }, [runtime, workspaceId, focus, suggestion, busy, resolve, unresolve, focusLabel, focusIcon]);

  const dismiss = useCallback(async () => {
    if (!runtime || !workspaceId || !focus || !suggestion || busy) return;
    resolve(suggestion.pairKey); // optimistic advance
    setBusy(true);
    try {
      await runtime.spine.declineSuggestion({
        workspaceId,
        source: focus,
        target: suggestion.target,
      });
    } catch (err) {
      unresolve(suggestion.pairKey); // revert — the suggestion comes back
      throw err;
    } finally {
      setBusy(false);
    }
  }, [runtime, workspaceId, focus, suggestion, busy, resolve, unresolve]);

  return { status, suggestion, remaining: ranked.length, busy, accept, dismiss };
}
