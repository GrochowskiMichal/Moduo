/**
 * Canonical domain vocabularies + compatibility bridges (zod-enum-foundation, task 2).
 *
 * ONE source of truth per stable vocabulary: a const array, a Zod schema, an
 * inferred type, and — where historical spellings exist — an explicit named
 * bridge. App modules re-export these types so consumers keep their existing
 * import paths while the values live here exactly once.
 *
 * Boundary policy:
 *   - `parse*` (strict)  → write paths / untrusted input. Unknown = rejection.
 *   - `normalize*` (lax) → read/display paths. Legacy spellings map to the
 *     canonical value; unknown falls back to least-privilege / a documented
 *     default. Never throws.
 *   - `is*` guards       → membership tests with proper narrowing (no casts).
 *
 * Database-facing labels are grounded in the LIVE catalog (pg_enum probe
 * 2026-08-14, see .omo/evidence/zod-enum-foundation/task-2-vocabularies.txt),
 * not migration comments or generated types alone.
 *
 * Guardrails honored: polymorphic entity types, user-renamable contact
 * statuses, IMAP folder names, Stripe event names, and opaque client prefs
 * stay OPEN strings and deliberately have NO schema here.
 */

import { z } from "zod";

import { parseOrError, type SafeParseResult } from "./errors.ts";

// ---------------------------------------------------------------------------
// plan_tier — the only native Postgres enum today.
// Live pg_enum (2026-10-06): free | pro | team | founder | duo  (SINGULAR).
// The app historically used "founders" (plural); Stripe/sync Edge Functions
// wrote "founders" until task 6. "founders" is a compatibility INPUT only.
// ---------------------------------------------------------------------------

export const PLAN_TIERS = ["free", "pro", "team", "founder", "duo"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];
export const planTierSchema = z.enum(PLAN_TIERS);

/** Legacy spellings accepted on read, normalized to the canonical label. */
const PLAN_TIER_LEGACY: Record<string, PlanTier> = {
  founders: "founder",
};

export function isPlanTier(value: unknown): value is PlanTier {
  return typeof value === "string" && (PLAN_TIERS as readonly string[]).includes(value);
}

/**
 * Read/display bridge: canonical labels pass through, "founders" normalizes
 * to "founder", anything unknown degrades to "free" (least privilege — a
 * garbled tier must never grant entitlements).
 */
export function normalizePlanTier(input: unknown): PlanTier {
  if (typeof input !== "string") return "free";
  const key = input.trim().toLowerCase();
  if (isPlanTier(key)) return key;
  return PLAN_TIER_LEGACY[key] ?? "free";
}

/** Strict parse for write paths — "founders" is REJECTED here (use normalize first). */
export function parsePlanTier(input: unknown): SafeParseResult<PlanTier> {
  return parseOrError(planTierSchema, input);
}

// ---------------------------------------------------------------------------
// Tasks module — mirrors CHECK constraints in 20260606120000_create_tasks_module
// and 20260606130000_tasks_add_priority. ("urgent" priority is a documented
// future, non-breaking add — see tasks/model.ts.)
// ---------------------------------------------------------------------------

export const TASK_STATUSES = ["todo", "in_progress", "done", "archived"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const taskStatusSchema = z.enum(TASK_STATUSES);
export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Task time entries (TV-D3) — mirrors task_time_entries' kind CHECK and
// tasks_op_track_time's actions and answers in 20261008224500_tasks_time_entries.
// ---------------------------------------------------------------------------

/** focus/waiting: a tracked stretch; adjustment: a signed correction; legacy:
 *  the total a task had before entries existed. */
export const TASK_TIME_ENTRY_KINDS = ["focus", "waiting", "adjustment", "legacy"] as const;
export type TaskTimeEntryKind = (typeof TASK_TIME_ENTRY_KINDS)[number];
export const taskTimeEntryKindSchema = z.enum(TASK_TIME_ENTRY_KINDS);
export function isTaskTimeEntryKind(value: unknown): value is TaskTimeEntryKind {
  return typeof value === "string" && (TASK_TIME_ENTRY_KINDS as readonly string[]).includes(value);
}

/** What `tasks_op_track_time` can do. */
export const TASK_TIME_ACTIONS = ["focus", "waiting", "adjust", "set_total", "undo"] as const;
export type TaskTimeAction = (typeof TASK_TIME_ACTIONS)[number];
export const taskTimeActionSchema = z.enum(TASK_TIME_ACTIONS);

/** How `tasks_op_track_time` answered: recorded; a resend of a save it already
 *  has; nothing to change; or no such task you can see. */
export const TASK_TIME_STATUSES = ["saved", "duplicate", "noop", "gone"] as const;
export type TaskTimeStatus = (typeof TASK_TIME_STATUSES)[number];
export const taskTimeStatusSchema = z.enum(TASK_TIME_STATUSES);

export const ENERGY_LEVELS = ["low", "medium", "high"] as const;
export type EnergyLevel = (typeof ENERGY_LEVELS)[number];
export const energyLevelSchema = z.enum(ENERGY_LEVELS);

export const PRIORITY_LEVELS = ["low", "medium", "high"] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];
export const priorityLevelSchema = z.enum(PRIORITY_LEVELS);

