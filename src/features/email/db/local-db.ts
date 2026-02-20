import Dexie, { type Table } from "dexie";
import type { EmailAccount, EmailFolder, EmailLocalOutbox, EmailMessage, EmailThread } from "../types";

type LocalMetaKV = { key: string; value: string };

export class EmailLocalDB extends Dexie {
  accounts!: Table<EmailAccount, string>;
  folders!: Table<EmailFolder, string>;
  threads!: Table<EmailThread, string>;
  messages!: Table<EmailMessage, string>;
  outbox!: Table<EmailLocalOutbox, string>;
  meta!: Table<LocalMetaKV, string>;

  constructor() {
    super("moduo_email_v1");
    this.version(1).stores({
      accounts: "id, workspaceId, userId, [workspaceId+status], updatedAt",
      folders: "id, accountId, [accountId+kind], updatedAt",
      threads: "id, accountId, folderId, [accountId+folderId], lastMessageAt, isUnread, updatedAt",
      messages: "id, accountId, threadId, [threadId+sentAt], sentAt, updatedAt",
      outbox: "id, accountId, status, createdAt",
      meta: "key",
    });
  }
}

export const emailLocalDB = new EmailLocalDB();

export async function getEmailMetaValue(key: string): Promise<string | null> {
  const row = await emailLocalDB.meta.get(key);
  return row?.value ?? null;
}

export async function setEmailMetaValue(key: string, value: string): Promise<void> {
  await emailLocalDB.meta.put({ key, value });
}
