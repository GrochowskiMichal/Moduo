import type { Email, FolderType, SavedAccount } from "./email-types";

export const FOLDERS: Array<{ id: FolderType; label: string }> = [
  { id: "inbox", label: "Inbox" },
  { id: "sent", label: "Sent" },
  { id: "drafts", label: "Drafts" },
  { id: "trash", label: "Trash" },
  { id: "spam", label: "Spam" },
];

export const EMAIL_CACHE_TTL_MS = 60_000;
export const ACCOUNTS_CACHE_TTL_MS = 30_000;
export const ALL_ACCOUNTS_ID = "__all_accounts__";

type EmailListCacheEntry = {
  emails: Email[];
  fetchedAt: number;
};

type AccountsCacheEntry = {
  accounts: SavedAccount[];
  fetchedAt: number;
};

export const emailListCache = new Map<string, EmailListCacheEntry>();

export const emailCacheState: {
  accountsCache: AccountsCacheEntry | null;
  lastEmailSelection: { accountId: string | null; folder: FolderType };
} = {
  accountsCache: null,
  lastEmailSelection: {
    accountId: null,
    folder: "inbox",
  },
};

export function emailCacheKey(accountId: string, folder: FolderType) {
  return `${accountId}::${folder}`;
}
