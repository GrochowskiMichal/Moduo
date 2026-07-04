export type ConnectionStatus = "disconnected" | "connecting" | "connected";
export type MailboxProvider = "gmail" | "outlook" | "icloud" | "custom";
export type FolderType = "inbox" | "sent" | "drafts" | "trash" | "spam";
export type AccountStatus = "active" | "reauth_required" | "error";

export interface Email {
  id: string;
  messageKey: string;
  uid: number;
  sender: string;
  senderEmail: string;
  to?: string;
  subject: string;
  preview: string;
  body?: string;
  bodyHtml?: string | null;
  hasCachedBody?: boolean;
  date: string;
  read: boolean;
  starred?: boolean;
  folder: string;
  tags?: string[];
  accountId?: string;
  accountEmail?: string;
}

export interface SavedAccount {
  id: string;
  workspaceId?: string | null;
  provider: MailboxProvider;
  email: string;
  imapHost?: string | null;
  smtpHost?: string | null;
  imapPort?: number | null;
  smtpPort?: number | null;
  lastSyncAt: string | null;
  status: AccountStatus;
  lastError: string | null;
}

/** A synced message envelope (the `email_list_envelopes` / `email_get_thread` DTO). */
export interface EmailEnvelope {
  id: string;
  messageKey: string;
  accountId: string;
  folder: string;
  uid: number;
  sender: string;
  senderEmail: string;
  to: string;
  subject: string;
  preview: string;
  date: string;
  read: boolean;
  starred: boolean;
  size?: number | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  threadId: string;
  hasCachedBody: boolean;
}

/** A conversation row for the unified inbox — one per (account, thread). */
export interface EmailThread {
  threadId: string;
  accountId: string;
  accountEmail: string;
  subject: string;
  /** Unique sender display names in chronological order (oldest → newest). */
  participants: string[];
  /** Most-recent sender (for the row + contact resolution). */
  fromName: string;
  fromEmail: string;
  snippet: string;
  /** Most-recent message date (raw string) + its epoch-ms for sorting. */
  date: string;
  timestampMs: number;
  messageCount: number;
  unread: boolean;
  unreadCount: number;
  /** Any message flagged (pin/star). */
  starred: boolean;
  folder: string;
  /** UID of the newest message (for opening / prefetch). */
  latestUid: number;
}

/** A server folder from `email_list_folders` (for the move popover). */
export interface EmailFolderInfo {
  name: string;
  displayName: string;
  delimiter?: string | null;
  selectable: boolean;
}
