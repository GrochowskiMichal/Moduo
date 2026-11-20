// The inbound `?thread=` deep link (DF-2) on the web tissue view: a widget row /
// linked chip / notification opens a specific thread — via the URL (?thread=) or
// a one-shot in-app event. Both feed one pending target, applied once the tissue
// has loaded, which scrolls to and highlights its card. The id may be a raw
// threadId or an `email_thread` ref id (what spine links + the widget carry).
// The desktop engine page handles its own deep link (`MailPage`).

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { takeEntityOpenIntent } from "../../../lib/entity-open";
import type { EmailTissue } from "../hooks/use-email-tissue";
import { EMAIL_OPEN_THREAD_EVENT, resolveEmailThreadTarget } from "../url-search";

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
  email: Pick<EmailTissue, "loading" | "tissueRefs">;
};

/** Returns the web tissue card to highlight for a beat after a deep link. */
export function useEmailThreadDeepLink({
  urlThreadId,
  onConsumeThreadDeepLink,
  email,
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

  // Apply once the tissue has loaded (so a not-yet-loaded id isn't judged stale).
  useEffect(() => {
    if (!pendingThreadTarget || email.loading) return;
    const id = pendingThreadTarget;
    setPendingThreadTarget(null);
    const target = resolveEmailThreadTarget(id, { threads: [], refs: email.tissueRefs });
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
  }, [pendingThreadTarget, email.loading, email.tissueRefs]);

  // Clear the card highlight after a beat.
  useEffect(() => {
    if (!highlightedRefId) return;
    const t = window.setTimeout(() => setHighlightedRefId(null), 2000);
    return () => window.clearTimeout(t);
  }, [highlightedRefId]);
  return highlightedRefId;
}
