// What a client does with a chat notice it hears (CV-6b, round-3 §2.14 e): the
// one-device rule as a pure decision, so it is tested without an app around it.
//
//   held for Focus            → leave it (CV-18 writes the summary when Focus ends)
//   Chat of that workspace in front of you → show it in place, acknowledge
//   not your most recently active client   → leave it (another one rings)
//   its switch is off (Settings)              → acknowledge quietly (no push either)
//   a browser tab             → leave it (its push rings after 8 s if nobody acknowledged)
//   rung on this tag a moment ago → acknowledge quietly (one notice per burst)
//   otherwise                 → ring (an OS notification), acknowledge

/** One notice per conversation (its tag) for about a minute. */
export const TAG_THROTTLE_MS = 60_000;
/** A focus this soon after a ring is the click on it: land on the message. */
export const RING_CLICK_MS = 10_000;

export type ChatNoticeAction = "show-in-place" | "ring" | "quiet-ack" | "leave";

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
}): boolean {
  return (
    input.focused &&
    input.visible &&
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
  surface: "desktop" | "web";
  /** The notice's switch in Settings → Preferences → Chat is off. */
  switchedOff: boolean;
  /** When this client last rang this notice's tag (ms), if it did. */
  lastRungAt: number | null;
  now: number;
}): ChatNoticeAction {
  if (input.held) return "leave";
  if (input.inFront) return "show-in-place";
  if (input.latest !== true) return "leave";
  if (input.switchedOff) return "quiet-ack";
  if (input.surface === "web") return "leave";
  if (input.lastRungAt !== null && input.now - input.lastRungAt < TAG_THROTTLE_MS) {
    return "quiet-ack";
  }
  return "ring";
}

/**
 * The Chat switch a notice answers to. `chat_message` is a direct message or a
 * conversation on Every message: the conversation's kind tells them apart when
 * this app holds it, else the server's title does (a direct message's title
 * names no "#channel").
 */
export function chatNoticeSwitch(
  delivery: { kind: string; title: string },
  conversationKind: string | null,
): "chatDirect" | "chatMentions" | "chatAnnouncements" | "chatEvery" | null {
  switch (delivery.kind) {
    case "chat_mention":
    case "chat_reply":
      return "chatMentions";
    case "chat_announcement":
      return "chatAnnouncements";
    case "chat_message": {
      const direct = conversationKind
        ? conversationKind === "dm"
        : !delivery.title.includes(" · #");
      return direct ? "chatDirect" : "chatEvery";
    }
    default:
      return null;
  }
}

/** The conversation and message a chat notice's link points at (`/chat?c=…&m=…`). */
export function chatNoticeTarget(url: string | null): { c: string; m?: string } | null {
  if (!url?.startsWith("/chat")) return null;
  const query = new URLSearchParams(url.slice(url.indexOf("?") + 1));
  const c = query.get("c");
  if (!c) return null;
  const m = query.get("m");
  return m ? { c, m } : { c };
}
