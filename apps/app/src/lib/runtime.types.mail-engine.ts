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
  /** This device's history depth (`threeMonths` … `everything`). */
  historyDepth?: string;
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

export type MailAttachmentFile = {
  path: string;
  /** `file://` URL for Finder's DownloadURL drag. */
  fileUrl: string;
  /** Inline `data:` URL for the preview (images and PDFs up to 8 MB). */
  dataUrl: string | null;
};

export type MailRsvp = "accept" | "maybe" | "decline";

export type MailInviteInfo = {
  uid: string;
  method: "REQUEST" | "CANCEL" | "REPLY";
  summary: string;
  startMs: number;
  endMs: number;
  location: string | null;
  organizer: { name: string; email: string } | null;
  myStatus: "ACCEPTED" | "TENTATIVE" | "DECLINED" | null;
  canRsvp: boolean;
};

export type MailUnsubscribeMethod =
  | { kind: "oneClick"; url: string }
  | { kind: "mailto"; to: string; subject: string | null; body: string | null }
  | { kind: "web"; url: string };

export type MailUnsubscribeOutcome = {
  method: "one_click" | "mailto" | "web";
  /** False for `web`: the app opens `url`. */
  done: boolean;
  url: string | null;
  fellBack: boolean;
  error: string | null;
};

export type MailAvatarInput = {
  email: string;
  name: string | null;
  contactPhoto: string | null;
};

/** Mirrored into the engine's kv; the engine reads them, never a per-call flag. */
export type MailReaderPrefs = { senderLogos: boolean; undoSendSeconds: number };

export type MailAvatar =
  | { kind: "contact"; url: string }
  | { kind: "logo"; dataUrl: string }
  | { kind: "initials"; initials: string };

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
  /** The raw RFC 822 source for "Show original" (AC16); absent hides the button.
   * The desktop engine needs the thread (message ids are unique per thread). */
  getRawMessage?(messageId: string, threadId?: string): Promise<string>;
  /** Downloads (or reuses) an attachment's local file (AC17). */
  attachmentFile?(threadId: string, attachmentId: string): Promise<MailAttachmentFile>;
  /** The message's calendar invite, or null (AC18). */
  getInvite?(threadId: string, messageId: string): Promise<MailInviteInfo | null>;
  /** Queues the iTIP REPLY to the organizer. */
  rsvp?(threadId: string, messageId: string, answer: MailRsvp): Promise<void>;
  /** The newsletter's unsubscribe methods in the order they'd be tried (AC19). */
  unsubscribePlan?(threadId: string, messageId: string): Promise<MailUnsubscribeMethod[]>;
  /** One-click, then mailto (only when allowed, after a confirm), then the web page. */
  unsubscribe?(
    threadId: string,
    messageId: string,
    opts: { allowMailto: boolean },
  ): Promise<MailUnsubscribeOutcome>;
  /** Contact photo → own-domain logo → initials (AC31). */
  avatar?(input: MailAvatarInput): Promise<MailAvatar>;
  /** Sender logos on/off and the undo-send window, for the engine to read. */
  setReaderPrefs?(prefs: MailReaderPrefs): Promise<void>;
  /** Rows on screen: their bodies prefetch first after opened ones (decision 8). */
  setVisible?(threadIds: string[]): Promise<void>;
  /** Rounds a folder now (opening it in the rail). */
  openFolder?(mailboxId: string): Promise<void>;
  /** Walks history below the synced floor; progress arrives as sync_status. */
  backfill?(accountId: string): Promise<void>;
  cancelBackfill?(accountId: string): Promise<void>;
  /** Arms (dueMs) or clears (null) "Remind me if no reply"; feeds the followups view. */
  setFollowUp?(threadId: string, dueMs: number | null): Promise<void>;
  /** Allow or Block decided: these threads leave New senders. */
  releaseNewSenders?(threadIds: string[]): Promise<void>;
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
