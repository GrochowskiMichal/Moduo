// Where the composer renders (specs/mail-v3.md §9, decision 17): a reply is a
// child of its conversation in the reader; a New message (or a forward) takes
// the reader column while the list stays beside it. There is no floating box.
// This hook also feeds the composer what the page knows: the accounts with
// their rail dots, whether the compose's account is offline, and the engine's
// `draft_changed` (with a server uid) that moves the status to "Saved to Drafts".

import { type ReactNode, useEffect, useMemo, useSyncExternalStore } from "react";

import { LABEL_COLORS } from "@/components/tag-colors";
import type { MailComposeEngine } from "@/lib/runtime.types.mail-compose";
import type { MailAccount, MailEngine } from "@/lib/runtime.types.mail-engine";

import { dispatchOpenSettings } from "../../settings/settings-events";
import type { MailAlias } from "../compose/aliases";
import type { FromAccount } from "../compose/from-line";
import { MailComposer } from "../compose/mail-composer";
import type { Person } from "../compose/recipient-field";
import { composePlacement, type ComposeSession, type ComposeState } from "../compose/session";
import type { MailSnippet } from "../compose/snippets";
import type { useComposeExtras } from "./use-compose-extras";

const NO_SESSION = () => () => {};
const NONE = () => null;

/** Accounts as the composer names them, with the rail's hue order. */
export function fromAccounts(accounts: readonly MailAccount[]): FromAccount[] {
  return accounts.map((a, i) => ({
    id: a.id,
    label: a.displayName || a.address,
    hue: LABEL_COLORS[i % LABEL_COLORS.length]!,
  }));
}

export function useComposerSlot(input: {
  session: ComposeSession | null;
  port: MailComposeEngine | null;
  engine: MailEngine | null;
  accounts: readonly MailAccount[];
  extras: ReturnType<typeof useComposeExtras>;
  aliases?: MailAlias[];
  snippets?: MailSnippet[];
  contacts: Person[];
  spellCheck: boolean;
  now: () => number;
}): { column: ReactNode | null; inline: (threadId: string | null) => ReactNode | null } {
  const { session, port, engine, accounts } = input;
  const active: ComposeState | null = useSyncExternalStore(
    session?.subscribe ?? NO_SESSION,
    session ? () => session.active : NONE,
  );

  // The server has the draft once the engine reports its uid (AC10).
  useEffect(() => {
    if (!engine || !session) return;
    return engine.subscribe((e) => {
      if (e.kind === "draft_changed" && e.serverUid != null) session.markUploaded(e.draftId);
    });
  }, [engine, session]);

  const from = useMemo(() => fromAccounts(accounts), [accounts]);
  if (!session || !active) return { column: null, inline: () => null };

  const offline = accounts.find((a) => a.id === active.accountId)?.syncState === "offline";
  const element = (
    <MailComposer
      session={session}
      accounts={from}
      aliases={input.aliases}
      snippets={input.snippets}
      contacts={input.contacts}
      suggestPeople={input.extras.suggestPeople}
      sizeLimit={input.extras.sizeLimit}
      introducer={input.extras.introducer}
      offline={offline}
      spellCheck={input.spellCheck}
      onOpenSettings={() => dispatchOpenSettings({ section: "mail" })}
      now={input.now}
      stageFile={
        port ? async (f) => port.stageAttachment(new Uint8Array(await f.arrayBuffer())) : undefined
      }
      pickFiles={port ? () => port.pickAttachments() : undefined}
    />
  );
  const inline = composePlacement(active) === "inline";
  return {
    column: inline ? null : element,
    inline: (threadId) => (inline && threadId === active.threadId ? element : null),
  };
}
