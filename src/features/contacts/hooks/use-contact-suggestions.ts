// Contact-attributed link suggestions (block CO-4, AC7). Mirrors the spine's
// useLinkSuggestions, but **accept writes through contacts_op_link**
// (origin='suggest') so the action is attributed to Contacts; dismiss records the
// spine's per-pair decline. A failed read degrades to "no suggestion" so the
// strip never breaks the hub (the new-RPC-on-a-hot-path gotcha).

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { deriveLinkKey, type EntityRef } from "../../../lib/entity-links";
import {
  type LinkSuggestion,
  type RawLinkSuggestion,
  scoreSuggestions,
  topSuggestion,
} from "../../spine/suggest";
import { contactDeclineArgs, contactSuggestLinkArgs } from "../suggest-link";

export type ContactSuggestionsResult = {
  current: LinkSuggestion | null;
  busy: boolean;
  accept: () => Promise<void>;
  dismiss: () => Promise<void>;
  reload: () => void;
};

export function useContactSuggestions(
  runtime: ModuoRuntime | null,
  workspaceId: string | null,
  focus: EntityRef | null,
  onLinked?: () => void,
): ContactSuggestionsResult {
  const [raw, setRaw] = useState<RawLinkSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState<string[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const focusType = focus?.type ?? null;
  const focusId = focus?.id ?? null;

  const reload = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    if (!runtime || !workspaceId || !focusType || !focusId) return;
    let active = true;
    setResolved([]);
    void (async () => {
      try {
        const rows = await runtime.spine.suggestLinks({
          workspaceId,
          entityType: focusType,
          entityId: focusId,
        });
        if (active) setRaw(rows);
      } catch {
        if (active) setRaw([]); // a suggestion read must never break the hub
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
    (s: LinkSuggestion) => {
      if (!focusRef) return;
      const key = deriveLinkKey(focusRef, s.other);
      setResolved((prev) => (prev.includes(key) ? prev : [...prev, key]));
    },
    [focusRef],
  );

  const accept = useCallback(async () => {
    if (!runtime || !workspaceId || !focusRef || !current || busy) return;
    const s = current;
    const key = deriveLinkKey(focusRef, s.other);
    setBusy(true);
    setResolved((prev) => (prev.includes(key) ? prev : [...prev, key])); // optimistic advance
    try {
      await runtime.contacts.link({ workspaceId, ...contactSuggestLinkArgs(focusRef, s) });
      // A works-at → company accept also sets the denormalized company_id, so the
      // accept path matches the explicit "Set company" action (AC8 writes BOTH).
      if (
        focusRef.type === "contact" &&
        s.other.type === "company" &&
        s.suggestedKind === "works-at"
      ) {
        await runtime.contacts.updateContact({
          workspaceId,
          contactId: focusRef.id,
          setCompany: { companyId: s.other.id },
        });
      }
      onLinked?.();
    } catch (err) {
      setResolved((prev) => prev.filter((k) => k !== key)); // failed → re-surface it
      toast.error("Couldn’t add the link", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }, [runtime, workspaceId, focusRef, current, busy, onLinked]);

  const dismiss = useCallback(async () => {
    if (!runtime || !workspaceId || !focusRef || !current || busy) return;
    const s = current;
    setBusy(true);
    markResolved(s);
    try {
      await runtime.spine.declineSuggestion({ workspaceId, ...contactDeclineArgs(focusRef, s) });
    } catch (err) {
      toast.error("Couldn’t dismiss the suggestion", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }, [runtime, workspaceId, focusRef, current, busy, markResolved]);

  return { current, busy, accept, dismiss, reload };
}
