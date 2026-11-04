/**
 * The rebuilt desktop mail engine's port (specs/mail-rebuild.md decisions 10–12).
 *
 * Reads are windowed keyset queries returning compact rows (no bodies, no
 * references); writes are commands the engine applies locally first; changes
 * arrive as compact change sets on one event stream. The Tauri implementation
 * lands in MR-8 over `mail_*` commands and an `ipc::Channel`; the fixture
 * engine (`features/email/testing/fake-engine.ts`) implements the same type.
 */

import type {
  MailBlockDestination,
  MailBodyState,
  MailMailboxRole,
  MailOpKind,
  MailOpState,
  MailProvider,
  MailSyncState,
  MailTabKind,
} from "@contracts/mail";

/** Which list a window reads. Unified views span every account by role. */
export type MailView =
  | { kind: "unified"; role: MailMailboxRole }
  | { kind: "mailbox"; mailboxId: string }
  | { kind: "snoozed" }
  | { kind: "followups" }
  | { kind: "new_senders" }
  | { kind: "outbox" };

/** A tab within a view; custom tabs carry their id. */
export type MailTab = { kind: MailTabKind; customTabId?: string | null };

/** Stable string key for a (view, tab) pair, used by `threads_changed`. */
export function mailViewKey(view: MailView, tab?: MailTab | null): string {
  const v =
    view.kind === "unified"
      ? `unified:${view.role}`
      : view.kind === "mailbox"
        ? `mailbox:${view.mailboxId}`
        : view.kind;
  if (!tab) return v;
  return tab.kind === "custom" ? `${v}|custom:${tab.customTabId ?? ""}` : `${v}|${tab.kind}`;
}

/** Opaque keyset cursor: the last row's (lastDateMs, threadId). */
export type MailCursor = { lastDateMs: number; threadId: string };

/** One list row (~14 fields, decision 10). */
export type MailThreadRow = {
  threadId: string;
  accountId: string;
  subject: string;
  snippet: string;
  /** Display senders, newest last. */
  senders: { name: string; email: string }[];
  lastDateMs: number;
  messageCount: number;
  unread: boolean;
  pinned: boolean;
  hasAttachments: boolean;
  hasInvite: boolean;
  tab: MailTabKind;
  priority: boolean;
  muted: boolean;
  snoozedUntilMs: number | null;
};

export type MailListPage = { rows: MailThreadRow[]; next: MailCursor | null };

export type MailListInput = {
  view: MailView;
  tab?: MailTab | null;
  after?: MailCursor | null;
  limit: number;
};

export type MailAccount = {
  id: string;
  address: string;
  displayName: string;
  provider: MailProvider;
  hue: number;
  syncState: MailSyncState;
  /** 0–1 while backfilling, else null. */
  backfillProgress: number | null;
  lastError: string | null;
};

export type MailMailbox = {
  id: string;
  accountId: string;
  name: string;
  path: string;
  role: MailMailboxRole;
  unread: number;
  total: number;
};

/** Unread counts per view key (see `mailViewKey`) plus the badge number. */
export type MailCounts = { byViewKey: Record<string, number>; badge: number };

export type MailAttachment = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  isInline: boolean;
  contentId: string | null;
};

export type MailMessage = {
  id: string;
  messageId: string;
  from: { name: string; email: string };
  to: { name: string; email: string }[];
  cc: { name: string; email: string }[];
  dateMs: number;
  subject: string;
  snippet: string;
  unread: boolean;
  bodyState: MailBodyState;
  html: string | null;
  text: string | null;
  /** Offset in `text` where quoted history starts, if found. */
  quoteOffset: number | null;
  trackerCount: number;
  attachments: MailAttachment[];
  listUnsubscribe: string | null;
  hasInvite: boolean;
};

export type MailThread = { row: MailThreadRow; messages: MailMessage[] };

export type MailOpInput = {
  kind: MailOpKind;
  threadIds: string[];
  /** move: target mailbox id; snooze: untilMs; label_*: label; block: destination. */
  args?: {
    mailboxId?: string;
    untilMs?: number;
    label?: string;
    destination?: MailBlockDestination;
  };
};

export type MailOpRecord = {
  opId: string;
  kind: MailOpKind;
  threadIds: string[];
  state: MailOpState;
  attempts: number;
  lastError: string | null;
  createdAtMs: number;
};

/** The ⌘K query as `features/email/search/query.ts` parses it (decision 17);
 * the Rust store's `SearchQuery` deserializes this shape. */
export type MailSearchQuery = {
  words: string[];
  from: string[];
  to: string[];
  subject: string[];
  hasAttachment: boolean;
  isUnread: boolean;
  isPinned: boolean;
  inRole: MailMailboxRole | null;
  inMailboxId: string | null;
  beforeMs: number | null;
  afterMs: number | null;
};

export type MailSearchInput = {
  query: MailSearchQuery;
  limit: number;
  accountId?: string | null;
};

/** Engine → UI change sets (decision 10, `MAIL_EVENT_KINDS`). */
export type MailEvent =
  | { kind: "threads_changed"; viewKeys: string[]; threadIds: string[] }
  | { kind: "counts"; counts: MailCounts }
  | { kind: "sync_status"; accountId: string; state: MailSyncState; progress: number | null }
  | { kind: "op_failed"; op: MailOpRecord }
  | { kind: "new_mail"; accountId: string; threadIds: string[] }
  | { kind: "draft_changed"; draftId: string };

export type MailEngine = {
  listAccounts(): Promise<MailAccount[]>;
  listMailboxes(accountId: string): Promise<MailMailbox[]>;
  listThreads(input: MailListInput): Promise<MailListPage>;
  counts(): Promise<MailCounts>;
  getThread(threadId: string): Promise<MailThread | null>;
  /** The raw RFC 822 source for "Show original" (AC16); absent hides the button. */
  getRawMessage?(messageId: string): Promise<string>;
  /** Applies locally in the same call and returns the undoable op ids (decision 12). */
  applyOp(input: MailOpInput): Promise<{ opIds: string[] }>;
  /** Inside the window: cancels; after it: enqueues the compensating op. */
  undoOp(opId: string): Promise<void>;
  listFailedOps(): Promise<MailOpRecord[]>;
  retryOp(opId: string): Promise<void>;
  /** Drops the op and restores the server's state locally (AC12). */
  discardOp(opId: string): Promise<void>;
  search(input: MailSearchInput): Promise<MailThreadRow[]>;
  setForeground(foreground: boolean): Promise<void>;
  /** Subscribe to change sets; returns the unsubscribe function. */
  subscribe(listener: (event: MailEvent) => void): () => void;
};
