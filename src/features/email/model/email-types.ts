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
