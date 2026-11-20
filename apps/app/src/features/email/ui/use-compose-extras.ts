// What the composer needs from the engines beyond the session (specs/mail-v3.md
// §9, MV-3, MV-10): the account's send limit and provider, the per-query correspondents
// read, and who introduced you in the message replied to. Also the open spec
// for reopening a saved draft (Fix and send, Outbox Edit) and the connect
// dialog's reconnect target for an engine account.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { MailComposeEngine, MailDraftRow } from "@/lib/runtime.types.mail-compose";
import type { MailAccount, MailEngine } from "@/lib/runtime.types.mail-engine";

import { plainToHtml } from "../compose";
import { detectIntroducer } from "../compose/intro";
import type { ComposeOpenSpec, ComposeSession, ComposeState } from "../compose/session";
import type { SendLimit } from "../compose/size-limit";
import type { MailboxProvider, SavedAccount } from "../model/email-types";

type Correspondent = { name: string; email: string; count: number };

const NO_SESSION = () => () => {};
const NONE = () => null;
/** How many correspondents one typed query reads. */
const SUGGEST_LIMIT = 8;

function useActiveCompose(session: ComposeSession | null): ComposeState | null {
  return useSyncExternalStore(
    session?.subscribe ?? NO_SESSION,
    session ? () => session.active : NONE,
  );
}

/** One async read per `key`, null until it answers (or when it fails). */
function useRead<T>(key: string | null, read: () => Promise<T>): T | null {
  const [value, setValue] = useState<{ key: string; value: T } | null>(null);
  useEffect(() => {
    if (key === null) return;
    let gone = false;
    void read().then(
      (v) => !gone && setValue({ key, value: v }),
      () => {},
    );
    return () => {
      gone = true;
    };
    // `read` is rebuilt every render; `key` names what it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return value && value.key === key ? value.value : null;
}

export function useComposeExtras(input: {
  port: MailComposeEngine | null;
  session: ComposeSession | null;
  engine: MailEngine | null;
  accounts: readonly MailAccount[];
}): {
  sizeLimit: SendLimit | null;
  suggestPeople?: (query: string) => Promise<Correspondent[]>;
  introducer: string | null;
} {
  const { port, engine, accounts } = input;
  const active = useActiveCompose(input.session);
  // No `active!.x` inside a closure: the React Compiler reads a closure's dependencies
  // unconditionally, so `active!.accountId` there throws while nothing is composed.
  const accountId = active?.accountId ?? null;
  const bytes = useRead(port && accountId !== null ? `size:${accountId}` : null, () =>
    port && accountId !== null ? port.sizeLimit(accountId) : Promise.resolve(0),
  );
  const provider = accounts.find((a) => a.id === accountId)?.provider ?? null;
  // The To field asks per typed query (debounced there), not a pool read up front.
  const suggestPeople = useMemo(
    () =>
      port
        ? (query: string) => port.correspondents({ prefix: query, limit: SUGGEST_LIMIT })
        : undefined,
    [port],
  );
  const replyTo =
    engine && active?.threadId && (active.kind === "reply" || active.kind === "reply-all")
      ? active.threadId
      : null;
  const composeKey = active?.key ?? null;
  const introducer = useRead(replyTo ? `intro:${composeKey}` : null, async () => {
    const thread = engine && replyTo ? await engine.getThread(replyTo) : null;
    return thread
      ? detectIntroducer(
          thread.messages,
          accounts.map((a) => a.address),
        )
      : null;
  });
  return {
    sizeLimit: bytes ? { bytes, provider } : null,
    suggestPeople,
    introducer,
  };
}

/** Reopens a saved draft as it was, with its send error when one returned it (AC11). */
export function draftOpenSpec(draft: MailDraftRow): ComposeOpenSpec {
  const { doc } = draft;
  const threaded = draft.threadId !== null;
  return {
    kind: threaded ? "reply" : "new",
    accountId: draft.accountId,
    threadId: draft.threadId,
    draftId: draft.id,
    fromAddr: doc.fromAddr,
    fromName: doc.fromName,
    to: doc.to.join(", "),
    cc: doc.cc.join(", "),
    bcc: doc.bcc.join(", "),
    subject: doc.subject,
    bodyHtml: doc.html ?? plainToHtml(doc.text),
    inReplyTo: doc.inReplyTo,
    references: doc.references,
    attachments: doc.attachments,
    fromInbox: false,
    lastError: doc.lastError,
  };
}

const CONNECT_PROVIDER: Record<MailAccount["provider"], MailboxProvider> = {
  gmail: "gmail",
  google_workspace: "gmail",
  icloud: "icloud",
  outlook: "outlook",
  imap: "custom",
};

/** The connect dialog's reconnect target for an engine account (provider and address locked). */
export function reconnectTarget(account: MailAccount): SavedAccount {
  return {
    id: account.id,
    provider: CONNECT_PROVIDER[account.provider] ?? "custom",
    email: account.address,
    lastSyncAt: account.lastSyncedMs ? new Date(account.lastSyncedMs).toISOString() : null,
    status: account.syncState === "reconnect" ? "reauth_required" : "error",
    lastError: account.lastError,
    historyDepth: account.historyDepth,
  };
}
