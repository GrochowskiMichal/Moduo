/** The runtime port's email (implemented in runtime.web.email.ts). */

import type { EmailSettingsKind } from "@contracts/vocabularies";

import type { Truncation } from "./paged-select";

/** One mail settings item that follows the user (MR-7): a rule, custom tab,
 *  Priority person, blocked sender, Screener decision, sender override,
 *  snippet, alias or saved search. `value` is the kind's own JSON object. */
export type EmailSettingsItem = {
  id: string;
  kind: EmailSettingsKind;
  position: number;
  value: Record<string, unknown>;
  updatedAt: string;
  deletedAt: string | null;
};

// ── Email compose + attachments (EM-7, desktop engine) ───────────────────────
/** A received message's attachment metadata (bytes fetched on demand, EM-7). */
export type EmailAttachmentMeta = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  isInline: boolean;
  contentId: string | null;
};

/** A file picked for composing (send reads bytes from the path at send time). */
export type EmailPickedAttachment = {
  path: string;
  filename: string;
  mimeType: string;
  size: number;
};

/** A small inline cid image, for substituting `cid:` refs in the reader HTML. */
export type EmailInlineImage = {
  contentId: string;
  mime: string;
  dataBase64: string;
};

/** The full send request (maps to the Rust `email_send_message`). */
export type EmailSendInput = {
  accountId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  textBody: string;
  htmlBody: string | null;
  inReplyTo: string | null;
  references: string[];
  attachments: { filename: string; mimeType: string; path: string }[];
  messageId?: string | null;
  fromName?: string | null;
};

