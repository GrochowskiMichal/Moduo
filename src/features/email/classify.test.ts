import { describe, expect, it } from "vitest";

import {
  type ClassifySignals,
  classifyThread,
  flattenSections,
  groupThreadsBySection,
} from "./classify";
import type { EmailThread } from "./model/email-types";

function signals(over: Partial<ClassifySignals>): ClassifySignals {
  return { fromEmail: "someone@example.com", ...over };
}

describe("classifyThread", () => {
  it("routes List-Unsubscribe senders to Newsletters", () => {
    expect(
      classifyThread(signals({ fromEmail: "news@substack.com", listUnsubscribe: "<https://s/u>" })),
    ).toBe("newsletters");
  });

  it("routes bulk precedence and no-reply/auto senders to Notifications", () => {
    expect(classifyThread(signals({ precedence: "bulk" }))).toBe("notifications");
    expect(classifyThread(signals({ fromEmail: "no-reply@service.com" }))).toBe("notifications");
    expect(classifyThread(signals({ fromEmail: "notifications@github.com" }))).toBe(
      "notifications",
    );
    expect(classifyThread(signals({ autoSubmitted: "auto-generated" }))).toBe("notifications");
  });

  it("Auto-Submitted / no-reply wins over List-Unsubscribe (GitHub-style notifications)", () => {
    // GitHub notifications carry List-Unsubscribe AND Auto-Submitted — they're
    // notifications, not newsletters.
    expect(
      classifyThread(
        signals({
          fromEmail: "notifications@github.com",
          listUnsubscribe: "<https://github/u>",
          autoSubmitted: "auto-generated",
        }),
      ),
    ).toBe("notifications");
  });

  it("treats Auto-Submitted: no as not machine-generated", () => {
    expect(classifyThread(signals({ autoSubmitted: "no" }))).toBe("personal");
  });

  it("puts a known contact in Personal, even with bulk headers", () => {
    expect(
      classifyThread(signals({ listUnsubscribe: "<https://x/u>" }), { isKnownSender: true }),
    ).toBe("personal");
  });

  it("defaults an unmatched human to Personal", () => {
    expect(classifyThread(signals({ fromEmail: "jane.doe@company.com" }))).toBe("personal");
  });

  it("lets an explicit override win over every rule", () => {
    expect(
      classifyThread(signals({ fromEmail: "no-reply@service.com" }), { override: "personal" }),
    ).toBe("personal");
    expect(
      classifyThread(signals({ fromEmail: "jane@company.com" }), { override: "newsletters" }),
    ).toBe("newsletters");
  });
});

function thread(over: Partial<EmailThread>): EmailThread {
  return {
    threadId: "t",
    accountId: "gmail:a@x.com",
    accountEmail: "a@x.com",
    subject: "Subject",
    participants: ["Someone"],
    fromName: "Someone",
    fromEmail: "someone@example.com",
    snippet: "hi",
    date: "2026-07-01T10:00:00Z",
    timestampMs: 1,
    messageCount: 1,
    unread: false,
    unreadCount: 0,
    starred: false,
    folder: "inbox",
    latestUid: 1,
    ...over,
  };
}

describe("groupThreadsBySection", () => {
  const threads = [
    thread({ threadId: "p", fromEmail: "jane@company.com" }),
    thread({ threadId: "n", fromEmail: "no-reply@service.com" }),
    thread({ threadId: "w", fromEmail: "news@substack.com", listUnsubscribe: "<https://s/u>" }),
  ];

  it("groups into Personal / Notifications / Newsletters in display order, dropping empties", () => {
    const groups = groupThreadsBySection(threads);
    expect(groups.map((g) => g.section)).toEqual(["personal", "notifications", "newsletters"]);
    expect(groups.map((g) => g.threads.length)).toEqual([1, 1, 1]);
    // Flattened order preserves section order (keyboard nav).
    expect(flattenSections(groups).map((t) => t.threadId)).toEqual(["p", "n", "w"]);
  });

  it("applies a per-sender override, re-filing that sender everywhere", () => {
    const overrides = { "no-reply@service.com": "personal" as const };
    const groups = groupThreadsBySection(threads, { overrides });
    const personal = groups.find((g) => g.section === "personal")!;
    expect(personal.threads.map((t) => t.threadId).sort()).toEqual(["n", "p"]);
    // Notifications is now empty and dropped.
    expect(groups.some((g) => g.section === "notifications")).toBe(false);
  });

  it("pulls a known correspondent into Personal even from a bulk sender", () => {
    const groups = groupThreadsBySection(threads, {
      isKnownSender: (key) => key === "news@substack.com",
    });
    const personal = groups.find((g) => g.section === "personal")!;
    // The newsletter sender is now known → Personal (alongside jane).
    expect(personal.threads.map((t) => t.threadId).sort()).toEqual(["p", "w"]);
    expect(groups.some((g) => g.section === "newsletters")).toBe(false);
  });
});
