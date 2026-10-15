import { describe, expect, it } from "@rstest/core";

import { catchupCount } from "../../features/chat/hooks/use-chat-badge";
import type { ChatMember } from "../../features/chat/model";
import { titleWithCount } from "./app-badge";
import { noticesOffInBrowser, shouldAskChat } from "./chat-ask";
import { getChatCounts, refreshChatCounts, resetChatCounts, setLiveChatCount } from "./chat-counts";
import { chatServerPrefsFromRow } from "./chat-prefs";
import {
  chatNoticeSwitch,
  chatNoticeTarget,
  decideChatNotice,
  isChatInFront,
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
    expect(decideChatNotice({ ...base, lastRungAt: base.now - 5_000 })).toBe("quiet-ack");
    expect(decideChatNotice({ ...base, lastRungAt: base.now - TAG_THROTTLE_MS })).toBe("ring");
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
  };
  it("is Chat of the notice's workspace with your attention", () => {
    expect(isChatInFront(front)).toBe(true);
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
  const dm = { kind: "chat_message", title: "Sofia Ortiz · Acme" };
  const channel = { kind: "chat_message", title: "Sofia Ortiz · #plans · Acme" };
  it("tells a direct message from an Every-message conversation", () => {
    expect(chatNoticeSwitch(dm, null)).toBe("chatDirect");
    expect(chatNoticeSwitch(channel, null)).toBe("chatEvery");
    expect(chatNoticeSwitch(channel, "dm")).toBe("chatDirect");
    expect(chatNoticeSwitch(dm, "channel")).toBe("chatEvery");
    expect(chatNoticeSwitch({ kind: "chat_reply", title: "" }, null)).toBe("chatMentions");
    expect(chatNoticeSwitch({ kind: "chat_mention", title: "" }, null)).toBe("chatMentions");
    expect(chatNoticeSwitch({ kind: "chat_announcement", title: "" }, null)).toBe(
      "chatAnnouncements",
    );
    expect(chatNoticeSwitch({ kind: "reminder", title: "" }, null)).toBeNull();
  });

  it("sounds only for a direct message or @you (CH34)", () => {
    expect(soundsForNotice({ kind: "chat_message", title: dm.title }, "dm")).toBe(true);
    expect(soundsForNotice({ kind: "chat_mention", title: channel.title }, null)).toBe(true);
    expect(soundsForNotice({ kind: "chat_message", title: channel.title }, "channel")).toBe(false);
    expect(soundsForNotice({ kind: "chat_reply", title: channel.title }, null)).toBe(false);
    expect(soundsForNotice({ kind: "chat_announcement", title: channel.title }, null)).toBe(false);
  });

  it("lands on the conversation and message of the notice's link", () => {
    expect(chatNoticeTarget("/chat?c=c1&m=m1")).toEqual({ c: "c1", m: "m1" });
    expect(chatNoticeTarget("/chat?c=c1")).toEqual({ c: "c1" });
    expect(chatNoticeTarget("/chat")).toBeNull();
    expect(chatNoticeTarget("/tasks?id=t1")).toBeNull();
    expect(chatNoticeTarget(null)).toBeNull();
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
    await refreshChatCounts(["w1", "w2", "w3"], "w1", async (ws) => (ws === "w2" ? 4 : 1));
    setLiveChatCount("w1", 2);
    expect(getChatCounts().byWorkspace).toEqual({ w1: 2, w2: 4, w3: 1 });
    expect(getChatCounts().total).toBe(7);
    // A failed read keeps the last number.
    await refreshChatCounts(["w1", "w2", "w3"], "w1", async (ws) => (ws === "w2" ? null : 0));
    expect(getChatCounts().byWorkspace).toEqual({ w1: 2, w2: 4, w3: 0 });
    resetChatCounts();
    expect(getChatCounts().total).toBe(0);
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
    expect(chatServerPrefsFromRow(null)).toEqual({ noticeShowText: true, emailWhenAway: true });
    expect(chatServerPrefsFromRow({ notice_show_text: false, email_when_away: false })).toEqual({
      noticeShowText: false,
      emailWhenAway: false,
    });
  });
});
