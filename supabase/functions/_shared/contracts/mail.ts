/**
 * Local-only mail vocabularies (specs/mail-rebuild.md decision 25).
 *
 * These never reach Postgres: they are the closed sets the desktop mail engine
 * (Rust, `apps/desktop/src-tauri/src/mail/contracts.rs`) and the front end
 * share. One source: this file. `mail-local.json` is its JSON export
 * (`bun scripts/mail/export-contracts.ts`), and the Rust enums are drift-tested
 * against that JSON, so a value added here fails the Rust tests until mirrored.
 *
 * Cloud mail vocabularies (`email_settings_items.kind`) live in
 * `vocabularies.ts` with their CHECK (MR-7).
 */

import { z } from "zod";

/** A mailbox's role, from SPECIAL-USE or the name fallback (AC9). */
export const MAIL_MAILBOX_ROLES = [
  "inbox",
  "sent",
  "drafts",
  "archive",
  "all",
  "trash",
  "spam",
  "custom",
] as const;
export type MailMailboxRole = (typeof MAIL_MAILBOX_ROLES)[number];
export const mailMailboxRoleSchema = z.enum(MAIL_MAILBOX_ROLES);
export function isMailMailboxRole(input: unknown): input is MailMailboxRole {
  return mailMailboxRoleSchema.safeParse(input).success;
}
export function parseMailMailboxRole(input: unknown): MailMailboxRole {
  return mailMailboxRoleSchema.parse(input);
}
/** Lax read: an unknown role is a custom folder. */
export function normalizeMailMailboxRole(input: unknown): MailMailboxRole {
  return isMailMailboxRole(input) ? input : "custom";
}

/** Split-inbox tab kinds (AC25). Custom tabs carry an id beside the kind. */
export const MAIL_TAB_KINDS = ["personal", "custom", "notifications", "newsletters"] as const;
export type MailTabKind = (typeof MAIL_TAB_KINDS)[number];
export const mailTabKindSchema = z.enum(MAIL_TAB_KINDS);
export function isMailTabKind(input: unknown): input is MailTabKind {
  return mailTabKindSchema.safeParse(input).success;
}
export function parseMailTabKind(input: unknown): MailTabKind {
  return mailTabKindSchema.parse(input);
}
export function normalizeMailTabKind(input: unknown): MailTabKind {
  return isMailTabKind(input) ? input : "personal";
}
/** The most custom tabs a user may define (B8). */
export const MAIL_MAX_CUSTOM_TABS = 3;

/**
 * The deterministic classification order (AC25): the first stage that decides
 * wins. Pinned here so the Rust classifier and the fixture engine agree.
 */
export const MAIL_CLASSIFY_ORDER = [
  "block",
  "rules",
  "sender_override",
  "custom_tabs",
  "known_contact",
  "header_heuristics",
] as const;
export type MailClassifyStage = (typeof MAIL_CLASSIFY_ORDER)[number];

/** Queued triage/server op kinds (decision 12). */
export const MAIL_OP_KINDS = [
  "done",
  "undone",
  "move",
  "delete",
  "restore",
  "mark_read",
  "mark_unread",
  "pin",
  "unpin",
  "snooze",
  "unsnooze",
  "mute",
  "unmute",
  "spam",
  "not_spam",
  "label_add",
  "label_remove",
  "block_sender",
] as const;
export type MailOpKind = (typeof MAIL_OP_KINDS)[number];
export const mailOpKindSchema = z.enum(MAIL_OP_KINDS);
export function isMailOpKind(input: unknown): input is MailOpKind {
  return mailOpKindSchema.safeParse(input).success;
}
export function parseMailOpKind(input: unknown): MailOpKind {
  return mailOpKindSchema.parse(input);
}

/** Where a queued op stands. `failed` is surfaced, never dropped (AC12). */
export const MAIL_OP_STATES = ["pending", "in_flight", "done", "failed"] as const;
export type MailOpState = (typeof MAIL_OP_STATES)[number];
export const mailOpStateSchema = z.enum(MAIL_OP_STATES);
export function isMailOpState(input: unknown): input is MailOpState {
  return mailOpStateSchema.safeParse(input).success;
}

/** Rule conditions (X3). */
export const MAIL_RULE_CONDITIONS = [
  "from",
  "domain",
  "to",
  "subject_contains",
  "is_newsletter",
] as const;
export type MailRuleCondition = (typeof MAIL_RULE_CONDITIONS)[number];
export const mailRuleConditionSchema = z.enum(MAIL_RULE_CONDITIONS);
export function isMailRuleCondition(input: unknown): input is MailRuleCondition {
  return mailRuleConditionSchema.safeParse(input).success;
}