// ── Email module (EM-3 cloud tissue) ─────────────────────────────────────────
/** An account's cloud registry row (address/status/signature/hue) — NO secrets. */
export type EmailAccountRef = {
  id: string;
  workspaceId: string;
  ownerId: string;
  provider: string;
  address: string;
  status: string;
  signatureHtml: string;
  unreadCount: number;
  color: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A tissue thread ref (entity_type 'email_thread') — a deliberately-linked email. */
export type EmailThreadRef = {
  id: string;
  workspaceId: string;
  ownerId: string;
  accountId: string | null;
  threadKey: string;
  messageKey: string | null;
  fromAddr: string | null;
  fromName: string | null;
  subject: string;
  snippet: string;
  sentAt: string | null;
  isSnoozed: boolean;
  snoozeUntil: string | null;
  followUpAt: string | null;
  followUpClearedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmailModuleBundle = {
  accounts: EmailAccountRef[];
  refs: EmailThreadRef[];
  /** True when the migration isn't applied yet (surfaces degrade, never crash). */
  degraded: boolean;
  /** Collections cut at their read ceiling (SCALE-1) — empty = complete. */
  truncated: Truncation[];
};

export type EmailRuntime = {
  /** The rebuilt local mail engine (MR-8); desktop only, absent on the web. */
  engine?: import("./runtime.types.mail-engine").MailEngine;
  /** The rebuilt engine's drafts, send outbox and autocomplete (MR-11); desktop only. */
  compose?: import("./runtime.types.mail-compose").MailComposeEngine;
  /** Device-local storage, disk cap, Clear buttons and default mail app (MR-15); desktop only. */
  settings?: import("./runtime.types.mail-settings").MailSettingsEngine;
  // ── MR-7 mail settings items (Supabase, both platforms) ────────────────
  /** Your live items, or with `since` every row changed after it (tombstones too). */
  listSettings(input?: { since?: string | null }): Promise<EmailSettingsItem[]>;
  /** Create or replace one item by its client-minted id (last write wins per row). */
  upsertSetting(input: {
    id: string;
    kind: EmailSettingsKind;
    value: Record<string, unknown>;
    position?: number | null;
  }): Promise<EmailSettingsItem>;
  /** Tombstone one of your items; false when it wasn't yours or already gone. */
  deleteSetting(input: { id: string }): Promise<boolean>;
  listAccounts(): Promise<any[]>;
  connectAndSave(input: any): Promise<any>;
  disconnect(accountId: string): Promise<void>;
  syncNow(input: { accountId?: string | null; folder?: string | null }): Promise<any>;
  /** Change how far back this device syncs an account (IM-2c, AC8). Raising
   *  it backfills the gap in the background; lowering it stops fetching and
   *  deletes nothing. Per-device — the mail store is local. */
  setHistoryDepth(input: { accountId: string; depth: string }): Promise<any>;
  /** Gmail "Sign in with Google" (EM-2, desktop-only): runs the PKCE flow,
   *  stores tokens in the OS keychain, registers the account. */
  startGoogleOAuth(input: { workspaceId?: string | null; historyDepth?: string }): Promise<any>;
  /** Per-account server escalation for the ⌘K "Search older mail" row (MR-13):
   *  Gmail X-GM-RAW / IMAP SEARCH with an honest status. */
  searchServer(input: { accountId: string; query: string; limit?: number }): Promise<{
    status: "ok" | "timeout" | "unsupported" | "error";
    message?: string | null;
    envelopes: any[];
  }>;

  // ── EM-3 cloud "tissue" surface (Supabase-first, both platforms) ────────
  // A thread reaches the cloud ONLY via a deliberate action (convert / link /
  // snooze / follow-up / tag); plain reading writes nothing (AC14 privacy).
  // Reads DEGRADE to empty pre-migration; writes = email_op_* RPCs.
  /** Owner's account registry + the workspace's tissue thread refs. */
  listModule(workspaceId: string): Promise<EmailModuleBundle>;
  /** Register/refresh the cloud row for a desktop-connected account (no secret). */
  upsertAccountRef(input: {
    workspaceId: string;
    provider: string;
    address: string;
    signatureHtml?: string | null;
    color?: string | null;
    status?: string | null;
    unreadCount?: number | null;
  }): Promise<EmailAccountRef>;
  removeAccountRef(input: { workspaceId: string; accountId: string }): Promise<void>;
  /** Pull a thread into the tissue (idempotent by thread key); registers the entity. */
  upsertRef(input: {
    workspaceId: string;
    threadKey: string;
    accountId?: string | null;
    messageKey?: string | null;
    fromAddr?: string | null;
    fromName?: string | null;
    subject?: string;
    snippet?: string;
    sentAt?: string | null;
  }): Promise<EmailThreadRef>;
  snooze(input: {
    workspaceId: string;
    refId: string;
    snoozeUntil: string;
  }): Promise<EmailThreadRef>;
  unsnooze(input: { workspaceId: string; refId: string }): Promise<EmailThreadRef>;
  /** A snooze became due: unsnooze the ref + write the owner-targeted due
   *  activity (→ one notification). Called by the restore scheduler (EM-6). */
  snoozeDue(input: { workspaceId: string; refId: string }): Promise<EmailThreadRef>;
  followUp(input: {
    workspaceId: string;
    refId: string;
    followUpAt: string;
  }): Promise<EmailThreadRef>;
  clearFollowUp(input: { workspaceId: string; refId: string }): Promise<EmailThreadRef>;
  /** A follow-up deadline passed with no reply: one-shot due notification.
   *  Returns null when there's nothing to do (not awaiting / already notified). */
  followUpDue(input: { workspaceId: string; refId: string }): Promise<EmailThreadRef | null>;
  /** Remove a tissue ref + its links + registry entry (convert-undo cleanup, EM-8). */
  removeRef(input: { workspaceId: string; refId: string }): Promise<void>;
  /** Link an email_thread to any entity through the spine keystone (idempotent). */
  linkThread(input: {
    workspaceId: string;
    threadId: string;
    targetType: string;
    targetId: string;
    relationKind?: string;
    origin?: string;
    threadLabel?: string | null;
    targetLabel?: string | null;
    targetIcon?: string | null;
  }): Promise<unknown>;
};

export type * from "./runtime.types.mail-engine";
export type * from "./runtime.types.mail-compose";
export type * from "./runtime.types.mail-settings";
export { mailViewKey } from "./runtime.types.mail-engine";
