/** The runtime port's email (implemented in runtime.web.email.ts). */

import type { Truncation } from "./paged-select";

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
  listAccounts(): Promise<any[]>;
  connectAndSave(input: any): Promise<any>;
  disconnect(accountId: string): Promise<void>;
  listEnvelopes(input: {
    accountId?: string | null;
    folder: string;
    limit?: number;
    forceSync?: boolean;
  }): Promise<any>;
  getMessageBody(input: { accountId: string; folder: string; uid: number }): Promise<any>;
  prefetchBodies(input: {
    accountId: string;
    folder: string;
    uids: number[];
    limit?: number;
  }): Promise<any>;
  syncNow(input: { accountId?: string | null; folder?: string | null }): Promise<any>;
  setActivityState(input: {
    mode: "mailForeground" | "appForegroundNonMail" | "appBackground";
    activeAccountId?: string | null;
    activeFolder?: string | null;
  }): Promise<void>;
  applyFlag(input: {
    accountId: string;
    folder: string;
    uid: number;
    flag: "seen" | "starred";
    value: boolean;
  }): Promise<any>;
  getMailboxStatus(input?: { accountId?: string | null }): Promise<any[]>;
  /** Change how far back this device syncs an account (IM-2c, AC8). Raising
   *  it backfills the gap in the background; lowering it stops fetching and
   *  deletes nothing. Per-device — the mail store is local. */
  setHistoryDepth(input: { accountId: string; depth: string }): Promise<any>;
  sendSaved(input: {
    accountId: string;
    to: string;
    subject: string;
    body: string;
  }): Promise<boolean>;
  /** Gmail "Sign in with Google" (EM-2, desktop-only): runs the PKCE flow,
   *  stores tokens in the OS keychain, registers the account. */
  startGoogleOAuth(input: { workspaceId?: string | null; historyDepth?: string }): Promise<any>;
  /** All messages of a thread (EM-4), oldest→newest, across folders. */
  getThread(input: { accountId: string; threadId: string }): Promise<any>;
  /** LIST the account's server folders, delimiter-aware (EM-5). */
  listFolders(input: { accountId: string }): Promise<any[]>;
  /** Archive / move / delete a message via the op outbox (EM-5). Optimistic —
   *  the row leaves the current folder locally, the IMAP step queues + retries. */
  applyMessageOp(input: {
    accountId: string;
    folder: string;
    uid: number;
    op: "archive" | "move" | "delete";
    destFolder?: string | null;
  }): Promise<any>;
  /** Snooze a thread — move its inbox messages to Moduo/Snoozed (create-if-
   *  missing, delimiter-aware). `local_hide` = the server refused the folder;
   *  the caller keeps the thread hidden locally instead (EM-6). */
  snoozeThread(input: {
    accountId: string;
    threadId: string;
    uids: number[];
  }): Promise<{ strategy: "server_move" | "local_hide"; mailbox: string | null }>;
  /** Restore a snoozed thread — move its messages from Moduo/Snoozed back to the
   *  inbox. Idempotent (0 when nothing matches / the folder is absent). */
  snoozeRestore(input: { accountId: string; threadId: string }): Promise<{ restored: number }>;
  /** Send a message (reply/forward/new) — HTML+plain multipart, cc/bcc, reply
   *  headers, attachments from disk paths; copy to Sent (Gmail skips). EM-7. */
  sendMessage(input: EmailSendInput): Promise<{ messageId: string; savedToSent: boolean }>;
  /** A received message's attachment metadata (no bytes; EM-7/AC4). */
  listAttachments(input: {
    accountId: string;
    folder: string;
    uid: number;
  }): Promise<EmailAttachmentMeta[]>;
  /** Decode one attachment + write it to disk via a native Save dialog. */
  saveAttachment(input: {
    accountId: string;
    folder: string;
    uid: number;
    attachmentId: string;
    defaultFilename: string;
  }): Promise<{ saved: boolean; path: string | null }>;
  /** Native multi-file open dialog → paths for composing. */
  pickAttachments(): Promise<EmailPickedAttachment[]>;
  /** Small inline `cid:` images (<2MB) for substituting into the reader HTML. */
  getInlineImages(input: {
    accountId: string;
    folder: string;
    uid: number;
  }): Promise<EmailInlineImage[]>;
  /** Local body-text search (EM-9): scan the 8KB body-text sidecar → matching
   *  envelopes. The instant sender/subject match is done client-side over the
   *  in-memory envelopes; this covers deep-body hits the preview misses. */
  searchBodies(input: {
    accountId?: string | null;
    folder?: string | null;
    query: string;
  }): Promise<any[]>;
  /** Per-account server escalation (EM-9): Gmail X-GM-RAW / IMAP SEARCH with an
   *  honest status. Hits are upserted so a result's body fetches normally. */
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
