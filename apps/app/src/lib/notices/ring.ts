// What a client does with a chat notice it hears (CV-6b, round-3 §2.14 e): the
// one-device rule as a pure decision, so it is tested without an app around it.
//
//   held for Focus            → leave it (CV-18 writes the summary when Focus ends)
//   Chat of that workspace in front of you → show it in place, acknowledge
//   not your most recently active client   → leave it (another one rings)
//   its switch is off (Settings)              → acknowledge quietly (no push either)
//   a browser tab             → leave it (its push rings after 8 s if nobody acknowledged)
//   the answer came after the push was due → acknowledge quietly (the push rang)
//   rung on this tag a moment ago → acknowledge quietly, counted (one notice per burst)
//   otherwise                 → ring (an OS notification), acknowledge

import type { ClientSurface } from "@contracts/vocabularies";

/** One notice per conversation (its tag) for about a minute. */
export const TAG_THROTTLE_MS = 60_000;
/** A focus this soon after a ring from the background is the click on it: land on the message. */
export const RING_CLICK_MS = 10_000;
/** Idle after this long without a key or a pointer: no longer "active" (nor in front). */
export const CLIENT_IDLE_MS = 5 * 60_000;
/** A chat notice's push is due this long after the row (`push_after`, CV-6a). */
export const PUSH_WAIT_MS = 8_000;
/** A burst's quiet rows count into the next ring only this long (the server's window). */
export const BURST_WINDOW_MS = 10 * 60_000;

/**
 * `throttled`: acknowledged quietly as part of a burst (counted into the next
 * ring's "N messages"); `quiet-ack`: acknowledged quietly for any other reason.
 */
export type ChatNoticeAction = "show-in-place" | "ring" | "throttled" | "quiet-ack" | "leave";

/**
 * Moduo is "in front" of you for a chat notice only while its window has your
 * attention, on Chat, in the notice's workspace: another app, another module
 * or another workspace all count as not in front.
 */
export function isChatInFront(input: {
  focused: boolean;
  visible: boolean;
  pathname: string;
  selectedWorkspaceId: string | null;
  workspaceId: string | null;
  /** Your last key or pointer on this window (ms), and the time now. */
  lastInputAt: number;
  now: number;
}): boolean {
  return (
    input.focused &&
    input.visible &&
    input.now - input.lastInputAt < CLIENT_IDLE_MS &&
    (input.pathname === "/chat" || input.pathname.startsWith("/chat/")) &&
    input.workspaceId !== null &&
    input.workspaceId === input.selectedWorkspaceId
  );
}

export function decideChatNotice(input: {
  held: boolean;
  inFront: boolean;
  /** The server's answer to "am I the most recently active client" (null: unknown). */
  latest: boolean | null;
  surface: ClientSurface;
  /** The notice's switch in Settings → Preferences → Chat is off. */
  switchedOff: boolean;
  /** When this client last rang this notice's tag (ms), if it did. */
  lastRungAt: number | null;
  /** The row's `created_at` (ms, the server's clock). */
  createdAt: number;
  now: number;
}): ChatNoticeAction {
  if (input.held) return "leave";
  if (input.inFront) return "show-in-place";
  if (input.latest !== true) return "leave";
  if (input.switchedOff) return "quiet-ack";
  if (input.surface === "web") return "leave";
  // The server answered after the push was due: a browser may have rung already.
  if (input.now - input.createdAt > PUSH_WAIT_MS) return "quiet-ack";
  if (input.lastRungAt !== null && input.now - input.lastRungAt < TAG_THROTTLE_MS) {
    return "throttled";
  }
  return "ring";
}

/**
 * What a ring says after a burst was acknowledged quietly (`tagRing`: the
 * tag's last ring and the rows acknowledged quietly since): the server's title
 * (sender, conversation, workspace) and "N messages", with the newest text
 * when "Show message text" is on (the server then sends a body), as the
 * server's own burst copy does ("Sofia · 3 messages").
 */
export function burstCopy(
  copy: { title: string; body: string },
  tagRing: { at: number; quiet: number } | null,
  now: number,
): { title: string; body: string } {
  const quiet = tagRing && now - tagRing.at < BURST_WINDOW_MS ? tagRing.quiet : 0;
  if (quiet <= 0) return copy;
  // The server's body may already count rows left unacknowledged on the tag.
  const server = /^(\d+) messages(?::\s*([\s\S]*))?$/.exec(copy.body.trim());
  const counted = server ? Number(server[1]) : 1;
  const text = (server ? (server[2] ?? "") : copy.body).trim();
  const n = `${quiet + counted} messages`;
  return { title: copy.title, body: text ? `${n}: ${text}` : n };
}

/**
 * The Chat switch a notice answers to. `chat_message` is a direct message or a
 * conversation on Every message: the conversation's kind (the store's, or one
 * read of `chat_channels.kind`) tells them apart; unknown answers to no switch.
 */
export function chatNoticeSwitch(
  delivery: { kind: string },
  conversationKind: string | null,
): "chatDirect" | "chatMentions" | "chatAnnouncements" | "chatEvery" | null {
  switch (delivery.kind) {
    case "chat_mention":
    case "chat_reply":
      return "chatMentions";
    case "chat_announcement":
      return "chatAnnouncements";
    case "chat_message":
      if (!conversationKind) return null;
      return conversationKind === "dm" ? "chatDirect" : "chatEvery";
    default:
      return null;
  }
}

/** Where a chat notice lands: a conversation (and message), or Catch up. */
export type ChatNoticeTarget = { c: string; m?: string } | { view: "catchup" };

/**
 * The conversation and message a chat notice's link points at
 * (`/chat?c=…&m=…`), or Catch up for "3 messages while you focused"
 * (`/chat?view=catchup`, CV-18).
 */
export function chatNoticeTarget(url: string | null): ChatNoticeTarget | null {
  if (!url?.startsWith("/chat")) return null;
  const query = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");
  const c = query.get("c");
  if (!c) return query.get("view") === "catchup" ? { view: "catchup" } : null;
  const m = query.get("m");
  return m ? { c, m } : { c };
}
