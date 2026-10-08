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
  TASK_STATUSES,
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
    ]);
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
    expect(WAITLIST_STATUSES).toEqual(["pending", "confirmed", "cancelled"]);
    expect(isWaitlistSource("hero")).toBe(true);
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