// ---------------------------------------------------------------------------
// Activity actor — mirrors CHECK in 20260612150000_module_activity_intent_ops.
// ---------------------------------------------------------------------------

export const ACTIVITY_ACTOR_TYPES = ["user", "agent", "api_key"] as const;
export type ActivityActorType = (typeof ACTIVITY_ACTOR_TYPES)[number];
export const activityActorTypeSchema = z.enum(ACTIVITY_ACTOR_TYPES);

// ---------------------------------------------------------------------------
// Spine links — mirrors CHECK constraints in 20260625120000_spine_entity_links.
// The kind drives hub grouping and roll-up phrasing; hyphenated tokens are the
// wire format. Adding a kind is a schema change (a migration), never runtime.
// NOTE: polymorphic entity_type stays an OPEN string by design (no schema here).
// ---------------------------------------------------------------------------

export const RELATION_KINDS = [
  "references", // default — a gesture that implies no stronger kind
  "spawned-from", // this was created out of that (email → task, task → note)
  "blocks", // dependency edge (blocker → blocked); Tasks' blocked-by rides this
  "attachment", // a file/email/payment attached to an entity
  "mentions", // an @mention of an entity inside prose
  "works-at", // person → company
  "follow-up", // a follow-up owed on an entity
  "paid-by", // an invoice/payment → the contact who paid it
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];
export const relationKindSchema = z.enum(RELATION_KINDS);
export function isRelationKind(value: unknown): value is RelationKind {
  return typeof value === "string" && (RELATION_KINDS as readonly string[]).includes(value);
}
/** Read-side normalization: unknown kinds degrade to the default "references". */
export function normalizeRelationKind(input: unknown): RelationKind {
  return isRelationKind(input) ? input : "references";
}

export const LINK_ORIGINS = ["manual", "drag", "mention", "ref", "suggest"] as const;
export type LinkOrigin = (typeof LINK_ORIGINS)[number];
export const linkOriginSchema = z.enum(LINK_ORIGINS);
export function isLinkOrigin(value: unknown): value is LinkOrigin {
  return typeof value === "string" && (LINK_ORIGINS as readonly string[]).includes(value);
}
/** Read-side normalization: unknown origins degrade to the default "manual". */
export function normalizeLinkOrigin(input: unknown): LinkOrigin {
  return isLinkOrigin(input) ? input : "manual";
}

// ---------------------------------------------------------------------------
// Contacts — mirrors CHECK in 20260628140000_contacts_v2 (contact_field_defs).
// NOTE: ContactStatus is user-renamable and stays an OPEN string (no schema).
// ---------------------------------------------------------------------------

export const CONTACT_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "select",
  "multi_select",
  "url",
  "checkbox",
] as const;
export type ContactFieldType = (typeof CONTACT_FIELD_TYPES)[number];
export const contactFieldTypeSchema = z.enum(CONTACT_FIELD_TYPES);

// ---------------------------------------------------------------------------
// Workspace roles & module permissions — TWO vocabularies with ONE bridge.
//
// App:    role ∈ {owner, admin, editor, viewer} · perm ∈ {none, view, edit, admin}
// DB:     role ∈ {owner, admin, member, viewer} · perm ∈ {read, write, none}
//         (workspace_members CHECK constraints, verified live DF-24)
//
// The bridge FUNCTIONS live ONLY in src/features/workspaces/workspace-mappers.ts
// (normalizeMemberRole / toMemberRole / memberPermToModulePermission /
// toMemberPerm) — do not invent a second translation layer. These arrays are
// the shared value source those functions (and these schemas) are built on.
// ---------------------------------------------------------------------------

