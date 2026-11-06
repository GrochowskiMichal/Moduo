/**
 * The rebuilt engine's device-local settings port (specs/mail-rebuild.md
 * §Settings → Mail, MR-15): storage per account (mail and attachments counted
 * apart), the disk cap, both Clear buttons, and "Make Moduo the default mail
 * app". Everything here is this Mac's, never synced. Shapes mirror the Rust
 * store's `StorageStats` (`mail::store::types`).
 */

export type MailStorageStats = {
  accountId: string;
  diskCapBytes: number;
  mailBytes: number;
  attachmentBytes: number;
  messageCount: number;
};

export type MailSettingsEngine = {
  storageStats(): Promise<MailStorageStats[]>;
  setDiskCap(input: { accountId: string; bytes: number }): Promise<void>;
  /** Drops every downloaded attachment of the account; returns how many. */
  clearAttachments(accountId: string): Promise<number>;
  /** Drops bodies, attachments and indexed body text; headers stay searchable. */
  clearDownloaded(accountId: string): Promise<number>;
  /** Routes `mailto:` links to Moduo (macOS NSWorkspace); false when refused. */
  makeDefaultMailApp(): Promise<boolean>;
  /** Whether macOS already routes `mailto:` to Moduo. */
  isDefaultMailApp(): Promise<boolean>;
};
