// The connect dialog as the page opens it (specs/mail-v3.md AC5, §4): fresh on
// the provider the first-run card picked, or in reconnect mode for one account
// (provider and address locked) when its line's Reconnect is pressed. A custom
// IMAP account's saved hosts come from the runtime's account list, since the
// engine's account row doesn't carry them.

import { useEffect, useMemo, useState } from "react";

import { getRuntime } from "@/lib/runtime";
import type { MailAccount } from "@/lib/runtime.types.mail-engine";

import type { SavedAccount } from "../model/email-types";
import { EmailConnectDialog } from "./email-connect-dialog";
import type { MailConnectProvider } from "./mail-states";
import { reconnectTarget } from "./use-compose-extras";

export type MailConnectRequest = {
  reconnect: MailAccount | null;
  provider?: MailConnectProvider;
};

/** The saved credential row for an account (hosts and ports), when the runtime has one. */
function useSavedAccount(accountId: string | null): SavedAccount | null {
  const [saved, setSaved] = useState<SavedAccount | null>(null);
  useEffect(() => {
    const email = getRuntime()?.email;
    if (!accountId || !email) return;
    let gone = false;
    void email.listAccounts().then(
      (list: SavedAccount[]) => {
        const hit = list.find((a) => a.id === accountId);
        if (!gone && hit) setSaved(hit);
      },
      () => {},
    );
    return () => {
      gone = true;
    };
  }, [accountId]);
  return saved?.id === accountId ? saved : null;
}

export function ConnectSlot({
  request,
  onClose,
}: {
  request: MailConnectRequest | null;
  onClose: () => void;
}) {
  const account = request?.reconnect ?? null;
  const saved = useSavedAccount(account?.id ?? null);
  const target = useMemo(
    () =>
      // The saved row's hosts and ports, under the engine account's live facts.
      account ? { ...saved, ...reconnectTarget(account) } : undefined,
    [account, saved],
  );
  if (!request) return null;
  return (
    <EmailConnectDialog
      open
      onOpenChange={(o) => (o ? null : onClose())}
      isReconnect={target}
      initialProvider={request.provider}
    />
  );
}
