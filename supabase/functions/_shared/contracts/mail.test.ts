import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@rstest/core";

import {
  MAIL_LOCAL_CONTRACT,
  MAIL_RULE_ACTIONS,
  MAIL_RULE_EXCLUSIVE_ACTIONS,
  isExclusiveRuleAction,
  normalizeMailMailboxRole,
  normalizeMailTabKind,
  parseMailOpKind,
} from "./mail.ts";

const here = dirname(fileURLToPath(import.meta.url));

describe("mail local contracts", () => {
  it("mail-local.json is the exact export of mail.ts", () => {
    const json = JSON.parse(readFileSync(join(here, "mail-local.json"), "utf8"));
    expect(json).toEqual(JSON.parse(JSON.stringify(MAIL_LOCAL_CONTRACT)));
  });

  it("classification order is pinned (AC25)", () => {
    expect(MAIL_LOCAL_CONTRACT.classify_order).toEqual([
      "block",
      "rules",
      "sender_override",
      "custom_tabs",
      "known_contact",
      "header_heuristics",
    ]);
  });

  it("exclusive actions are a subset of actions", () => {
    for (const a of MAIL_RULE_EXCLUSIVE_ACTIONS) expect(MAIL_RULE_ACTIONS).toContain(a);
    expect(isExclusiveRuleAction("mark_read")).toBe(false);
    expect(isExclusiveRuleAction("move_to_folder")).toBe(true);
  });

  it("parse is strict, normalize is lax", () => {
    expect(() => parseMailOpKind("nuke")).toThrow();
    expect(normalizeMailMailboxRole("weird")).toBe("custom");
    expect(normalizeMailTabKind(null)).toBe("personal");
  });
});
