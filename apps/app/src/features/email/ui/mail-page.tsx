// `/email` on the rebuilt engine (MR-16 cutover): the shell (MR-9), the reader
// (MR-10), compose (MR-11) and the connect dialog, all reading the mail store
// the app-chrome `MailEngineProvider` fills. Search is ⌘K (MR-13) and the
// settings live in Settings → Mail (MR-15).

import { useEffect, useMemo, useState } from "react";

import { getRuntime } from "@/lib/runtime";
import type { MailComposeEngine } from "@/lib/runtime.types.mail-compose";
import type { MailAccount, MailMessage, MailThread } from "@/lib/runtime.types.mail-engine";

import { createMailCommands } from "../commands/triage";
import { MailComposer } from "../compose/mail-composer";
import { type ComposeKind, type ComposeOpenSpec, createComposeSession } from "../compose/session";
import type { MailKeyId } from "../keys";
import { MailReader } from "../reader/mail-reader";
import { type MailStore, mailStore } from "../store/mail-store";
import { useMailStore } from "../store/use-mail-store";
import { EmailConnectDialog } from "./email-connect-dialog";
import { EmailSnoozePicker } from "./email-snooze-picker";
import { MailShell } from "./mail-shell";

const COMPOSE_INTENTS: Partial<Record<MailKeyId, ComposeKind>> = {
  "email.compose": "new",
  "email.reply": "reply",
  "email.reply-all": "reply-all",
  "email.forward": "forward",
};

type Person = { name: string; email: string };

function replyRecipients(kind: ComposeKind, last: MailMessage | null, self: string) {
  if (!last || kind === "new" || kind === "forward") return { to: "", cc: "" };
  if (kind === "reply") return { to: last.from.email, cc: "" };
  const others = (p: Person) => p.email.toLowerCase() !== self.toLowerCase();
  return {
    to: last.from.email,
    cc: [...last.to, ...last.cc]
      .filter(others)
      .map((p) => p.email)
      .join(", "),
  };
}

/** What a reply, reply-all, forward or new message opens with. */
export function composeSpec(
  kind: ComposeKind,
  thread: MailThread | null,
  account: MailAccount,
): ComposeOpenSpec {
  const last = thread?.messages.at(-1) ?? null;
  const threaded = kind !== "forward" && last !== null;
  return {
    kind,
    placement: thread ? "inline" : "pane",
    accountId: account.id,
    threadId: threaded ? (thread?.row.threadId ?? null) : null,
    fromAddr: account.address,
    fromName: account.displayName || null,
    ...replyRecipients(kind, last, account.address),
    bcc: "",
    subject: thread ? `${kind === "forward" ? "Fwd" : "Re"}: ${thread.row.subject}` : "",
    bodyHtml: "",
    inReplyTo: threaded ? last.messageId : null,
    references: threaded ? [last.messageId] : [],
    attachments: [],
    fromInbox: thread !== null,
  };
}

export type MailPageProps = {
  store?: MailStore;
  /** The compose port; defaults to the runtime's (desktop) when present. */
  compose?: MailComposeEngine | null;
  initialThreadId?: string | null;
  onConsumeThreadDeepLink?: () => void;
};

export function MailPage({
  store = mailStore,
  compose,
  initialThreadId = null,
  onConsumeThreadDeepLink,
}: MailPageProps) {
  const engine = useMailStore((s) => s.engine, store);
  const behavior = useMailStore((s) => s.behavior, store);
  const accounts = useMailStore((s) => s.accounts, store);
  const version = useMailStore((s) => s.threadsVersion, store);
  const commands = useMemo(() => createMailCommands(store), [store]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [snoozeIds, setSnoozeIds] = useState<string[]>([]);

  useEffect(() => {
    if (initialThreadId) onConsumeThreadDeepLink?.();
  }, [initialThreadId, onConsumeThreadDeepLink]);

  const port = compose === undefined ? (getRuntime()?.email?.compose ?? null) : compose;
  const session = useMemo(
    () =>
      port
        ? createComposeSession({
            port,
            settings: () => {
              const b = store.getState().behavior;
              return { undoSeconds: b.undoSendSeconds, doneOnSend: b.doneOnSend };
            },
            markDone: (threadId) => commands.apply({ kind: "done", threadIds: [threadId] }),
          })
        : null,
    [port, store, commands],
  );

  const openCompose = async (kind: ComposeKind, threadId: string | null) => {
    if (!session) return;
    const thread = threadId && engine ? await engine.getThread(threadId) : null;
    const accountId = thread?.row.accountId ?? accounts[0]?.id;
    const account = accounts.find((a) => a.id === accountId);
    if (account) await session.open(composeSpec(kind, thread, account));
  };

  const onIntent = (intent: MailKeyId, threadIds: string[]) => {
    const kind = COMPOSE_INTENTS[intent];
    if (kind) {
      void openCompose(kind, threadIds[0] ?? null);
      return;
    }
    if (intent === "email.snooze") setSnoozeIds(threadIds);
  };

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col" data-slot="mail-page">
      <div className="flex min-h-0 flex-1">
        <MailShell
          store={store}
          density={behavior.density}
          previewLines={behavior.previewLines}
          showHints={behavior.shortcutHints}
          screenerOn={behavior.screener}
          initialThreadId={initialThreadId}
          onConnect={() => setConnectOpen(true)}
          onReconnect={() => setConnectOpen(true)}
          onIntent={onIntent}
          renderReader={(threadId) => (
            <MailReader engine={engine} threadId={threadId} version={version} behavior={behavior} />
          )}
        />
      </div>
      {session ? (
        <div className="absolute right-4 bottom-4 w-96 max-w-full">
          <MailComposer session={session} spellCheck={behavior.spellCheck} />
        </div>
      ) : null}
      <EmailSnoozePicker
        open={snoozeIds.length > 0}
        onOpenChange={(o) => (o ? null : setSnoozeIds([]))}
        onPick={(at) => {
          const ids = snoozeIds;
          setSnoozeIds([]);
          void commands.apply({ kind: "snooze", threadIds: ids, args: { untilMs: at.getTime() } });
        }}
      >
        <span aria-hidden className="pointer-events-none absolute top-2 left-1/3 h-0 w-0" />
      </EmailSnoozePicker>
      {connectOpen ? <EmailConnectDialog open onOpenChange={setConnectOpen} /> : null}
    </div>
  );
}
