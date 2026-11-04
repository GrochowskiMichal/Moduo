// The desktop `MailEngine` over the Rust mail engine's `mail_*` commands
// (decision 10). Change sets arrive on one `ipc::Channel` opened by
// `mail_subscribe`; the channel is opened lazily on the first listener and
// shared by every listener after it. Command names and inputs are the
// contract MR-3 (sync) and MR-5 (ops) implement on the Rust side.

import { Channel, invoke } from "@tauri-apps/api/core";

import type { MailEngine, MailEvent } from "./runtime.types.mail-engine";

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type ChannelFactory = (onMessage: (event: MailEvent) => void) => unknown;

export function createTauriMailEngine(
  call: Invoke = invoke,
  channel: ChannelFactory = (onMessage) => {
    const ch = new Channel<MailEvent>();
    ch.onmessage = onMessage;
    return ch;
  },
): MailEngine {
  const listeners = new Set<(event: MailEvent) => void>();
  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    const onEvent = channel((event) => {
      for (const l of listeners) l(event);
    });
    void call("mail_subscribe", { onEvent }).catch((error) => {
      opened = false;
      console.warn("[mail] mail_subscribe failed:", error);
    });
  };
  return {
    listAccounts: () => call("mail_list_accounts"),
    listMailboxes: (accountId) => call("mail_list_mailboxes", { accountId }),
    listThreads: (input) => call("mail_list_threads", { input }),
    counts: () => call("mail_counts"),
    getThread: (threadId) => call("mail_get_thread", { threadId }),
    getRawMessage: (messageId, threadId) =>
      threadId
        ? call("mail_get_raw_message", { threadId, messageId })
        : Promise.reject(new Error("Show original needs the conversation")),
    attachmentFile: (threadId, attachmentId) =>
      call("mail_attachment_file", { threadId, attachmentId }),
    getInvite: (threadId, messageId) => call("mail_get_invite", { threadId, messageId }),
    rsvp: (threadId, messageId, answer) => call("mail_rsvp", { threadId, messageId, answer }),
    unsubscribePlan: (threadId, messageId) =>
      call("mail_unsubscribe_plan", { threadId, messageId }),
    unsubscribe: (threadId, messageId, { allowMailto }) =>
      call("mail_unsubscribe", { threadId, messageId, allowMailto }),
    avatar: (input) => call("mail_avatar", { ...input }),
    setVisible: (threadIds) => call("mail_set_visible", { threadIds }),
    openFolder: (mailboxId) => call("mail_open_folder", { mailboxId }),
    backfill: (accountId) => call("mail_backfill", { accountId }),
    cancelBackfill: (accountId) => call("mail_cancel_backfill", { accountId }),
    setFollowUp: (threadId, dueMs) => call("mail_set_follow_up", { input: { threadId, dueMs } }),
    releaseNewSenders: (threadIds) => call("mail_release_new_senders", { threadIds }),
    applyOp: (input) => call("mail_apply_op", { input }),
    undoOp: (opId) => call("mail_undo_op", { opId }),
    listFailedOps: () => call("mail_list_failed_ops"),
    retryOp: (opId) => call("mail_retry_op", { opId }),
    discardOp: (opId) => call("mail_discard_op", { opId }),
    search: (input) => call("mail_search", { input }),
    setForeground: (foreground) => call("mail_set_foreground", { foreground }),
    subscribe(listener) {
      listeners.add(listener);
      open();
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
