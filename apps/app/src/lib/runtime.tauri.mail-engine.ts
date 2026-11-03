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