export const WORKSPACE_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export const workspaceRoleSchema = z.enum(WORKSPACE_ROLES);
export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export const MEMBER_DB_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type MemberDbRole = (typeof MEMBER_DB_ROLES)[number];
export const memberDbRoleSchema = z.enum(MEMBER_DB_ROLES);
export function isMemberDbRole(value: unknown): value is MemberDbRole {
  return typeof value === "string" && (MEMBER_DB_ROLES as readonly string[]).includes(value);
}

export const MODULE_PERMISSIONS = ["none", "view", "edit", "admin"] as const;
export type ModulePermission = (typeof MODULE_PERMISSIONS)[number];
export const modulePermissionSchema = z.enum(MODULE_PERMISSIONS);

export const MEMBER_DB_PERMISSIONS = ["read", "write", "none"] as const;
export type MemberDbPermission = (typeof MEMBER_DB_PERMISSIONS)[number];
export const memberDbPermissionSchema = z.enum(MEMBER_DB_PERMISSIONS);

/**
 * Workspace permission keys (PERM-1, specs/permissions.md). A role is a set of
 * these; a member's personal exceptions allow/block single keys on top of it.
 * Mirrors public.perm_all_keys() — same members, same order (the order drives
 * the settings matrix). `<module>.<action>` for modules, `ws.<power>` for the
 * workspace powers.
 */
export const PERMISSION_MODULES = ["notes", "tasks", "calendar", "contacts", "chat"] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];
export const PERMISSION_ACTIONS = ["view", "create", "edit", "delete"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];
export const WORKSPACE_POWERS = [
  "invite",
  "manage_members",
  "manage_roles",
  "publish",
  "api_keys",
] as const;
export type WorkspacePower = (typeof WORKSPACE_POWERS)[number];
export type PermissionKey = `${PermissionModule}.${PermissionAction}` | `ws.${WorkspacePower}`;
export const PERMISSION_KEYS: readonly PermissionKey[] = [
  ...PERMISSION_MODULES.flatMap((m) => PERMISSION_ACTIONS.map((a) => `${m}.${a}` as const)),
  ...WORKSPACE_POWERS.map((p) => `ws.${p}` as const),
];
export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && (PERMISSION_KEYS as readonly string[]).includes(value);
}
/** System role keys seeded for every workspace (`workspace_roles.system_key`). */
export const SYSTEM_ROLE_KEYS = ["admin", "member", "viewer"] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];
export function isSystemRoleKey(value: unknown): value is SystemRoleKey {
  return typeof value === "string" && (SYSTEM_ROLE_KEYS as readonly string[]).includes(value);
}

/**
 * Per-thing sharing (PERM-3…8). Mirrors resource_grants CHECKs in
 * 20261006210000_perm_sharing.sql. `freebusy` is calendars only.
 */
export const GRANT_LEVELS = ["freebusy", "view", "edit", "full"] as const;
export type GrantLevel = (typeof GRANT_LEVELS)[number];
export const grantLevelSchema = z.enum(GRANT_LEVELS);
export function isGrantLevel(value: unknown): value is GrantLevel {
  return typeof value === "string" && (GRANT_LEVELS as readonly string[]).includes(value);
}

export const SHARE_RESOURCE_TYPES = [
  "note",
  "bucket",
  "task",
  "calendar",
  "contact",
  "contact_group",
  "channel",
] as const;
export type ShareResourceType = (typeof SHARE_RESOURCE_TYPES)[number];
export function isShareResourceType(value: unknown): value is ShareResourceType {
  return typeof value === "string" && (SHARE_RESOURCE_TYPES as readonly string[]).includes(value);
}

export const GRANT_SUBJECT_TYPES = ["member", "workspace", "public_link"] as const;
export type GrantSubjectType = (typeof GRANT_SUBJECT_TYPES)[number];

/** Workspace default for a new container. `private` writes no workspace grant. */
export const SHARE_DEFAULT_LEVELS = ["private", "freebusy", "view", "edit", "full"] as const;
export type ShareDefaultLevel = (typeof SHARE_DEFAULT_LEVELS)[number];

export const CHAT_CAPABILITIES = [
  "create_public",
  "create_private",
  "manage_any",
  "delete_others",
  "mention_everyone",
  "post",
  "start_calls",
] as const;
export type ChatCapability = (typeof CHAT_CAPABILITIES)[number];

