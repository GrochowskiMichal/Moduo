import { describe, expect, it } from "@rstest/core";
import type { ChatMember } from "../../features/chat/model";
import { validateChatSearch } from "../../features/chat/search";
import { catchupCount } from "../../features/chat/shell/chat-tab";
import { titleWithCount } from "./app-badge";
import { noticesOffInBrowser, shouldAskChat } from "./chat-ask";
import { getChatCounts, refreshChatCounts, resetChatCounts, setLiveChatCount } from "./chat-counts";
import { chatServerPrefsFromRow } from "./chat-prefs";
import {
  BURST_WINDOW_MS,
  burstCopy,
  CLIENT_IDLE_MS,
  chatNoticeSwitch,
  chatNoticeTarget,
  decideChatNotice,
  isChatInFront,
  PUSH_WAIT_MS,
  TAG_THROTTLE_MS,
} from "./ring";
import { soundsForNotice } from "./sound";

const base = {
  held: false,
  inFront: false,
  latest: true as boolean | null,
  surface: "desktop" as const,
  switchedOff: false,
  lastRungAt: null as number | null,
  createdAt: 999_500,
  now: 1_000_000,
};

describe("one device rings (CV-6b, AC7.6)", () => {
  it("Chat of that workspace in front shows it in place, on any surface", () => {
    expect(decideChatNotice({ ...base, inFront: true })).toBe("show-in-place");
    expect(decideChatNotice({ ...base, inFront: true, surface: "web", latest: false })).toBe(
      "show-in-place",
    );
  });

  it("only the most recently active client rings; unknown is never", () => {
    expect(decideChatNotice({ ...base })).toBe("ring");
    expect(decideChatNotice({ ...base, latest: false })).toBe("leave");
    expect(decideChatNotice({ ...base, latest: null })).toBe("leave");
  });

  it("a browser tab never rings itself (its push does after 8 s)", () => {
    expect(decideChatNotice({ ...base, surface: "web" })).toBe("leave");
  });

  it("a burst rings once a minute per conversation, the rest acknowledged quietly", () => {
    expect(decideChatNotice({ ...base, lastRungAt: base.now - 5_000 })).toBe("throttled");
    expect(decideChatNotice({ ...base, lastRungAt: base.now - TAG_THROTTLE_MS })).toBe("ring");
  });

  it("the next ring after a burst says how many: 'Sender · N messages' (CV-6b review)", () => {
    const copy = { title: "Sofia Ortiz · Acme", body: "lunch?" };
    const now = base.now;
    expect(burstCopy(copy, null, now)).toEqual(copy);
    expect(burstCopy(copy, { at: now - 61_000, quiet: 0 }, now)).toEqual(copy);
    expect(burstCopy(copy, { at: now - 61_000, quiet: 2 }, now)).toEqual({
      title: "Sofia Ortiz · Acme",
      body: "3 messages: lunch?",
    });
    // "Show message text" off: the server sends no text, so only the number.
    expect(burstCopy({ ...copy, body: "" }, { at: now - 61_000, quiet: 2 }, now)).toEqual({
      title: "Sofia Ortiz · Acme",
      body: "3 messages",
    });
    // The server already counted rows left on the tag: one prefix, both counts.
    expect(
      burstCopy({ ...copy, body: "2 messages: five" }, { at: now - 61_000, quiet: 2 }, now),
    ).toEqual({
      title: "Sofia Ortiz · Acme",
      body: "4 messages: five",
    });
    expect(burstCopy({ ...copy, body: "2 messages" }, { at: now - 61_000, quiet: 1 }, now)).toEqual(
      {
        title: "Sofia Ortiz · Acme",
        body: "3 messages",
      },
    );
    // A burst long gone no longer counts (the server's own window).
    expect(burstCopy(copy, { at: now - BURST_WINDOW_MS, quiet: 2 }, now)).toEqual(copy);
  });

  it("an answer that comes after the push was due never rings (CV-6b review)", () => {
    expect(decideChatNotice({ ...base, createdAt: base.now - PUSH_WAIT_MS })).toBe("ring");
    expect(decideChatNotice({ ...base, createdAt: base.now - PUSH_WAIT_MS - 1 })).toBe("quiet-ack");
  });

  it("a switched-off kind is acknowledged quietly by the latest client, web included", () => {
    expect(decideChatNotice({ ...base, switchedOff: true })).toBe("quiet-ack");
    expect(decideChatNotice({ ...base, switchedOff: true, surface: "web" })).toBe("quiet-ack");
    expect(decideChatNotice({ ...base, switchedOff: true, latest: false })).toBe("leave");
  });

  it("a notice held for Focus is left alone", () => {
    expect(decideChatNotice({ ...base, held: true, inFront: true })).toBe("leave");
  });
});

