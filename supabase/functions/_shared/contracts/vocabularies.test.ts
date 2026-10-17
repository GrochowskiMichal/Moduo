import { readFileSync } from "node:fs";

import { describe, expect, it } from "@rstest/core";

import { Constants } from "@/types/supabase";

import {
  EMAIL_KINDS,
  isEmailKind,
  ACTIVITY_ACTOR_TYPES,
  CALENDAR_ACCOUNT_STATUSES,
  CALENDAR_PROVIDERS,
  CONNECTION_STATUSES,
  CONTACT_FIELD_TYPES,
  EMAIL_ACCOUNT_STATUSES,
  EMAIL_PROVIDERS,
  ENERGY_LEVELS,
  INVITE_STATUSES,
  KNOWN_SUBSCRIPTION_STATUSES,
  LINK_ORIGINS,
  MCP_KEY_SCOPES,
  MEMBER_DB_PERMISSIONS,
  MEMBER_DB_ROLES,
  MODULE_PERMISSIONS,
  PLAN_TIERS,
  PRIORITY_LEVELS,
  RELATION_KINDS,
  SYNCABLE_PROVIDERS,
  USER_RELATION_KINDS,
  TASK_STATUSES,
  WAITLIST_ROW_SOURCES,
  WAITLIST_SOURCES,
  WAITLIST_STATUSES,
  WORKSPACE_ROLES,
  inviteStatusSchema,
  isCalendarProvider,
  isKnownSubscriptionStatus,
  isMailboxProvider,
  isMemberDbRole,
  isPlanTier,
  isRelationKind,
  isTaskStatus,
  isOpenTaskStatus,
  normalizeTaskStatus,
  TASK_OPEN_STATUSES,
  isWaitlistSource,
  isWorkspaceRole,
  normalizeCalendarProvider,
  normalizeEmailProvider,
  normalizeLinkOrigin,
  normalizeMcpKeyScope,
  normalizePlanTier,
  normalizeRelationKind,
  parsePlanTier,
  planTierSchema,
  relationKindSchema,
  taskStatusSchema,
  GUEST_REMINDER_MINUTES,
  normalizeGuestReminderMinutes,
  parseGuestReminderMinutes,
} from "./index.ts";

// ---------------------------------------------------------------------------
// Vocabulary value sets — content pinned against the live catalog + DB CHECKs
// ---------------------------------------------------------------------------

