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
  MailClassifyStage,
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
  /** "Remind me if no reply" due time (specs/mail-v3.md decision 7), else null. */
  followUpAtMs?: number | null;
  /** Why it came back to the Inbox: a snooze ran out, or a reply woke it. */
  returnReason?: MailReturnReason | null;
  /** Set while the thread's send waits in the Outbox (engine `outbox.state`). */
  outboxState?: MailOutboxState | null;
};

export type MailReturnReason = "snooze" | "reply";
export type MailOutboxState = "pending" | "in_flight";

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
  /** When this account last finished a sync round on this Mac (store v2), else null. */
  lastSyncedMs?: number | null;
  /** True when new mail is pushed (IDLE / Gmail push); false when polled every minute. */
  push?: boolean;
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
export type MailCounts = {
  byViewKey: Record<string, number>;
  badge: number;
  /** Sends waiting in the Outbox (pending or in flight); the rail shows Outbox only above 0. */
  outbox?: number;
  /** Triage ops saved on this device and not yet on the server (the offline line, spec §4). */
  pendingOps?: number;
};

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

export type MailThread = {
  row: MailThreadRow;
  messages: MailMessage[];
  /** "Always" load images from this sender, on this Mac (engine kv `images_allow:<address>`). */
  imagesAllowed?: boolean;
};

/** Why a thread sits in its tab (`mail_explain`, specs/mail-v3.md decision 3). `stage`
 *  is null only when the thread predates stored reasons and has no headers to re-run. */
export type MailExplain = {
  stage: MailClassifyStage | null;
  ruleId: string | null;
  customTabId: string | null;
  /** The sender address the decision was about. */
  address: string;
  tab: MailTabKind;
};

/** A rule run over mail already on this Mac (`mail_apply_rule_existing`). */
export type MailApplyRuleResult = {
  /** Threads the rule matches (the dry run) or acted on (the apply). */
  count: number;
  /** The one undoable bulk op's ids; empty on a dry run. */
  opIds: string[];
};

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
  /** The first thread's subject, for "Done · Workshop materials" in the failed line. */
  subject?: string | null;
};

/** `applyOp`'s answer: the undoable op ids and when the undo window closes (engine clock). */
export type MailApplyOpResult = { opIds: string[]; undoUntilMs?: number };

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
  | { kind: "draft_changed"; draftId: string; serverUid?: number | null };

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
  applyOp(input: MailOpInput): Promise<MailApplyOpResult>;
  /** Why this thread is in its tab: the stored classifier stage, or a re-run on its headers. */
  explainThread?(threadId: string): Promise<MailExplain>;
  /** Counts (dryRun) or applies a rule to the threads already on this Mac, as one bulk op. */
  applyRuleExisting?(input: { ruleId: string; dryRun: boolean }): Promise<MailApplyRuleResult>;
  /** Remembers (or forgets) "Always load images" for a sender, on this Mac only. */
  setImageAllow?(address: string, allow: boolean): Promise<void>;
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
