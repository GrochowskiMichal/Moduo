// The desktop settings port over the Rust mail store (MR-15). Command names
// are the contract the Rust command layer registers.

import { invoke } from "@tauri-apps/api/core";

import type { MailSettingsEngine } from "./runtime.types.mail-settings";

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export function createTauriMailSettings(call: Invoke = invoke): MailSettingsEngine {
  return {
    storageStats: () => call("mail_storage_stats"),
    setDiskCap: (input) => call("mail_set_disk_cap", { input }),
    clearAttachments: (accountId) => call("mail_clear_attachments", { accountId }),
    clearDownloaded: (accountId) => call("mail_clear_downloaded", { accountId }),
    makeDefaultMailApp: () => call("mail_make_default_app"),
    isDefaultMailApp: () => call("mail_is_default_app"),
  };
}