/**
 * MCP connector key scopes — a SEPARATE vocabulary from workspace permissions
 * on purpose: `admin` is never key-grantable, and the scope map is per-module.
 * Mirrors moduleScope() in supabase/functions/moduo-mcp/registry.ts.
 */
export const MCP_KEY_SCOPES = ["none", "view", "edit"] as const;
export type McpKeyScope = (typeof MCP_KEY_SCOPES)[number];
export const mcpKeyScopeSchema = z.enum(MCP_KEY_SCOPES);
export function isMcpKeyScope(value: unknown): value is McpKeyScope {
  return typeof value === "string" && (MCP_KEY_SCOPES as readonly string[]).includes(value);
}
/** Key-scope normalization: case-insensitive view/edit; anything else → none. */
export function normalizeMcpKeyScope(input: unknown): McpKeyScope {
  if (typeof input !== "string") return "none";
  const key = input.trim().toLowerCase();
  return key === "edit" || key === "view" ? key : "none";
}
/** Strict parse for write paths: exactly none / view / edit. */
export function parseMcpKeyScope(input: unknown): SafeParseResult<McpKeyScope> {
  return parseOrError(mcpKeyScopeSchema, input);
}

/**
 * The modules an MCP key is scoped by: the keys of workspace_api_keys.scopes,
 * in Settings → API keys order. Mirrors workspace_api_key_scopes_valid() (the
 * table's CHECK) in 20261008120000_workspace_api_keys_set_scopes.sql and the
 * modules the connector registers (supabase/functions/moduo-mcp/registry.ts).
 * `links` is the spine: search, links and comments across the other modules.
 */
export const MCP_KEY_MODULES = [
  "tasks",
  "notes",
  "calendar",
  "email",
  "contacts",
  "chat",
  "links",
] as const;
export type McpKeyModule = (typeof MCP_KEY_MODULES)[number];
export const mcpKeyModuleSchema = z.enum(MCP_KEY_MODULES);
export function isMcpKeyModule(value: unknown): value is McpKeyModule {
  return typeof value === "string" && (MCP_KEY_MODULES as readonly string[]).includes(value);
}

/** A key's access with every module spelled out. */
export type McpKeyScopes = Record<McpKeyModule, McpKeyScope>;
/** Every module present, each exactly none / view / edit (Zod 4 enum-keyed records are exhaustive). */
export const mcpKeyScopesSchema = z.record(mcpKeyModuleSchema, mcpKeyScopeSchema);
/**
 * Read a stored (or partial) scope map as a full one. Absent, unknown and
 * `admin` levels read as none, which is what the connector grants them;
 * modules outside MCP_KEY_MODULES are dropped.
 */
export function normalizeMcpKeyScopes(input: unknown): McpKeyScopes {
  const raw =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    MCP_KEY_MODULES.map((module) => [module, normalizeMcpKeyScope(raw[module])]),
  ) as McpKeyScopes;
}
/** Strict parse for the create / set-scopes payload: every module, nothing else. */
export function parseMcpKeyScopes(input: unknown): SafeParseResult<McpKeyScopes> {
  return parseOrError(mcpKeyScopesSchema, input) as SafeParseResult<McpKeyScopes>;
}

// ---------------------------------------------------------------------------
// Workspace invites — the status set on workspace_invites.
// ---------------------------------------------------------------------------

export const INVITE_STATUSES = ["pending", "accepted", "revoked", "expired"] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];
export const inviteStatusSchema = z.enum(INVITE_STATUSES);

// ---------------------------------------------------------------------------
// Landing waitlist — public.waitlist.source / .status (CHECKs in
// 20261001160000 + 20261001170000 waitlist migrations). Source = which landing CTA.
// ---------------------------------------------------------------------------

export const WAITLIST_SOURCES = ["nav", "hero", "close", "footer"] as const;
export type WaitlistSource = (typeof WAITLIST_SOURCES)[number];
export const waitlistSourceSchema = z.enum(WAITLIST_SOURCES);

export function isWaitlistSource(input: unknown): input is WaitlistSource {
  return waitlistSourceSchema.safeParse(input).success;
}

export const WAITLIST_STATUSES = ["pending", "confirmed", "cancelled"] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];
export const waitlistStatusSchema = z.enum(WAITLIST_STATUSES);

