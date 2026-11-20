// Notices for a person's devices (TV-D12, `public.notice_deliveries`): the
// reminder sender writes one row per OS / browser notice. RLS lets each person
// read only their own, and the table is published, so a running app hears its
// own deliveries live, in whichever workspace it has open (REPLAN 80: reminders
// reach you in any workspace). Browsers that opted in get the same row as a Web
// Push through the push-send function.

import { normalizeNoticeDeliveryKind, type NoticeDeliveryKind } from "@contracts/vocabularies";

/** One notice for this person's devices. */
export type NoticeDelivery = {
  id: string;
  kind: NoticeDeliveryKind;
  workspaceId: string | null;
  taskId: string | null;
  title: string;
  body: string | null;
  /** An in-app path ("/tasks?id=…"), never an outside URL. */
  url: string | null;
  /** Chat (CV-6a): the conversation and message it is about. */
  channelId: string | null;
  messageId: string | null;
  /** A burst shares one tag ("chat:<conversation>"): a newer notice replaces the last. */
  tag: string | null;
  /** Written while a Focus run holds pings (CV-18): never rung. */
  heldForFocus: boolean;
  createdAt: string;
};

/** Chat's kinds: their title and text are built on the server for this person. */
export function isChatNotice(delivery: Pick<NoticeDelivery, "kind">): boolean {
  return delivery.kind.startsWith("chat_");
}

/** A Realtime insert's row as a delivery, or null when it doesn't read. */
export function noticeDeliveryFromRow(raw: unknown): NoticeDelivery | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.title !== "string" || typeof r.created_at !== "string") {
    return null;
  }
  const url = typeof r.url === "string" && r.url.startsWith("/") ? r.url : null;
  return {
    id: r.id,
    kind: normalizeNoticeDeliveryKind(r.kind),
    workspaceId: typeof r.workspace_id === "string" ? r.workspace_id : null,
    taskId: typeof r.task_id === "string" ? r.task_id : null,
    title: r.title,
    body: typeof r.body === "string" ? r.body : null,
    url,
    channelId: typeof r.channel_id === "string" ? r.channel_id : null,
    messageId: typeof r.message_id === "string" ? r.message_id : null,
    tag: typeof r.tag === "string" ? r.tag : null,
    heldForFocus: r.held_for_focus === true,
    createdAt: r.created_at,
  };
}

/** What a delivery says, in the app's words. */
export function noticeCopy(delivery: NoticeDelivery): { title: string; body: string } {
  switch (delivery.kind) {
    case "reminder":
      return { title: "Reminder", body: delivery.body ?? delivery.title };
    // TV-D16: "Claude is ready for review", and the task it's about.
    case "agent":
      return { title: delivery.title, body: delivery.body ?? "" };
    // CV-6a: "Sofia Ortiz · #plans · Acme" and the text (only while "Show
    // message text" is on), both written by the server for this person.
    case "chat_message":
    case "chat_mention":
    case "chat_reply":
    case "chat_announcement":
    case "chat_reminder":
    case "chat_focus_summary":
      return { title: delivery.title, body: delivery.body ?? "" };
  }
}

/**
 * Only the newest deliveries are shown when several arrive at once (a laptop
 * waking up after an hour): at most `limit`, newest first, each once.
 */
export function deliveriesToShow(
  incoming: NoticeDelivery[],
  shown: ReadonlySet<string>,
  limit = 3,
): NoticeDelivery[] {
  return incoming
    .filter((d) => !shown.has(d.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, limit);
}
