// Every list state renders deliberately (AC40): no accounts, first sync,
// empty folder and the inbox-zero moment (B12). The offline and account lines
// above the list live in `system-lines.tsx`.

import { CircleCheck, CloudOff, Inbox, Loader2, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { MailAccount } from "@/lib/runtime.types.mail-engine";

import type { MailboxProvider } from "../model/email-types";

/** The provider a first-run card picks; the connect dialog opens on it. */
export type MailConnectProvider = MailboxProvider;

export type MailListState =
  | { kind: "no_accounts" }
  | { kind: "first_sync" }
  | { kind: "empty_folder"; name: string }
  | { kind: "inbox_zero"; clearedToday: number }
  | { kind: "rows" };

/** Which state the list pane shows. */
export function mailListState(input: {
  accounts: readonly MailAccount[];
  loading: boolean;
  rowCount: number;
  isInbox: boolean;
  folderName: string;
  clearedToday: number;
}): MailListState {
  if (input.accounts.length === 0) return { kind: "no_accounts" };
  if (input.rowCount > 0) return { kind: "rows" };
  if (input.loading || input.accounts.every((a) => a.syncState === "first_sync"))
    return { kind: "first_sync" };
  if (input.isInbox) return { kind: "inbox_zero", clearedToday: input.clearedToday };
  return { kind: "empty_folder", name: input.folderName };
}

export function MailListStateView({
  state,
  onConnect,
}: {
  state: Exclude<MailListState, { kind: "rows" }>;
  onConnect?: (provider: MailConnectProvider) => void;
}) {
  switch (state.kind) {
    case "no_accounts":
      return (
        <EmptyState
          icon={Mail}
          title="Connect your mail"
          description="Mail stays on this Mac. Pick your provider to start."
          action={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onConnect?.("gmail")}>
                Gmail
              </Button>
              <Button variant="outline" size="sm" onClick={() => onConnect?.("icloud")}>
                iCloud
              </Button>
              <Button variant="outline" size="sm" onClick={() => onConnect?.("outlook")}>
                Microsoft
              </Button>
            </div>
          }
        />
      );
    case "first_sync":
      return (
        <EmptyState
          icon={Loader2}
          title="Getting your newest mail"
          description="This takes a few seconds."
        />
      );
    case "inbox_zero":
      return (
        <EmptyState
          icon={CircleCheck}
          title="Inbox zero"
          description={
            state.clearedToday > 0
              ? `You cleared ${state.clearedToday} today.`
              : "Nothing waiting on you."
          }
        />
      );
    case "empty_folder":
      return <EmptyState icon={Inbox} size="inline" title={`Nothing in ${state.name}`} />;
  }
}

/** The reader's "Available when you're back online" (AC40). */
export function MailBodyUnavailable() {
  return <EmptyState icon={CloudOff} size="inline" title="Available when you're back online" />;
}