// ---------------------------------------------------------------------------
// Transactional email — every kind of email Moduo sends (specs/transactional-
// email.md T11). Defined in full up front so the TX blocks don't collide on
// this file; the email_outbox CHECK lands with the table (TX-2). The order
// follows the catalog (A1…E2), then the internal ops alert.
// ---------------------------------------------------------------------------

export const EMAIL_KINDS = [
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
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];
export const emailKindSchema = z.enum(EMAIL_KINDS);

export function isEmailKind(input: unknown): input is EmailKind {
  return emailKindSchema.safeParse(input).success;
}

// ---------------------------------------------------------------------------
// Email accounts — provider/status vocabularies.
//
// DRIFT NOTE (live resolution): the 20260704170000_email_module migration
// COMMENT says provider ∈ {'gmail','icloud','imap','outlook'}, but there is NO
// CHECK constraint and the code vocabulary has always been
// {gmail, outlook, icloud, custom} (src/features/email/model/email-types.ts and
// Rust normalize_provider in account_config.rs agree). "imap" is the legacy
// comment spelling; the canonical generic-IMAP value is "custom".
// NOTE: IMAP folder names are user-owned — OPEN strings, no schema here.
// ---------------------------------------------------------------------------

export const EMAIL_PROVIDERS = ["gmail", "outlook", "icloud", "custom"] as const;
export type MailboxProvider = (typeof EMAIL_PROVIDERS)[number];
export const mailboxProviderSchema = z.enum(EMAIL_PROVIDERS);
export function isMailboxProvider(value: unknown): value is MailboxProvider {
  return typeof value === "string" && (EMAIL_PROVIDERS as readonly string[]).includes(value);
}

/** Legacy spellings accepted on read, normalized to the canonical provider. */
const EMAIL_PROVIDER_LEGACY: Record<string, MailboxProvider> = {
  imap: "custom",
};

/**
 * Read-side bridge: known providers pass through, "imap" → "custom", and
 * unknown values fall back to "custom" (the generic IMAP case — matches the
 * Rust account_id host fallback; the Rust write path still REJECTS unknown).
 */
export function normalizeEmailProvider(input: unknown): MailboxProvider {
  if (typeof input !== "string") return "custom";
  const key = input.trim().toLowerCase();
  if (isMailboxProvider(key)) return key;
  return EMAIL_PROVIDER_LEGACY[key] ?? "custom";
}

export const EMAIL_ACCOUNT_STATUSES = ["active", "reauth_required", "error"] as const;
export type EmailAccountStatus = (typeof EMAIL_ACCOUNT_STATUSES)[number];
export const emailAccountStatusSchema = z.enum(EMAIL_ACCOUNT_STATUSES);

