// The desktop compose port over the Rust `mail::send` store (decision 13).
// Command names are the contract the Rust command layer registers.

import { invoke } from "@tauri-apps/api/core";

import type { MailComposeEngine } from "./runtime.types.mail-compose";

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export function createTauriMailCompose(call: Invoke = invoke): MailComposeEngine {
  return {
    saveDraft: (input) => call("mail_save_draft", { input }),
    listDrafts: (accountId) => call("mail_list_drafts", { accountId: accountId ?? null }),
    getDraft: (draftId) => call("mail_get_draft", { draftId }),
    discardDraft: (draftId) => call("mail_discard_draft", { draftId }),
    queueSend: (input) => call("mail_queue_send", { input }),
    undoSend: (outboxId) => call("mail_undo_send", { outboxId }),
    listOutbox: (accountId) => call("mail_list_outbox", { accountId: accountId ?? null }),
    correspondents: (input) => call("mail_correspondents", { input }),
    sizeLimit: (accountId) => call("mail_size_limit", { accountId }),
  };
}
