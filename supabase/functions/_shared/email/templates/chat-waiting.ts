/**
 * Chat · messages waiting after an hour away (CV-6a; specs/chat-v2.md §11,
 * CH43, CH74). Queued by `chat__queue_waiting_emails()` every 5 minutes: at
 * most one email per person, conversation and hour, for an unread direct
 * message, `@you` or `@Team` over an hour old while no Moduo has been open for
 * an hour, never for something that arrived while held.
 *
 * Subject: "Sofia Ortiz messaged you in Moduo Studio", or "3 messages are
 * waiting in Acme". Body: the sender, the conversation, the count, the text
 * only when the person keeps "Show message text" on (the job leaves it out
 * otherwise), one button "Open in Moduo".
 *
 * The payload is written by SQL in snake_case; `parseChatWaitingPayload`
 * checks it. Rendering depends on the payload alone, so a retry renders the
 * same email and Resend's idempotency key holds.
 */

import { CANONICAL_APP_ORIGIN } from "../../app-origin.ts";
import { singleLine } from "../../escape.ts";
import { button, type EmailDoc, heading, lockup, muted, paragraph, strong } from "../blocks.ts";

export type ChatWaitingData = {
  workspaceName: string;
  /** A direct message, or a channel (then `conversationName` is its name). */
  conversationKind: "dm" | "channel";
  conversationName: string | null;
  /** Who wrote the newest message (a person, or an app by its name). */
  senderName: string;
  /** How many messages addressed to the person are waiting there. */
  count: number;
  /** The newest message as one line; null when "Show message text" is off. */
  text: string | null;
  /** The in-app path to the newest message ("/chat?c=…&m=…"). */
  path: string;
};

/** The payload a queued row carries, checked. Throws on a shape the template can't render. */
export function parseChatWaitingPayload(payload: Record<string, unknown>): ChatWaitingData {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const workspaceName = str(payload.workspace_name);
  if (!workspaceName) throw new Error("chat_waiting: workspace_name missing");
  const conversationKind = payload.conversation_kind === "dm" ? "dm" : payload.conversation_kind === "channel" ? "channel" : null;
  if (!conversationKind) throw new Error("chat_waiting: conversation_kind missing");
  const count = typeof payload.count === "number" ? Math.floor(payload.count) : Number.NaN;
  if (!Number.isFinite(count) || count < 1) throw new Error("chat_waiting: count missing");
  const path = str(payload.path);
  // Only a path inside the app's Chat: the button never leaves Moduo.
  if (!/^\/chat\?[A-Za-z0-9=&-]+$/.test(path)) throw new Error("chat_waiting: path missing");
  return {
    workspaceName,
    conversationKind,
    conversationName: conversationKind === "channel" ? str(payload.conversation_name) || null : null,
    senderName: str(payload.sender_name) || "Someone",
    count,
    text: str(payload.text) || null,
    path,
  };
}

export function chatWaitingEmail(data: ChatWaitingData): EmailDoc {
  const workspace = singleLine(data.workspaceName, 80);
  const sender = singleLine(data.senderName, 80);
  const channel = data.conversationName ? `#${singleLine(data.conversationName, 80)}` : null;
  const many = data.count > 1;
  const subject = many ? `${data.count} messages are waiting in ${workspace}` : `${sender} messaged you in ${workspace}`;
  const where =
    data.conversationKind === "dm"
      ? paragraph(strong(sender), many ? ` sent you ${data.count} messages.` : " sent you a direct message.")
      : paragraph(
          many ? `${data.count} messages for you in ` : "",
          ...(many ? [] : [strong(sender), " mentioned you in "]),
          strong(channel ?? "a conversation"),
          many ? `, the newest from ${sender}.` : ".",
        );
  return {
    subject,
    preheader: data.text ? singleLine(data.text, 120) : "Open Moduo to read it.",
    blocks: [
      lockup(),
      heading(many ? `${data.count} messages are waiting` : "A message is waiting"),
      where,
      ...(data.text ? [muted(`“${singleLine(data.text, 200)}”`)] : []),
      button("Open in Moduo", `${CANONICAL_APP_ORIGIN}${data.path}`, "app.moduo.app"),
    ],
    footer: {
      reason: `You got this email because someone messaged you in ${workspace} while Moduo wasn't open for an hour. Turn off "Email when away" in Settings → Notifications to stop these.`,
    },
  };
}