export const CONNECTION_STATUSES = ["disconnected", "connecting", "connected"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
export const connectionStatusSchema = z.enum(CONNECTION_STATUSES);

// ---------------------------------------------------------------------------
// Calendar accounts — provider/status vocabularies.
//
// LIVE DATA RESOLUTION: `moduo` is the built-in Moduo calendar provider
// (stored rows, runtime.types.ts), `ics` is a current feed provider written by
// caldav-connect (the 20260702130000 migration comment predates CAL-8 and
// omits it). Both are intentional members of the canonical set — not legacy
// spellings. There is NO CHECK constraint on provider (text + stale comment).
// ---------------------------------------------------------------------------

export const CALENDAR_PROVIDERS = ["google", "microsoft", "caldav", "ics", "moduo"] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];
export const calendarProviderSchema = z.enum(CALENDAR_PROVIDERS);
export function isCalendarProvider(value: unknown): value is CalendarProvider {
  return typeof value === "string" && (CALENDAR_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Read-side recognition: known providers (incl. stored `moduo` rows and
 * current `ics` rows) pass through; unknown returns NULL so the caller can
 * intentionally skip/fall back rather than silently mislabeling a row.
 */
export function normalizeCalendarProvider(input: unknown): CalendarProvider | null {
  return isCalendarProvider(input) ? input : null;
}

/** Providers the desktop sync engine can fetch (everything except built-in `moduo`). */
export const SYNCABLE_PROVIDERS = ["google", "microsoft", "caldav", "ics"] as const;
export type SyncableProvider = (typeof SYNCABLE_PROVIDERS)[number];
export const syncableProviderSchema = z.enum(SYNCABLE_PROVIDERS);

export const CALENDAR_ACCOUNT_STATUSES = ["ok", "error"] as const;
export type CalendarAccountStatus = (typeof CALENDAR_ACCOUNT_STATUSES)[number];
export const calendarAccountStatusSchema = z.enum(CALENDAR_ACCOUNT_STATUSES);

// ---------------------------------------------------------------------------
// Subscription status — Stripe-OWNED vocabulary (bounded, documented set).
// Kept as a known set + strict schema for write paths; display code passes
// unknown provider values through (a new Stripe status must never render as
// "none"). Stripe EVENT NAMES stay open strings (no schema — provider-owned).
// ---------------------------------------------------------------------------

export const KNOWN_SUBSCRIPTION_STATUSES = [
  "none", // local: no subscription row / no customer
  "trialing",
  "active",
  "canceled",
  "past_due",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
] as const;
export type KnownSubscriptionStatus = (typeof KNOWN_SUBSCRIPTION_STATUSES)[number];
export const knownSubscriptionStatusSchema = z.enum(KNOWN_SUBSCRIPTION_STATUSES);
export function isKnownSubscriptionStatus(value: unknown): value is KnownSubscriptionStatus {
  return (
    typeof value === "string" && (KNOWN_SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Chat — mirrors the CHECKs in 20261006150000_chat_module (chat_channels.kind,
// chat_members.notify_level). Gated by the workspace owner's plan rank ≥ duo.
// ---------------------------------------------------------------------------

export const CHAT_CHANNEL_KINDS = ["channel", "dm"] as const;
export type ChatChannelKind = (typeof CHAT_CHANNEL_KINDS)[number];
export const chatChannelKindSchema = z.enum(CHAT_CHANNEL_KINDS);
export function isChatChannelKind(value: unknown): value is ChatChannelKind {
  return typeof value === "string" && (CHAT_CHANNEL_KINDS as readonly string[]).includes(value);
}

export const CHAT_NOTIFY_LEVELS = ["all", "mentions", "none"] as const;
export type ChatNotifyLevel = (typeof CHAT_NOTIFY_LEVELS)[number];
export const chatNotifyLevelSchema = z.enum(CHAT_NOTIFY_LEVELS);
export function isChatNotifyLevel(value: unknown): value is ChatNotifyLevel {
  return typeof value === "string" && (CHAT_NOTIFY_LEVELS as readonly string[]).includes(value);
}
/** Read-side normalization: an unknown level degrades to the quiet default. */
export function normalizeChatNotifyLevel(input: unknown): ChatNotifyLevel {
  return isChatNotifyLevel(input) ? input : "mentions";
}
/** Strict parse for write paths. */
export function parseChatNotifyLevel(input: unknown): SafeParseResult<ChatNotifyLevel> {
  return parseOrError(chatNotifyLevelSchema, input);
}

/** Plans whose workspaces get chat (mirrors public.chat_workspace_enabled: rank ≥ duo). */
export const CHAT_PLAN_TIERS = ["duo", "team", "founder"] as const satisfies readonly PlanTier[];
export function planHasChat(tier: unknown): boolean {
  return (CHAT_PLAN_TIERS as readonly string[]).includes(normalizePlanTier(tier));
}

// ---------------------------------------------------------------------------
// Content authors — who wrote a chat message or a comment. Mirrors
// chat_messages_author_kind_check (20261006160000_chat_agent_access) and
// comments_author_kind_check (20261008123000_key_writes_act_as_creator).
// `api_key` = an app over MCP, shown by the key's name and marked as an app
// (an "App" badge in chat, "<key name> (app)" on a comment), never as a person.
// ---------------------------------------------------------------------------

export const CONTENT_AUTHOR_KINDS = ["user", "api_key"] as const;
export type ContentAuthorKind = (typeof CONTENT_AUTHOR_KINDS)[number];
export const contentAuthorKindSchema = z.enum(CONTENT_AUTHOR_KINDS);
export function isContentAuthorKind(value: unknown): value is ContentAuthorKind {
  return typeof value === "string" && (CONTENT_AUTHOR_KINDS as readonly string[]).includes(value);
}
/** Read-side normalization: rows written before the column existed are a person's. */
export function normalizeContentAuthorKind(input: unknown): ContentAuthorKind {
  return isContentAuthorKind(input) ? input : "user";
}
