// The reader's engine adapters: invites, RSVP, attachment files and
// unsubscribe over the optional `MailEngine` reader methods, so the real
// engine and the fixture drive the same cards. Each returns undefined when the
// engine lacks the method, which hides the matching control.

import { useEffect, useState } from "react";

import type {
  MailAttachment,
  MailAttachmentFile,
  MailEngine,
  MailInviteInfo,
  MailMessage,
  MailRsvp,
  MailUnsubscribeOutcome,
} from "@/lib/runtime.types.mail-engine";

import type { MailInvite, MailPartstat } from "./invite-card";

const RSVP: Record<MailPartstat, MailRsvp> = {
  ACCEPTED: "accept",
  TENTATIVE: "maybe",
  DECLINED: "decline",
};

/** The card's invite; RSVP buttons need an organizer, so a non-RSVP-able one drops it. */
export function toCardInvite(i: MailInviteInfo): MailInvite {
  return {
    uid: i.uid,
    method: i.method,
    summary: i.summary,
    startMs: i.startMs,
    endMs: i.endMs,
    location: i.location,
    organizer: i.canRsvp ? i.organizer : null,
    myStatus: i.myStatus,
  };
}

export function engineInviteLoader(engine: MailEngine | null, threadId: string) {
  const get = engine?.getInvite?.bind(engine);
  if (!get) return undefined;
  return async (messageId: string): Promise<MailInvite | null> => {
    const i = await get(threadId, messageId);
    return i ? toCardInvite(i) : null;
  };
}

export function engineRsvp(engine: MailEngine | null, threadId: string) {
  const rsvp = engine?.rsvp?.bind(engine);
  if (!rsvp) return undefined;
  return (messageId: string, status: MailPartstat) => rsvp(threadId, messageId, RSVP[status]);
}

/** The message that carries the newest List-Unsubscribe header. */
export function unsubscribeMessage(messages: readonly MailMessage[]): MailMessage | null {
  return [...messages].reverse().find((m) => m.listUnsubscribe) ?? null;
}

/** What the reader says after an unsubscribe, naming any fallback (AC19). */
export function unsubscribeNotice(o: MailUnsubscribeOutcome): string {
  if (o.method === "web") {
    return o.fellBack
      ? "One-click unsubscribe didn't work, so the unsubscribe page is open."
      : "The unsubscribe page is open.";
  }
  if (o.method === "mailto")
    return o.fellBack
      ? "One-click unsubscribe didn't work, so an unsubscribe email was sent."
      : "An unsubscribe email was sent.";
  return "Unsubscribed.";
}

/**
 * Engine-backed unsubscribe: tries one-click, asks before sending a mailto,
 * opens the web page last. Resolves to the notice to show.
 */
export async function runEngineUnsubscribe(
  engine: MailEngine,
  threadId: string,
  messageId: string,
  deps: { confirmMailto: () => Promise<boolean>; openUrl: (url: string) => void },
): Promise<string> {
  if (!engine.unsubscribe) throw new Error("Unsubscribe isn't available here.");
  const plan = (await engine.unsubscribePlan?.(threadId, messageId)) ?? [];
  const oneClick = plan.some((m) => m.kind === "oneClick");
  const hasMailto = plan.some((m) => m.kind === "mailto");
  // Ask before a mailto, and only once it is the method that would run.
  const allowMailto = hasMailto && !oneClick && (await deps.confirmMailto());
  let out = await engine.unsubscribe(threadId, messageId, { allowMailto });
  if (out.method === "web" && hasMailto && !allowMailto && oneClick && (await deps.confirmMailto()))
    out = await engine.unsubscribe(threadId, messageId, { allowMailto: true });
  if (out.method === "web" && out.url) deps.openUrl(out.url);
  return unsubscribeNotice(out);
}

/** Attachments up to this size are fetched as soon as their message opens,
 * so a Finder drag has a file URL ready; larger ones fetch on click. */
export const EAGER_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Local files for a thread's attachments: eager for small ones, `ensure` for the rest. */
export function useAttachmentFiles(
  engine: MailEngine | null,
  threadId: string | null,
  messages: readonly MailMessage[],
) {
  const [files, setFiles] = useState<Record<string, MailAttachmentFile>>({});
  const fetchFile = engine?.attachmentFile?.bind(engine);
  const ensure = async (a: MailAttachment): Promise<MailAttachmentFile | null> => {
    if (!fetchFile || !threadId) return null;
    if (files[a.id]) return files[a.id]!;
    const f = await fetchFile(threadId, a.id);
    setFiles((m) => ({ ...m, [a.id]: f }));
    return f;
  };
  const eagerKey = messages
    .flatMap((m) => m.attachments)
    .filter((a) => !a.isInline && a.size <= EAGER_ATTACHMENT_BYTES)
    .map((a) => a.id)
    .join(",");
  useEffect(() => {
    if (!fetchFile || !threadId || !eagerKey) return;
    let gone = false;
    for (const id of eagerKey.split(",")) {
      void fetchFile(threadId, id).then(
        (f) => !gone && setFiles((m) => (m[id] ? m : { ...m, [id]: f })),
        () => {},
      );
    }
    return () => {
      gone = true;
    };
    // fetchFile is a fresh bind each render; the engine identity is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, threadId, eagerKey]);
  return {
    available: Boolean(fetchFile),
    fileUrl: (a: MailAttachment) => files[a.id]?.fileUrl ?? null,
    previewUrl: (a: MailAttachment) => files[a.id]?.dataUrl ?? null,
    ensure,
  };
}
