export type EmailProvider = "gmail" | "outlook" | "apple" | "custom";
export type EmailAuthMode = "oauth" | "app_password" | "smtp_imap" | "smtp_pop3";
export type EmailAccountStatus = "active" | "reauth_required" | "error" | "disabled";
export type EmailFolderKind = "inbox" | "sent" | "drafts" | "trash" | "custom";
export type EmailSyncStatus = "idle" | "syncing" | "synced" | "error";

export type EmailAddress = {
  name?: string | null;
  email: string;
};

export type EmailAccount = {
  id: string;
  userId: string;
  workspaceId: string;
  provider: EmailProvider;
  authMode: EmailAuthMode;
  emailAddress: string;
  displayName: string | null;
  status: EmailAccountStatus;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmailFolder = {
  id: string;
  accountId: string;
  remoteId: string;
  name: string;
  kind: EmailFolderKind;
  createdAt: string;
  updatedAt: string;
};

export type EmailThread = {
  id: string;
  accountId: string;
  folderId: string;
  remoteId: string;
  subject: string | null;
  snippet: string | null;
  fromName: string | null;
  fromEmail: string | null;
  lastMessageAt: string | null;
  isUnread: boolean;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type EmailMessageDirection = "inbound" | "outbound";

export type EmailMessage = {
  id: string;
  threadId: string;
  accountId: string;
  remoteId: string;
  direction: EmailMessageDirection;
  from: EmailAddress | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  sentAt: string | null;
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
};

export type EmailSendInput = {
  accountId: string;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  replyThreadId?: string | null;
};

export type EmailThreadPage = {
  threads: EmailThread[];
  nextCursor: string | null;
};

export type EmailComposeDraft = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyText: string;
};

export type EmailLocalOutbox = {
  id: string;
  accountId: string;
  payload: EmailSendInput;
  createdAt: string;
  status: "queued" | "sending" | "sent" | "failed";
  lastError: string | null;
};
