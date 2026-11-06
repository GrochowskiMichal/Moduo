/**
 * The rebuilt engine's compose port (specs/mail-rebuild.md decision 13, MR-11).
 *
 * Drafts are local rows saved on every change; the engine uploads them to the
 * server Drafts folder after the 2 s debounce (APPEND, previous copy deleted).
 * Send moves a draft into the persistent outbox with `not_before = now + undo`;
 * Undo inside the window hands the draft back. Shapes mirror the Rust
 * `mail::send` types (`DraftDoc`, `DraftRow`, `SendHandle`, `OutboxItem`).
 */

export type MailOutAttachment = {
  filename: string;
  contentType: string;
  /** Opaque staging id from `stageAttachment`/`pickAttachments`; never a file path. */
  id: string;
  size?: number;
};

export type MailDraftDoc = {
  messageId: string;
  fromName: string | null;
  fromAddr: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html: string | null;
  inReplyTo: string | null;
  references: string[];
  attachments: MailOutAttachment[];
  calendarReply?: string | null;
  /** Why the last send failed (set when a failure returns it to Drafts, AC22). */
  lastError: string | null;
};

export type MailDraftRow = {
  id: string;
  accountId: string;
  threadId: string | null;
  doc: MailDraftDoc;
  updatedAtMs: number;
  serverUid: number | null;
  queued: boolean;
};

export type MailSendHandle = { outboxId: string; draftId: string; sendAtMs: number };

export type MailOutboxItem = {
  id: string;
  accountId: string;
  draftId: string | null;
  subject: string;
  to: string[];
  state: string;
  attempts: number;
  lastError: string | null;
  notBeforeMs: number;
};

export type MailSaveDraftInput = {
  /** Omit to create a new draft. */
  draftId?: string | null;
  accountId: string;
  threadId: string | null;
  doc: MailDraftDoc;
};

export type MailComposeEngine = {
  /** Local save; returns the draft id. The server upload follows after the debounce. */
  saveDraft(input: MailSaveDraftInput): Promise<{ draftId: string }>;
  listDrafts(accountId?: string | null): Promise<MailDraftRow[]>;
  getDraft(draftId: string): Promise<MailDraftRow | null>;
  discardDraft(draftId: string): Promise<void>;
  /** Queues the draft with the undo window (seconds; snapped to 5/10/20/30). */
  queueSend(input: { draftId: string; undoSeconds: number }): Promise<MailSendHandle>;
  /** Inside the window: cancels and returns the draft id to reopen (Edit). */
  undoSend(outboxId: string): Promise<{ draftId: string | null }>;
  listOutbox(accountId?: string | null): Promise<MailOutboxItem[]>;
  /** Recipient autocomplete source: correspondents with how often you mailed them. */
  correspondents(input: {
    prefix: string;
    limit: number;
  }): Promise<{ name: string; email: string; count: number }[]>;
  /** The provider's send size limit in bytes (Rust `size_limit`). */
  sizeLimit(accountId: string): Promise<number>;
  /** Copies dropped/pasted bytes into the engine's staging dir; returns the opaque id. */
  stageAttachment(bytes: Uint8Array): Promise<string>;
  /** Opens the native file picker (in the engine) and stages the chosen files. */
  pickAttachments(): Promise<{ id: string; filename: string; size: number }[]>;
  /** Drains `mailto:` URLs macOS handed the app (AC24 deep link), oldest first. */
  takeMailto?(): Promise<string[]>;
  /** Fires when a new `mailto:` deep link is waiting; returns the unsubscribe. */
  onMailto?(cb: () => void): () => void;
};
