// The inbound `?thread=` deep link (DF-2): a widget row / linked chip /
// notification opens a specific thread — via the URL (?thread=) or a one-shot
// in-app event. Both feed one pending target, applied once the inbox/tissue has
// loaded: desktop selects + scrolls the row; web scrolls its tissue card. The id
// may be a raw threadId or an `email_thread` ref id (what spine links + the
// widget carry).

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { takeEntityOpenIntent } from "../../../lib/entity-open";
import type { useEmailModule } from "../hooks/use-email-module";
import { EMAIL_OPEN_THREAD_EVENT, resolveEmailThreadTarget } from "../url-search";
import type { PanelVariantId } from "./email-page-types";
import type { EmailScope, EmailView } from "./email-rail";

/** Poll briefly for a deep-link target row/card (it renders after a scope reset
 * or the inbox load settles over a few frames), then scroll it into view.
 * `onDone(found)` fires once so the caller can degrade on a miss (DF-2). */
function revealBySelector(selector: string, onDone?: (found: boolean) => void): void {
  if (typeof document === "undefined") {
    onDone?.(false);
    return;
  }
  let tries = 0;
  const step = () => {
    const el = document.querySelector(selector);
    if (el) {
      el.scrollIntoView({ block: "center" });
      onDone?.(true);
      return;
    }
    if (++tries < 24) requestAnimationFrame(step);
    else onDone?.(false);
  };
  requestAnimationFrame(step);
}

type Input = {
  urlThreadId: string | null;
  /** Called once the deep link is applied (or found stale) so the page can clear the URL param. */
  onConsumeThreadDeepLink?: () => void;
  isDesktop: boolean;
  email: Pick<ReturnType<typeof useEmailModule>, "loading" | "threads" | "tissueRefs">;
  /** Land a thread where it renders: the inbox, no account scope or search filter. */
  clearSearch: () => void;
  setView: (view: EmailView) => void;
  setSelectedAccountId: (scope: EmailScope) => void;
  setSelectedThreadId: (id: string | null) => void;
  setPanelVariant: (variant: PanelVariantId) => void;
};

/** Returns the web tissue card to highlight for a beat after a deep link. */
export function useEmailThreadDeepLink({
  urlThreadId,
  onConsumeThreadDeepLink,
  isDesktop,
  email,
  clearSearch,
  setView,
  setSelectedAccountId,
  setSelectedThreadId,
  setPanelVariant,
}: Input): string | null {
  const [pendingThreadTarget, setPendingThreadTarget] = useState<string | null>(null);
  const [highlightedRefId, setHighlightedRefId] = useState<string | null>(null);
  const processedUrlThreadRef = useRef<string | null>(null);

  // URL → pending (consume-once, then clear the param; the id lives in state).
  useEffect(() => {
    if (!urlThreadId) {
      processedUrlThreadRef.current = null;
      return;
    }
    if (processedUrlThreadRef.current === urlThreadId) return;
    processedUrlThreadRef.current = urlThreadId;
    takeEntityOpenIntent(urlThreadId); // spend the "take me there" mark
    setPendingThreadTarget(urlThreadId);
    onConsumeThreadDeepLink?.();
  }, [urlThreadId, onConsumeThreadDeepLink]);

  // One-shot in-app event → pending (same resolution, no router round-trip).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpenThread = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id) setPendingThreadTarget(id);
    };
    window.addEventListener(EMAIL_OPEN_THREAD_EVENT, onOpenThread);
    return () => window.removeEventListener(EMAIL_OPEN_THREAD_EVENT, onOpenThread);
  }, []);

  // Apply once the inbox/tissue has loaded (so a not-yet-synced id isn't judged
  // stale prematurely).
  useEffect(() => {
    if (!pendingThreadTarget || email.loading) return;
    const id = pendingThreadTarget;
    setPendingThreadTarget(null);
    const target = resolveEmailThreadTarget(id, {
      threads: email.threads,
      refs: email.tissueRefs,
    });

    if (isDesktop) {
      const inInbox =
        target.kind === "thread" && email.threads.some((t) => t.threadId === target.threadId);
      if (!inInbox) {
        toast("Couldn't find that email", {
          description: "It may have been archived or isn't in this inbox.",
        });
        return;
      }
      // Land the row where it actually renders: the inbox view with no account
      // scope or search filter (sub-views / search results don't carry
      // `data-thread-id`, and a single-account scope would drop the selection
      // via the auto-clear effect above). Then select + scroll it into view.
      setView("inbox");
      clearSearch();
      setSelectedAccountId(null);
      setSelectedThreadId(target.threadId);
      setPanelVariant("reader");
      revealBySelector(`[data-thread-id="${CSS.escape(target.threadId)}"]`);
      return;
    }

    // Web: route to the thread's tissue card (its read-only web representation).
    const refId = target.kind === "thread" ? target.refId : null;
    if (!refId) {
      toast("Couldn't find that email here", {
        description: "It isn't among your linked emails — open Moduo on desktop to read it.",
      });
      return;
    }
    setHighlightedRefId(refId);
    revealBySelector(`[data-thread-ref-id="${CSS.escape(refId)}"]`, (found) => {
      if (!found) {
        toast("Open Moduo on desktop to read this email", {
          description: "It's linked here but not shown on the web view.",
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a loaded inbox or a new target is the cue; the setters and clearSearch are the page's
  }, [pendingThreadTarget, email.loading, email.threads, email.tissueRefs]);

  // Clear the web card highlight after a beat.
  useEffect(() => {
    if (!highlightedRefId) return;
    const t = window.setTimeout(() => setHighlightedRefId(null), 2000);
    return () => window.clearTimeout(t);
  }, [highlightedRefId]);
  return highlightedRefId;
}
