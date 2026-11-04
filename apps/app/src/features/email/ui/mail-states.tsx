// Every list state renders deliberately (AC40): no accounts, first sync,
// offline, reconnect, empty folder and the inbox-zero moment (B12).

import { CircleCheck, CloudOff, Inbox, Loader2, Mail, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { MailAccount } from "@/lib/runtime.types.mail-engine";

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
  onConnect?: (provider: "gmail" | "icloud" | "outlook") => void;
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

/** The line above the list: offline, or an account that needs signing in again. */
export function MailStatusLine({
  offline,
  accounts,
  onReconnect,
}: {
  offline: boolean;
  accounts: readonly MailAccount[];
  onReconnect?: (accountId: string) => void;
}) {
  const broken = accounts.find((a) => a.syncState === "reconnect" || a.syncState === "error");
  if (offline)
    return (
      <div
        role="status"
        className="mx-2 mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground"
      >
        <CloudOff className="size-3.5" aria-hidden />
        Offline, changes will sync
      </div>
    );
  if (!broken) return null;
  return (
    <div
      role="status"
      className="mx-2 mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground"
    >
      <RefreshCw className="size-3.5 text-destructive" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        {broken.syncState === "reconnect"
          ? `${broken.address} needs you to sign in again`
          : `${broken.address} couldn't sync${broken.lastError ? `: ${broken.lastError}` : ""}`}
      </span>
      {broken.syncState === "reconnect" ? (
        <Button size="sm" variant="ghost" onClick={() => onReconnect?.(broken.id)}>
          Reconnect
        </Button>
      ) : null}
    </div>
  );
}

/** The reader's "Available when you're back online" (AC40). */
export function MailBodyUnavailable() {
  return <EmptyState icon={CloudOff} size="inline" title="Available when you're back online" />;
}
