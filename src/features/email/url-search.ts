// /email URL search params + inbound thread-target resolution (DF-2, mirrors
// tasks DF-1). An inbound `?thread=<id>` (or a one-shot `moduo:email:open-thread`
// event) deep-links to a specific thread — worse than tasks to miss, because
// the inbox is a firehose (critique §4.6, CC-1). On desktop the page selects +
// scrolls the thread row; on web (no engine) it scrolls the thread's tissue
// card. The id can be a raw threadId OR a thread's `email_thread` entity/ref id
// (what the spine links + dashboard widget carry), so resolution accepts both.
//
// The file is named `url-search.ts` (not `search.ts`) because `email/search.ts`
// already owns the envelope full-text search.

export type EmailSearch = {
  thread?: string;
};

/** One-shot in-app request to open a specific email thread (DF-2). Carries a
 * raw threadId or an `email_thread` ref id — resolved the same way as
 * `?thread=`. Use when already on /email to select without a router round-trip
 * (or from a surface that shouldn't rewrite the URL). */
export const EMAIL_OPEN_THREAD_EVENT = "moduo:email:open-thread";

export function dispatchEmailOpenThread(id: string): void {
  if (typeof window === "undefined" || !id) return;
  window.dispatchEvent(new CustomEvent(EMAIL_OPEN_THREAD_EVENT, { detail: { id } }));
}

export function validateEmailSearch(search: Record<string, unknown>): EmailSearch {
  const thread =
    typeof search.thread === "string" && search.thread.length > 0 ? search.thread : undefined;
  return thread ? { thread } : {};
}

export type EmailThreadDeepLinkTarget =
  | { kind: "thread"; threadId: string; refId: string | null }
  | { kind: "none" };

/**
 * Resolve an inbound id to the raw `threadId` (for desktop list selection) and
 * the tissue `refId` (for the web card), accepting either form as input:
 * - a ref/entity id (`email_thread`) → its `threadKey` is the raw threadId;
 * - a raw threadId → its ref id, if that thread has been pulled into tissue.
 */
export function resolveEmailThreadTarget(
  id: string,
  ctx: {
    threads: ReadonlyArray<{ threadId: string }>;
    refs: ReadonlyArray<{ id: string; threadKey: string }>;
  },
): EmailThreadDeepLinkTarget {
  if (!id) return { kind: "none" };

  // Ref/entity id first — this is what spine links + the widget carry.
  const byRefId = ctx.refs.find((r) => r.id === id);
  if (byRefId) return { kind: "thread", threadId: byRefId.threadKey, refId: byRefId.id };

  // Raw threadId — select it directly; attach its ref id if it's tissue.
  const hasThread = ctx.threads.some((t) => t.threadId === id);
  const byThreadKey = ctx.refs.find((r) => r.threadKey === id);
  if (hasThread || byThreadKey) {
    return { kind: "thread", threadId: id, refId: byThreadKey?.id ?? null };
  }

  return { kind: "none" };
}