describe("in front", () => {
  const front = {
    focused: true,
    visible: true,
    pathname: "/chat",
    selectedWorkspaceId: "w1",
    workspaceId: "w1",
    lastInputAt: 1_000_000,
    now: 1_000_000,
  };
  it("is Chat of the notice's workspace with your attention", () => {
    expect(isChatInFront(front)).toBe(true);
    expect(isChatInFront({ ...front, now: front.lastInputAt + CLIENT_IDLE_MS - 1 })).toBe(true);
  });
  it("focused but idle is not in front: the notice rings (CV-6b review)", () => {
    expect(isChatInFront({ ...front, now: front.lastInputAt + CLIENT_IDLE_MS })).toBe(false);
  });
  it("another app, another module or another workspace is not in front", () => {
    expect(isChatInFront({ ...front, focused: false })).toBe(false);
    expect(isChatInFront({ ...front, visible: false })).toBe(false);
    expect(isChatInFront({ ...front, pathname: "/tasks" })).toBe(false);
    expect(isChatInFront({ ...front, pathname: "/chatter" })).toBe(false);
    expect(isChatInFront({ ...front, selectedWorkspaceId: "w2" })).toBe(false);
    expect(isChatInFront({ ...front, workspaceId: null })).toBe(false);
  });
});

describe("switches, sound and the landing", () => {
  const message = { kind: "chat_message" as const };
  it("tells a direct message from an Every-message conversation by its kind, never its title", () => {
    expect(chatNoticeSwitch(message, "dm")).toBe("chatDirect");
    expect(chatNoticeSwitch(message, "channel")).toBe("chatEvery");
    // Unknown (the read failed): no switch is guessed.
    expect(chatNoticeSwitch(message, null)).toBeNull();
    expect(chatNoticeSwitch({ kind: "chat_reply" }, null)).toBe("chatMentions");
    expect(chatNoticeSwitch({ kind: "chat_mention" }, null)).toBe("chatMentions");
    expect(chatNoticeSwitch({ kind: "chat_announcement" }, null)).toBe("chatAnnouncements");
    expect(chatNoticeSwitch({ kind: "reminder" }, null)).toBeNull();
  });

  it("sounds only for a direct message or @you (CH34)", () => {
    expect(soundsForNotice(message, "dm")).toBe(true);
    expect(soundsForNotice({ kind: "chat_mention" }, null)).toBe(true);
    expect(soundsForNotice(message, "channel")).toBe(false);
    expect(soundsForNotice({ kind: "chat_reply" }, null)).toBe(false);
    expect(soundsForNotice({ kind: "chat_announcement" }, null)).toBe(false);
  });

  it("lands on the conversation and message of the notice's link", () => {
    expect(chatNoticeTarget("/chat?c=c1&m=m1")).toEqual({ c: "c1", m: "m1" });
    expect(chatNoticeTarget("/chat?c=c1")).toEqual({ c: "c1" });
    expect(chatNoticeTarget("/chat")).toBeNull();
    expect(chatNoticeTarget("/tasks?id=t1")).toBeNull();
    expect(chatNoticeTarget(null)).toBeNull();
  });

  it('lands the Focus summary ("3 messages while you focused") on Catch up', () => {
    // The server writes the summary with this link (CV-18); Moduo coming to
    // the front after it rang is the click, and the page reads the search.
    const target = chatNoticeTarget("/chat?view=catchup");
    expect(target).toEqual({ view: "catchup" });
    expect(validateChatSearch(target as Record<string, unknown>)).toEqual({ view: "catchup" });
    expect(chatNoticeTarget("/chat?view=browse")).toBeNull();
  });
});

