import { MAIL_CLASSIFY_ORDER } from "@contracts/mail";
import { describe, expect, it } from "@rstest/core";

import { classifyTab } from "./classify";

const news = { fromEmail: "hello@weekly.test", listUnsubscribe: "<https://weekly.test/u>" };

describe("split-inbox classification order (AC25)", () => {
  it("block beats everything", () => {
    const r = classifyTab(news, {
      blocked: new Set(["@weekly.test"]),
      ruleTab: () => ({ kind: "personal" }),
      knownContacts: new Set(["hello@weekly.test"]),
    });
    expect(r).toMatchObject({ blocked: true, stage: "block" });
  });

  it("rules beat overrides, overrides beat custom tabs, custom tabs beat contacts", () => {
    const ctx = {
      ruleTab: () => ({ kind: "notifications" as const }),
      senderOverrides: new Map([["hello@weekly.test", { kind: "personal" as const }]]),
      customTabs: [{ id: "ct1", senders: [], domains: ["weekly.test"] }],
      knownContacts: new Set(["hello@weekly.test"]),
    };
    expect(classifyTab(news, ctx).stage).toBe("rules");
    expect(classifyTab(news, { ...ctx, ruleTab: undefined }).stage).toBe("sender_override");
    expect(
      classifyTab(news, { ...ctx, ruleTab: undefined, senderOverrides: undefined }),
    ).toMatchObject({ kind: "custom", customTabId: "ct1" });
    expect(classifyTab(news, { knownContacts: ctx.knownContacts })).toMatchObject({
      kind: "personal",
      stage: "known_contact",
    });
  });

  it("falls back to header heuristics", () => {
    expect(classifyTab(news).kind).toBe("newsletters");
    expect(classifyTab({ fromEmail: "no-reply@linear.test" }).kind).toBe("notifications");
    expect(classifyTab({ fromEmail: "x@y.test", autoSubmitted: "auto-generated" }).kind).toBe(
      "notifications",
    );
    expect(classifyTab({ fromEmail: "anna@acme.test" }).kind).toBe("personal");
  });

  it("stages are exactly the contract order", () => {
    expect(MAIL_CLASSIFY_ORDER[0]).toBe("block");
    expect(MAIL_CLASSIFY_ORDER.at(-1)).toBe("header_heuristics");
  });
});