/** Rule actions (X3). Exclusive ones: first matching rule wins (AC26). */
export const MAIL_RULE_ACTIONS = [
  "move_to_folder",
  "add_label",
  "put_in_tab",
  "mark_read",
  "skip_inbox",
  "mark_priority",
  "block",
] as const;
export type MailRuleAction = (typeof MAIL_RULE_ACTIONS)[number];
export const mailRuleActionSchema = z.enum(MAIL_RULE_ACTIONS);
export function isMailRuleAction(input: unknown): input is MailRuleAction {
  return mailRuleActionSchema.safeParse(input).success;
}
export const MAIL_RULE_EXCLUSIVE_ACTIONS = [
  "move_to_folder",
  "put_in_tab",
  "skip_inbox",
  "block",
] as const satisfies readonly MailRuleAction[];
export function isExclusiveRuleAction(action: MailRuleAction): boolean {
  return (MAIL_RULE_EXCLUSIVE_ACTIONS as readonly string[]).includes(action);
}

/** Where a blocked sender's new mail goes (B18 / S3). */
export const MAIL_BLOCK_DESTINATIONS = ["trash", "spam", "archive", "folder"] as const;
export type MailBlockDestination = (typeof MAIL_BLOCK_DESTINATIONS)[number];
export const mailBlockDestinationSchema = z.enum(MAIL_BLOCK_DESTINATIONS);

/** Engine → UI change-set kinds over `mail_subscribe` (decision 10). */
export const MAIL_EVENT_KINDS = [
  "threads_changed",
  "counts",
  "sync_status",
  "op_failed",
  "new_mail",
  "draft_changed",
] as const;
export type MailEventKind = (typeof MAIL_EVENT_KINDS)[number];
export const mailEventKindSchema = z.enum(MAIL_EVENT_KINDS);
export function isMailEventKind(input: unknown): input is MailEventKind {
  return mailEventKindSchema.safeParse(input).success;
}

/** A message body's local state (decision 8). */
export const MAIL_BODY_STATES = ["none", "text_only", "full", "evicted"] as const;
export type MailBodyState = (typeof MAIL_BODY_STATES)[number];
export const mailBodyStateSchema = z.enum(MAIL_BODY_STATES);

/** An account's sync status as the rail shows it (AC40). */
export const MAIL_SYNC_STATES = [
  "idle",
  "first_sync",
  "syncing",
  "backfilling",
  "offline",
  "reconnect",
  "error",
] as const;
export type MailSyncState = (typeof MAIL_SYNC_STATES)[number];
export const mailSyncStateSchema = z.enum(MAIL_SYNC_STATES);

/** Mail providers the engine connects to (AC37). `outlook` already exists in the cloud list. */
export const MAIL_PROVIDERS = ["gmail", "google_workspace", "icloud", "outlook", "imap"] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];
export const mailProviderSchema = z.enum(MAIL_PROVIDERS);

/** Message flags as stored bits in `messages.flags` (one shared bitset layout). */
export const MAIL_FLAG_BITS = {
  seen: 1,
  flagged: 2,
  answered: 4,
  draft: 8,
  deleted: 16,
} as const;

/** The whole local vocabulary, exported to `mail-local.json` for the Rust drift test. */
export const MAIL_LOCAL_CONTRACT = {
  mailbox_roles: MAIL_MAILBOX_ROLES,
  tab_kinds: MAIL_TAB_KINDS,
  classify_order: MAIL_CLASSIFY_ORDER,
  op_kinds: MAIL_OP_KINDS,
  op_states: MAIL_OP_STATES,
  rule_conditions: MAIL_RULE_CONDITIONS,
  rule_actions: MAIL_RULE_ACTIONS,
  rule_exclusive_actions: MAIL_RULE_EXCLUSIVE_ACTIONS,
  block_destinations: MAIL_BLOCK_DESTINATIONS,
  event_kinds: MAIL_EVENT_KINDS,
  body_states: MAIL_BODY_STATES,
  sync_states: MAIL_SYNC_STATES,
  providers: MAIL_PROVIDERS,
  flag_bits: MAIL_FLAG_BITS,
  max_custom_tabs: MAIL_MAX_CUSTOM_TABS,
} as const;