describe("vocabulary value sets", () => {
  it("task vocabularies mirror the tasks CHECK constraints", () => {
    expect(TASK_STATUSES).toEqual(["todo", "in_progress", "done", "archived"]);
    expect(ENERGY_LEVELS).toEqual(["low", "medium", "high"]);
    expect(PRIORITY_LEVELS).toEqual(["low", "medium", "high"]);
  });

  it("guest reminder minutes mirror the exposed_slot_links CHECK (TX-6)", () => {
    expect(GUEST_REMINDER_MINUTES).toEqual([60, 1440]);
    const sql = readFileSync(
      new URL("../../../migrations/20261014170000_tx6_booking_reminders.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain(
      `CHECK (guest_reminder_minutes IS NULL OR guest_reminder_minutes IN (${GUEST_REMINDER_MINUTES.join(", ")}))`,
    );
    expect(normalizeGuestReminderMinutes(null)).toBeNull();
    expect(normalizeGuestReminderMinutes(30)).toBe(1440);
    expect(parseGuestReminderMinutes(60)).toBe(60);
    expect(() => parseGuestReminderMinutes(30)).toThrow();
  });

  it("actor types mirror the module_activity CHECK", () => {
    expect(ACTIVITY_ACTOR_TYPES).toEqual(["user", "agent", "api_key"]);
  });

  it("link vocabularies mirror the entity_links CHECK constraints", () => {
    expect(RELATION_KINDS).toEqual([
      "references",
      "spawned-from",
      "blocks",
      "attachment",
      "mentions",
      "works-at",
      "follow-up",
      "paid-by",
      "conversation-of",
    ]);
    expect(USER_RELATION_KINDS).toEqual(RELATION_KINDS.filter((k) => k !== "conversation-of"));
    expect(LINK_ORIGINS).toEqual(["manual", "drag", "mention", "ref", "suggest"]);
  });

  it("contact field types mirror the contact_field_defs CHECK", () => {
    expect(CONTACT_FIELD_TYPES).toEqual([
      "text",
      "number",
      "date",
      "select",
      "multi_select",
      "url",
      "checkbox",
    ]);
  });

  it("workspace vocabularies pin app vs DB spellings (verified live DF-24)", () => {
    expect(WORKSPACE_ROLES).toEqual(["owner", "admin", "editor", "viewer"]);
    expect(MEMBER_DB_ROLES).toEqual(["owner", "admin", "member", "viewer"]);
    expect(MODULE_PERMISSIONS).toEqual(["none", "view", "edit", "admin"]);
    expect(MEMBER_DB_PERMISSIONS).toEqual(["read", "write", "none"]);
  });

  it("MCP key scopes stay a separate vocabulary from workspace permissions", () => {
    expect(MCP_KEY_SCOPES).toEqual(["none", "view", "edit"]);
    // `admin` is never key-grantable — present in MODULE_PERMISSIONS, absent here.
    expect(MCP_KEY_SCOPES).not.toContain("admin");
  });

  it("invite statuses pin the workspace_invites set", () => {
    expect(INVITE_STATUSES).toEqual(["pending", "accepted", "revoked", "expired"]);
    expect(inviteStatusSchema.safeParse("pending").success).toBe(true);
    expect(inviteStatusSchema.safeParse("declined").success).toBe(false);
  });

  it("waitlist vocabularies pin the landing CTA sources and row statuses", () => {
    expect(WAITLIST_SOURCES).toEqual(["nav", "hero", "close", "footer"]);
    expect(WAITLIST_ROW_SOURCES).toEqual(["nav", "hero", "close", "footer", "manual"]);
    expect(WAITLIST_STATUSES).toEqual(["pending", "confirmed", "cancelled", "invited"]);
    expect(isWaitlistSource("hero")).toBe(true);
    // A manual invite is a row source only; the landing can't claim it.
    expect(isWaitlistSource("manual")).toBe(false);
    expect(isWaitlistSource("sidebar")).toBe(false);
    expect(isWaitlistSource(undefined)).toBe(false);
  });

  it("email kinds: the catalog in specs/transactional-email.md T11, in order", () => {
    expect(EMAIL_KINDS).toEqual([
      "auth_code",
      "account_deleted",
      "waitlist_invite",
      "updates_confirm",
      "workspace_invite",
      "workspace_owner",
      "workspace_removed",
      "booking_guest_confirmed",
      "booking_guest_added",
      "booking_host_new",
      "booking_host_guest_cancelled",
      "booking_guest_cancelled",
      "booking_guest_host_cancelled",
      "booking_guest_reminder",
      "welcome",
      "trial_ending",
      "trial_ended",
      "founder_access",
      "founder_access_ending",
      "announcement",
      "build_update",
      "ops_alert",
      "chat_waiting",
    ]);
    expect(isEmailKind("auth_code")).toBe(true);
    expect(isEmailKind("newsletter")).toBe(false);
  });

  it("email vocabularies pin the code spellings (not the stale migration comment)", () => {
    expect(EMAIL_PROVIDERS).toEqual(["gmail", "outlook", "icloud", "custom"]);
    expect(EMAIL_ACCOUNT_STATUSES).toEqual(["active", "reauth_required", "error"]);
    expect(CONNECTION_STATUSES).toEqual(["disconnected", "connecting", "connected"]);
  });

  it("calendar vocabularies include stored `moduo` rows and current `ics` feeds", () => {
    expect(CALENDAR_PROVIDERS).toEqual(["google", "microsoft", "caldav", "ics", "moduo"]);
    expect(SYNCABLE_PROVIDERS).toEqual(["google", "microsoft", "caldav", "ics"]);
    expect(SYNCABLE_PROVIDERS).not.toContain("moduo");
    expect(CALENDAR_ACCOUNT_STATUSES).toEqual(["ok", "error"]);
  });

  it("subscription statuses are the bounded Stripe set plus local `none`", () => {
    expect(KNOWN_SUBSCRIPTION_STATUSES).toContain("trialing");
    expect(KNOWN_SUBSCRIPTION_STATUSES).toContain("active");
    expect(KNOWN_SUBSCRIPTION_STATUSES).toContain("none");
    expect(isKnownSubscriptionStatus("incomplete")).toBe(true);
    expect(isKnownSubscriptionStatus("refunded")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// plan_tier — the founder/founders bridge + drift guards
// ---------------------------------------------------------------------------

describe("PLAN_TIERS drift guards", () => {
  it("matches the generated Constants.public.Enums.plan_tier", () => {
    expect(PLAN_TIERS).toEqual(Constants.public.Enums.plan_tier);
  });

  it("matches the LIVE pg_enum probe fixture (2026-08-14, task-2 evidence)", () => {
    // Read-only live probe of production pg_enum for plan_tier returned exactly
    // these labels in this order. Canonical label is `founder` (SINGULAR);
    // `founders` (plural) is the legacy app/Stripe spelling and is a
    // compatibility INPUT only — never emitted.
    expect(PLAN_TIERS).toEqual(["free", "pro", "team", "founder", "duo"]);
  });

  it("schema accepts canonical values and rejects the legacy spelling", () => {
    for (const tier of PLAN_TIERS) {
      expect(planTierSchema.safeParse(tier).success).toBe(true);
    }
    expect(planTierSchema.safeParse("founders").success).toBe(false);
    expect(planTierSchema.safeParse("enterprise").success).toBe(false);
    expect(planTierSchema.safeParse("").success).toBe(false);
  });
});

describe("normalizePlanTier (read/display bridge)", () => {
  it("passes canonical spellings through", () => {
    expect(normalizePlanTier("free")).toBe("free");
    expect(normalizePlanTier("pro")).toBe("pro");
    expect(normalizePlanTier("team")).toBe("team");
    expect(normalizePlanTier("founder")).toBe("founder");
  });

  it("normalizes the legacy `founders` spelling to the canonical key", () => {
    expect(normalizePlanTier("founders")).toBe("founder");
    expect(normalizePlanTier("Founders")).toBe("founder");
    expect(normalizePlanTier(" FOUNDERS ")).toBe("founder");
  });

  it("degrades unknown/missing values to least-privilege `free`", () => {
    expect(normalizePlanTier("bogus")).toBe("free");
    expect(normalizePlanTier("enterprise")).toBe("free");
    expect(normalizePlanTier("")).toBe("free");
    expect(normalizePlanTier(null)).toBe("free");
    expect(normalizePlanTier(undefined)).toBe("free");
    expect(normalizePlanTier(42)).toBe("free");
    expect(normalizePlanTier({})).toBe("free");
  });
});

describe("parsePlanTier (strict write-path parse)", () => {
  it("accepts canonical values", () => {
    const result = parsePlanTier("founder");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("founder");
  });

  it("rejects the non-canonical `founders` spelling with a named error", () => {
    const result = parsePlanTier("founders");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe("invalid_value");
    }
  });

  it("rejects malformed values", () => {
    expect(parsePlanTier(null).success).toBe(false);
    expect(parsePlanTier(42).success).toBe(false);
    expect(parsePlanTier(["pro"]).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Provider bridges — imap/custom and moduo/ics
// ---------------------------------------------------------------------------

describe("normalizeEmailProvider", () => {
  it("passes canonical providers through", () => {
    expect(normalizeEmailProvider("gmail")).toBe("gmail");
    expect(normalizeEmailProvider("outlook")).toBe("outlook");
    expect(normalizeEmailProvider("icloud")).toBe("icloud");
    expect(normalizeEmailProvider("custom")).toBe("custom");
  });

  it("normalizes the legacy `imap` spelling to `custom`", () => {
    expect(normalizeEmailProvider("imap")).toBe("custom");
    expect(normalizeEmailProvider("IMAP")).toBe("custom");
  });

  it("falls back to `custom` (generic IMAP) for unknown/malformed values", () => {
    expect(normalizeEmailProvider("bogus")).toBe("custom");
    expect(normalizeEmailProvider(null)).toBe("custom");
    expect(normalizeEmailProvider(42)).toBe("custom");
  });
});

describe("normalizeCalendarProvider", () => {
  it("passes all canonical providers through, incl. stored moduo and current ics", () => {
    expect(normalizeCalendarProvider("google")).toBe("google");
    expect(normalizeCalendarProvider("microsoft")).toBe("microsoft");
    expect(normalizeCalendarProvider("caldav")).toBe("caldav");
    expect(normalizeCalendarProvider("ics")).toBe("ics");
    expect(normalizeCalendarProvider("moduo")).toBe("moduo");
  });

  it("returns null for unknown values so callers skip/fall back intentionally", () => {
    expect(normalizeCalendarProvider("apple")).toBeNull();
    expect(normalizeCalendarProvider("bogus")).toBeNull();
    expect(normalizeCalendarProvider(null)).toBeNull();
    expect(normalizeCalendarProvider(42)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Guards + remaining bridges
// ---------------------------------------------------------------------------

describe("type guards narrow without casts", () => {
  it("isPlanTier / isWorkspaceRole / isMemberDbRole / isMailboxProvider", () => {
    expect(isPlanTier("founder")).toBe(true);
    expect(isPlanTier("founders")).toBe(false);
    expect(isWorkspaceRole("editor")).toBe(true);
    expect(isWorkspaceRole("member")).toBe(false); // DB spelling is NOT app vocab
    expect(isMemberDbRole("member")).toBe(true);
    expect(isMemberDbRole("editor")).toBe(false); // app spelling is NOT DB vocab
    expect(isMailboxProvider("imap")).toBe(false);
    expect(isMailboxProvider("custom")).toBe(true);
    expect(isCalendarProvider("moduo")).toBe(true);
    expect(isCalendarProvider("apple")).toBe(false);
  });

  it("isTaskStatus / isRelationKind", () => {
    expect(isTaskStatus("in_progress")).toBe(true);
    expect(isTaskStatus("doing")).toBe(false);
    expect(isRelationKind("works-at")).toBe(true);
    expect(isRelationKind("knows")).toBe(false);
  });
});

describe("normalizeTaskStatus / isOpenTaskStatus (TV-D8: old builds tolerate new values)", () => {
  it("keeps the known values", () => {
    for (const s of TASK_STATUSES) expect(normalizeTaskStatus(s)).toBe(s);
  });

  it("reads the Tasks v3 categories as their nearest known status, never dropping the row", () => {
    expect(normalizeTaskStatus("backlog")).toBe("todo");
    expect(normalizeTaskStatus("wont_do")).toBe("archived");
    expect(normalizeTaskStatus("Won't do")).toBe("archived");
    expect(normalizeTaskStatus("completed")).toBe("done");
    expect(normalizeTaskStatus("in_review")).toBe("in_progress");
  });

  it("reads anything else as To do, so it stays in view", () => {
    expect(normalizeTaskStatus("shipped")).toBe("todo");
    expect(normalizeTaskStatus("")).toBe("todo");
    expect(normalizeTaskStatus(null)).toBe("todo");
    expect(normalizeTaskStatus(42)).toBe("todo");
  });

  it("has one open rule for the legacy values", () => {
    expect([...TASK_OPEN_STATUSES]).toEqual(["todo", "in_progress"]);
    expect(isOpenTaskStatus("todo")).toBe(true);
    expect(isOpenTaskStatus("in_progress")).toBe(true);
    expect(isOpenTaskStatus("done")).toBe(false);
    expect(isOpenTaskStatus("archived")).toBe(false);
    expect(isOpenTaskStatus("backlog")).toBe(true);
    expect(isOpenTaskStatus("wont_do")).toBe(false);
    expect(isOpenTaskStatus("something new")).toBe(true);
  });
});

describe("normalizeMcpKeyScope (matches registry.moduleScope semantics)", () => {
  it("view/edit pass case-insensitively; everything else is none", () => {
    expect(normalizeMcpKeyScope("view")).toBe("view");
    expect(normalizeMcpKeyScope("EDIT")).toBe("edit");
    expect(normalizeMcpKeyScope("none")).toBe("none");
    expect(normalizeMcpKeyScope("admin")).toBe("none"); // never key-grantable
    expect(normalizeMcpKeyScope("bogus")).toBe("none");
    expect(normalizeMcpKeyScope(undefined)).toBe("none");
  });
});

describe("link vocabulary normalization", () => {
  it("unknown relation kinds degrade to the default `references`", () => {
    expect(normalizeRelationKind("blocks")).toBe("blocks");
    expect(normalizeRelationKind("bogus")).toBe("references");
    expect(normalizeRelationKind(null)).toBe("references");
  });

  it("unknown link origins degrade to the default `manual`", () => {
    expect(normalizeLinkOrigin("drag")).toBe("drag");
    expect(normalizeLinkOrigin("bogus")).toBe("manual");
    expect(normalizeLinkOrigin(undefined)).toBe("manual");
  });

  it("strict schemas reject unknown values", () => {
    expect(relationKindSchema.safeParse("knows").success).toBe(false);
    expect(taskStatusSchema.safeParse("doing").success).toBe(false);
  });
});

describe("chat vocabularies", () => {
  it("mirror the chat_module CHECKs", async () => {
    const v = await import("./vocabularies.ts");
    expect([...v.CHAT_CHANNEL_KINDS]).toEqual(["channel", "dm"]);
    expect([...v.CHAT_NOTIFY_LEVELS]).toEqual(["all", "mentions", "none"]);
  });
  it("normalize an unknown notify level to the quiet default", async () => {
    const v = await import("./vocabularies.ts");
    expect(v.normalizeChatNotifyLevel("loud")).toBe("mentions");
    expect(v.normalizeChatNotifyLevel("none")).toBe("none");
    expect(v.parseChatNotifyLevel("loud").success).toBe(false);
  });
  it("gate chat to Duo, Team and Founder (owner rank ≥ duo)", async () => {
    const v = await import("./vocabularies.ts");
    expect(v.planHasChat("free")).toBe(false);
    expect(v.planHasChat("pro")).toBe(false);
    expect(v.planHasChat("duo")).toBe(true);
    expect(v.planHasChat("team")).toBe(true);
    expect(v.planHasChat("founders")).toBe(true);
    expect(v.planHasChat("garbage")).toBe(false);
  });
});

describe("statuses (CV-17)", () => {
  it("mirror the …_chat_v2_statuses CHECKs; parse, normalize and is agree", async () => {
    const v = await import("./vocabularies.ts");
    expect([...v.STATUS_PRESETS]).toEqual(["meeting", "sick", "vacation", "commuting"]);
    expect([...v.STATUS_CLEAR_AFTER]).toEqual(["30m", "1h", "today", "this_week", "date", "never"]);
    expect(v.parseStatusPreset("sick").success).toBe(true);
    expect(v.parseStatusPreset("lunch").success).toBe(false);
    expect(v.normalizeStatusPreset("lunch")).toBeNull();
    expect(v.isStatusPreset("vacation")).toBe(true);
    expect(v.parseStatusClearAfter("this_week").success).toBe(true);
    expect(v.parseStatusClearAfter("fortnight").success).toBe(false);
    expect(v.normalizeStatusClearAfter("fortnight")).toBe("never");
    // Out sick and On vacation hold pings (AC6.6); every preset has its words.
    expect(v.STATUS_PRESET_DEFAULTS.sick.dnd && v.STATUS_PRESET_DEFAULTS.vacation.dnd).toBe(true);
    for (const p of v.STATUS_PRESETS) {
      expect(v.STATUS_PRESET_DEFAULTS[p].text.length).toBeLessThanOrEqual(v.STATUS_TEXT_MAX);
    }
  });
});

describe("chat v2 vocabularies (CV-1)", () => {
  it("mirror the …_chat_v2_foundation CHECKs", async () => {
    const v = await import("./vocabularies.ts");
    expect([...v.CHAT_MESSAGE_KINDS]).toEqual(["message", "event"]);
    expect([...v.CHAT_EVENT_TYPES]).toEqual(["moved_out", "moved_in"]);
    expect([...v.CHAT_CATCHUP_REASONS]).toEqual([
      "dm",
      "mention",
      "team_mention",
      "everyone",
      "reply",
      "announcement",
      "every_message",
      "reminder",
      "added",
      "removed",
      "level_reset",
    ]);
    expect([...v.CHAT_CATCHUP_DONE_HOW]).toEqual(["done", "read", "bell", "closed"]);
  });
  it("parse strictly for writes", async () => {
    const v = await import("./vocabularies.ts");
    expect(v.parseChatMessageKind("event").success).toBe(true);
    expect(v.parseChatMessageKind("note").success).toBe(false);
    expect(v.parseChatEventType("moved_in").success).toBe(true);
    expect(v.parseChatEventType("copied").success).toBe(false);
    expect(v.parseChatCatchupReason("level_reset").success).toBe(true);
    expect(v.parseChatCatchupReason("gossip").success).toBe(false);
    expect(v.parseChatCatchupDoneHow("bell").success).toBe(true);
    expect(v.parseChatCatchupDoneHow("ignored").success).toBe(false);
  });
  it("normalize reads: a missing kind is a message; unknown kinds, events and reasons are skipped", async () => {
    const v = await import("./vocabularies.ts");
    expect(v.normalizeChatMessageKind(undefined)).toBe("message");
    expect(v.normalizeChatMessageKind("event")).toBe("event");
    expect(v.normalizeChatMessageKind("huddle")).toBeNull();
    expect(v.normalizeChatEventType("huddle_started")).toBeNull();
    expect(v.normalizeChatEventType("moved_out")).toBe("moved_out");
    expect(v.normalizeChatCatchupReason("gossip")).toBeNull();
    expect(v.normalizeChatCatchupReason("dm")).toBe("dm");
    expect(v.normalizeChatCatchupDoneHow(null)).toBeNull();
    expect(v.normalizeChatCatchupDoneHow("snoozed")).toBe("done");
    expect(v.isChatCatchupDoneHow("read")).toBe(true);
    expect(v.isChatEventType(42)).toBe(false);
  });
  it("a chat.mention bell row says why it reached you (CV-5)", async () => {
    const v = await import("./vocabularies.ts");
    expect([...v.CHAT_MENTION_REASONS]).toEqual(["person", "team", "everyone"]);
    expect(v.parseChatMentionReason("team").success).toBe(true);
    expect(v.parseChatMentionReason("channel").success).toBe(false);
    expect(v.normalizeChatMentionReason(undefined)).toBe("person");
    expect(v.normalizeChatMentionReason("everyone")).toBe("everyone");
    expect(v.isChatMentionReason("someone")).toBe(false);
  });
  it("device notices: chat's six kinds, and which app a client is (CV-6a)", async () => {
    const v = await import("./vocabularies.ts");
    expect([...v.NOTICE_DELIVERY_KINDS]).toEqual([
      "reminder",
      "agent",
      "chat_message",
      "chat_mention",
      "chat_reply",
      "chat_announcement",
      "chat_reminder",
      "chat_focus_summary",
    ]);
    expect(v.normalizeNoticeDeliveryKind("chat_reply")).toBe("chat_reply");
    expect(v.normalizeNoticeDeliveryKind("chat_typing")).toBe("reminder");
    expect([...v.CLIENT_SURFACES]).toEqual(["desktop", "web"]);
    expect(v.parseClientSurface("desktop").success).toBe(true);
    expect(v.parseClientSurface("phone").success).toBe(false);
    expect(v.isClientSurface("web")).toBe(true);
    expect(v.normalizeClientSurface(undefined)).toBe("web");
  });
});

describe("MCP key scopes: modules, maps and strict parses", () => {
  it("lists the key modules in key-card order, Links last", async () => {
    const v = await import("./vocabularies.ts");
    expect([...v.MCP_KEY_MODULES]).toEqual([
      "tasks",
      "notes",
      "calendar",
      "email",
      "contacts",
      "chat",
      "links",
    ]);
    expect(v.isMcpKeyModule("links")).toBe(true);
    expect(v.isMcpKeyModule("finance")).toBe(false);
    expect(v.isMcpKeyModule(undefined)).toBe(false);
  });

  it("isMcpKeyScope / parseMcpKeyScope are strict: exactly none, view, edit", async () => {
    const v = await import("./vocabularies.ts");
    expect(v.isMcpKeyScope("view")).toBe(true);
    expect(v.isMcpKeyScope("VIEW")).toBe(false);
    expect(v.isMcpKeyScope("admin")).toBe(false);
    expect(v.parseMcpKeyScope("edit").success).toBe(true);
    expect(v.parseMcpKeyScope("admin").success).toBe(false);
  });

  it("normalizeMcpKeyScopes spells out every module and reads anything odd as none", async () => {
    const v = await import("./vocabularies.ts");
    expect(v.normalizeMcpKeyScopes({ tasks: "EDIT", notes: "admin", finance: "edit" })).toEqual({
      tasks: "edit",
      notes: "none",
      calendar: "none",
      email: "none",
      contacts: "none",
      chat: "none",
      links: "none",
    });
    expect(v.normalizeMcpKeyScopes(null)).toEqual(v.normalizeMcpKeyScopes({}));
    expect(v.normalizeMcpKeyScopes(["view"])).toEqual(v.normalizeMcpKeyScopes({}));
  });

  it("parseMcpKeyScopes takes only a complete map of known modules", async () => {
    const v = await import("./vocabularies.ts");
    const full = v.normalizeMcpKeyScopes({ tasks: "view" });
    expect(v.parseMcpKeyScopes(full).success).toBe(true);
    expect(v.parseMcpKeyScopes({ tasks: "view" }).success).toBe(false); // modules missing
    expect(v.parseMcpKeyScopes({ ...full, finance: "edit" }).success).toBe(false);
    expect(v.parseMcpKeyScopes({ ...full, tasks: "admin" }).success).toBe(false);
  });
});

describe("content author kinds (chat messages and comments)", () => {
  it("are a person or an app over an API key, and unknown reads as a person", async () => {
    const v = await import("./vocabularies.ts");
    expect([...v.CONTENT_AUTHOR_KINDS]).toEqual(["user", "api_key"]);
    expect(v.normalizeContentAuthorKind("api_key")).toBe("api_key");
    expect(v.normalizeContentAuthorKind(undefined)).toBe("user");
    expect(v.normalizeContentAuthorKind("bot")).toBe("user");
    expect(v.isContentAuthorKind("bot")).toBe(false);
  });
});

describe("reaction keys (CV-7c: one key for chat, comments and the quick row)", () => {
  it("default to Moduo's six, in order", async () => {
    const v = await import("./vocabularies.ts");
    expect(v.DEFAULT_QUICK_REACTIONS.join("")).toBe("👍✅👀🙏❤️😄");
    expect(v.DEFAULT_QUICK_REACTIONS.every((k) => v.isReactionKey(k))).toBe(true);
    // Stored as they are: a quick-row key and the key it reacts with are one chip.
    expect(v.DEFAULT_QUICK_REACTIONS.every((k) => v.canonicalReactionKey(k) === k)).toBe(true);
    expect(v.MAX_REACTION_KINDS).toBe(20);
    expect(v.MAX_QUICK_REACTIONS).toBe(6);
  });

  it("accept exactly what the server accepts (the corpus in chat_reactions.test.sql)", async () => {
    const v = await import("./vocabularies.ts");
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(
      new URL("../../../tests/chat_reactions.test.sql", import.meta.url),
      "utf8",
    );
    const block = sql.slice(sql.indexOf("-- corpus:begin"), sql.indexOf("-- corpus:end"));
    const rows = [...block.matchAll(/\('([0-9A-F ]*)', (true|false)\)/g)];
    expect(rows.length).toBeGreaterThan(40);
    for (const [, hex, ok] of rows) {
      const key = hex ? String.fromCodePoint(...hex.split(" ").map((h) => Number.parseInt(h, 16))) : "";
      expect(v.isReactionKey(key), `[${hex}]`).toBe(ok === "true");
      expect(v.parseReactionKey(key).success, `[${hex}]`).toBe(ok === "true");
      const once = v.canonicalReactionKey(key);
      expect(v.canonicalReactionKey(once), `[${hex}] spelled twice`).toBe(once);
    }
  });

  it("have one spelling, the same as the server's (the canonical corpus)", async () => {
    const v = await import("./vocabularies.ts");
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(
      new URL("../../../tests/chat_reactions.test.sql", import.meta.url),
      "utf8",
    );
    const block = sql.slice(sql.indexOf("-- canonical:begin"), sql.indexOf("-- canonical:end"));
    const rows = [...block.matchAll(/\('([0-9A-F ]+)', '([0-9A-F ]+)'\)/g)];
    expect(rows.length).toBeGreaterThan(5);
    const fromHex = (hex: string) =>
      String.fromCodePoint(...hex.split(" ").map((h) => Number.parseInt(h, 16)));
    for (const [, hex, want] of rows) {
      expect(v.canonicalReactionKey(fromHex(hex)), `[${hex}]`).toBe(fromHex(want));
      expect(v.canonicalReactionKey(fromHex(want)), `[${want}] again`).toBe(fromHex(want));
      expect(v.isReactionKey(fromHex(want)), `[${want}]`).toBe(true);
    }
  });

  it("refuse what the database can't even hold, and anything not a string", async () => {
    const v = await import("./vocabularies.ts");
    const lone = String.fromCharCode(0xd83d);
    for (const k of [lone, `👍${String.fromCharCode(0xdc00)}`, "👍".repeat(400), "x".repeat(1024), null, 42, {}]) {
      expect(v.isReactionKey(k), String(k).slice(0, 8)).toBe(false);
    }
  });

  it("read: only a key shows; anything else stored is left out", async () => {
    const v = await import("./vocabularies.ts");
    expect(v.normalizeReactionKey("🎉")).toBe("🎉");
    expect(v.normalizeReactionKey(`👍${String.fromCodePoint(0x202e)}`)).toBeNull();
    expect(v.normalizeReactionKey("thumbs_up")).toBeNull();
    expect(v.normalizeReactionKey("")).toBeNull();
    expect(v.normalizeReactionKey(7)).toBeNull();
  });
});

describe("custom emoji (CV-20)", () => {
  it("a name is 2–32 of a–z 0–9 - _ with a letter; its key is the name between colons", async () => {
    const v = await import("./vocabularies.ts");
    for (const ok of ["shipit", "v2", "party-moduo", "a_b", "x".repeat(32)]) {
      expect(v.isCustomEmojiName(ok), ok).toBe(true);
      expect(v.isReactionKey(`:${ok}:`), ok).toBe(true);
      expect(v.customEmojiNameOf(`:${ok}:`)).toBe(ok);
    }
    for (const bad of ["a", "12", "Shipit", "a b", "a+b", "x".repeat(33), "", ":ab:"]) {
      expect(v.isCustomEmojiName(bad), bad).toBe(false);
    }
    expect(v.customEmojiNameOf("👍")).toBeNull();
    expect(v.customEmojiNameOf(":ab")).toBeNull();
  });

  it("a custom key is already its one spelling", async () => {
    const v = await import("./vocabularies.ts");
    for (const k of [":v2:", ":1a:", ":shipit:"]) expect(v.canonicalReactionKey(k)).toBe(k);
  });

  it("stores PNG, GIF and WebP only (never SVG), each under its own extension", async () => {
    const v = await import("./vocabularies.ts");
    expect([...v.CUSTOM_EMOJI_MIMES]).toEqual(["image/png", "image/gif", "image/webp"]);
    expect(v.isCustomEmojiMime("image/svg+xml")).toBe(false);
    expect(v.parseCustomEmojiMime("image/jpeg").success).toBe(false);
    expect(v.normalizeCustomEmojiMime("image/gif")).toBe("image/gif");
    expect(v.normalizeCustomEmojiMime("text/html")).toBeNull();
    expect(v.CUSTOM_EMOJI_EXT).toEqual({ "image/png": "png", "image/gif": "gif", "image/webp": "webp" });
    expect(v.CUSTOM_EMOJI_MAX_BYTES).toBe(256 * 1024);
    expect(v.CUSTOM_EMOJI_PER_WORKSPACE).toBe(500);
  });
});

describe("task status categories (TV-D9, REPLAN 53/53a)", () => {
  it("are the five fixed categories, in order", async () => {
    const v = await import("./vocabularies.ts");
    expect([...v.TASK_STATUS_CATEGORIES]).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "done",
      "wont_do",
    ]);
    expect(v.isTaskStatusCategory("backlog")).toBe(true);
    expect(v.isTaskStatusCategory("archived")).toBe(false);
  });

  it("parse is strict, normalize reads legacy values and people's words", async () => {
    const v = await import("./vocabularies.ts");
    expect(v.parseTaskStatusCategory("wont_do").success).toBe(true);
    expect(v.parseTaskStatusCategory("archived").success).toBe(false);
    expect(v.parseTaskStatusCategory("To do").success).toBe(false);
    expect(v.normalizeTaskStatusCategory("archived")).toBe("wont_do");
    expect(v.normalizeTaskStatusCategory("Won't do")).toBe("wont_do");
    expect(v.normalizeTaskStatusCategory("To do")).toBe("todo");
    expect(v.normalizeTaskStatusCategory("In progress")).toBe("in_progress");
    expect(v.normalizeTaskStatusCategory("Backlog")).toBe("backlog");
    expect(v.normalizeTaskStatusCategory("in_review")).toBe("in_progress");
    expect(v.normalizeTaskStatusCategory("shipped")).toBe("todo");
    expect(v.normalizeTaskStatusCategory(null)).toBe("todo");
  });

  it("mirror the legacy column like the server does", async () => {
    const v = await import("./vocabularies.ts");
    expect(v.TASK_STATUS_CATEGORIES.map(v.legacyTaskStatus)).toEqual([
      "todo",
      "todo",
      "in_progress",
      "done",
      "archived",
    ]);
  });

  it("status words: the legacy value, Backlog as itself", async () => {
    const v = await import("./vocabularies.ts");
    expect(v.TASK_STATUS_CATEGORIES.map(v.taskStatusWord)).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "done",
      "archived",
    ]);
  });

  it("one open rule: Backlog is neither open nor closed", async () => {
    const v = await import("./vocabularies.ts");
    const backlog = { status: "todo", statusCategory: "backlog" as const };
    expect(v.isOpenTask(backlog)).toBe(false);
    expect(v.isClosedTask(backlog)).toBe(false);
    expect(v.isBacklogTask(backlog)).toBe(true);
    expect(v.isOpenTask({ status: "in_progress" })).toBe(true);
    expect(v.isClosedTask({ status: "archived" })).toBe(true);
    expect(v.isClosedTask({ status: "todo", statusCategory: "wont_do" as const })).toBe(true);
    // A row from before TV-D9 has no category: its legacy status decides.
    expect(v.taskCategoryOf({ status: "archived" })).toBe("wont_do");
    expect(v.taskCategoryOf({ status: "todo", statusCategory: null })).toBe("todo");
  });
});

describe("onboarding roles (TV-U17, MOD-111: kept in preferences JSON, no CHECK)", () => {
  it("are the role question's six answers, in its order", async () => {
    const v = await import("./vocabularies.ts");
    expect(v.TASKS_ROLES).toEqual(["student", "developer", "pm", "founder", "client_work", "creator"]);
  });

  it("parse strictly, normalize unknown to no answer, and guard", async () => {
    const v = await import("./vocabularies.ts");
    expect(v.parseTasksRole("pm").success).toBe(true);
    expect(v.parseTasksRole("designer").success).toBe(false);
    expect(v.normalizeTasksRole("founder")).toBe("founder");
    expect(v.normalizeTasksRole("designer")).toBeNull();
    expect(v.normalizeTasksRole(undefined)).toBeNull();
    expect(v.isTasksRole("creator")).toBe(true);
    expect(v.isTasksRole(3)).toBe(false);
  });
});

describe("label hues and a new tag's colour (MOD-93: one rule for the app and the connector)", () => {
  it("are the eight token names, gray last", async () => {
    const v = await import("./vocabularies.ts");
    expect(v.LABEL_COLORS).toEqual(["blue", "green", "amber", "red", "violet", "teal", "pink", "gray"]);
    expect(v.DEFAULT_LABEL_COLOR).toBe("gray");
  });

  it("the app's palette is this one", async () => {
    const v = await import("./vocabularies.ts");
    const app = await import("@/components/tag-colors");
    expect(app.LABEL_COLORS).toBe(v.LABEL_COLORS);
    expect(app.pickTagColor).toBe(v.pickTagColor);
  });

  it("normalize known hues through, anything else to the default; parse strictly", async () => {
    const v = await import("./vocabularies.ts");
    expect(v.normalizeLabelColor("blue")).toBe("blue");
    expect(v.normalizeLabelColor("pink")).toBe("pink");
    expect(v.normalizeLabelColor(null)).toBe(v.DEFAULT_LABEL_COLOR);
    expect(v.normalizeLabelColor(undefined)).toBe(v.DEFAULT_LABEL_COLOR);
    expect(v.normalizeLabelColor("#ff0000")).toBe(v.DEFAULT_LABEL_COLOR);
    expect(v.parseLabelColor("teal").success).toBe(true);
    expect(v.parseLabelColor("#ff0000").success).toBe(false);
  });

  it("pickTagColor: the least-used hue, palette order breaking ties, gray only when every hue is used", async () => {
    const v = await import("./vocabularies.ts");
    expect(v.pickTagColor([])).toBe(v.LABEL_COLORS[0]);
    expect(v.pickTagColor([{ color: "blue" }])).toBe(v.LABEL_COLORS[1]);
    const mixed = [{ color: "blue" }, { color: "green" }, { color: "blue" }];
    expect(v.pickTagColor(mixed)).toBe(v.pickTagColor(mixed));
    expect(v.pickTagColor([{ color: "blue" }, { color: "green" }])).not.toBe("gray");
    const colored = v.LABEL_COLORS.filter((c) => c !== "gray");
    expect(v.pickTagColor(colored.map((color) => ({ color })))).toBe("gray");
  });
});