describe("counts outside Chat (§11 Count)", () => {
  const member = (notifyLevel: ChatMember["notifyLevel"]) => ({ notifyLevel }) as ChatMember;
  const counts = (catchup: number) => ({
    channelId: "x",
    unread: catchup,
    mentions: 0,
    addressed: 0,
    catchup,
  });

  it("the Chat tab counts open Catch up items, never a conversation on Nothing", () => {
    expect(
      catchupCount({
        mine: { a: member("mentions"), b: member("all"), c: member("none") },
        unread: { a: counts(2), b: counts(1), c: counts(4), d: counts(9) },
      }),
    ).toBe(3);
  });

  it("the switcher counts each workspace and the badge sums them, the open one live", async () => {
    resetChatCounts();
    await refreshChatCounts("u1", ["w1", "w2", "w3"], "w1", async (ws) => (ws === "w2" ? 4 : 1));
    setLiveChatCount("w1", 2);
    expect(getChatCounts().byWorkspace).toEqual({ w1: 2, w2: 4, w3: 1 });
    expect(getChatCounts().total).toBe(7);
    // A failed read keeps the last number.
    await refreshChatCounts("u1", ["w1", "w2", "w3"], "w1", async (ws) => (ws === "w2" ? null : 0));
    expect(getChatCounts().byWorkspace).toEqual({ w1: 2, w2: 4, w3: 0 });
    resetChatCounts();
    expect(getChatCounts().total).toBe(0);
  });

  it("an older read landing late never overwrites a newer one (CV-6b review)", async () => {
    resetChatCounts();
    let release: (n: number) => void = () => {};
    const slow = new Promise<number>((resolve) => {
      release = resolve;
    });
    const older = refreshChatCounts("u1", ["w2"], null, () => slow);
    await refreshChatCounts("u1", ["w2"], null, async () => 5);
    release(9);
    await older;
    expect(getChatCounts().byWorkspace).toEqual({ w2: 5 });
    resetChatCounts();
  });

  it("another person's refresh starts from none and drops the last one's reads", async () => {
    resetChatCounts();
    await refreshChatCounts("u1", ["w2"], null, async () => 4);
    let release: (n: number) => void = () => {};
    const slow = new Promise<number>((resolve) => {
      release = resolve;
    });
    const stale = refreshChatCounts("u1", ["w2"], null, () => slow);
    // Signed in as someone else: their read fails, and nothing of u1's shows.
    await refreshChatCounts("u2", ["w2"], null, async () => null);
    expect(getChatCounts().byWorkspace).toEqual({});
    release(7);
    await stale;
    expect(getChatCounts().byWorkspace).toEqual({});
    resetChatCounts();
  });

  it("the tab title carries the sum", () => {
    expect(titleWithCount("Moduo", 3)).toBe("(3) Moduo");
    expect(titleWithCount("(3) Moduo", 0)).toBe("Moduo");
    expect(titleWithCount("(3) Moduo", 120)).toBe("(99+) Moduo");
    expect(titleWithCount("(99+) Moduo", 5)).toBe("(5) Moduo");
  });
});

describe("the browser's one ask (AC7.7) and chat settings", () => {
  it("asks once, only a browser that can still say yes", () => {
    expect(shouldAskChat(null, "off")).toBe(true);
    expect(shouldAskChat("later", "off")).toBe(false);
    expect(shouldAskChat("refused", "off")).toBe(false);
    expect(shouldAskChat(null, "denied")).toBe(false);
    expect(shouldAskChat(null, "on")).toBe(false);
    expect(shouldAskChat(null, "unavailable")).toBe(false);
    expect(shouldAskChat(null, "unsupported")).toBe(false);
  });

  it("refused in the browser: Catch up says notifications are off", () => {
    expect(noticesOffInBrowser("denied")).toBe(true);
    expect(noticesOffInBrowser("off")).toBe(false);
  });

  it("reads the server's chat settings, defaulting on", () => {
    // CV-17 adds "Show me as online" (on) and "Show what I'm focusing on" (off).
    expect(chatServerPrefsFromRow(null)).toEqual({
      noticeShowText: true,
      emailWhenAway: true,
      showOnline: true,
      showFocusTask: false,
    });
    expect(
      chatServerPrefsFromRow({
        notice_show_text: false,
        email_when_away: false,
        show_online: false,
        show_focus_task: true,
      }),
    ).toEqual({
      noticeShowText: false,
      emailWhenAway: false,
      showOnline: false,
      showFocusTask: true,
    });
  });
});
