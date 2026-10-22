// DF-6: a broken account silently contributes nothing to its scope — say so
// instead of letting mail quietly stop arriving. Partitioned per account (AC12):
// a broken mailbox names itself and never stands in for the healthy ones.

import { AlertTriangle } from "lucide-react";
import type { accountSyncHealth } from "../accounts";
import type { SavedAccount } from "../model/email-types";

type Props = {
  health: ReturnType<typeof accountSyncHealth>;
  onReconnect: (account: SavedAccount) => void;
  onRetrySync: () => void;
};

export function EmailSyncBanner({ health, onReconnect, onRetrySync }: Props) {
  const brokenAccounts = health.broken;
  if (brokenAccounts.length === 0) return null;
  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-warning/10 px-3 py-1.5 text-xs text-foreground"
    >
      <AlertTriangle className="size-icon-xs shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1">
        {brokenAccounts.length === 1
          ? `${brokenAccounts[0].email} isn't syncing — new mail may be missing.`
          : `${brokenAccounts.length} accounts aren't syncing — new mail may be missing.`}
      </span>
      {health.reconnectable.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onReconnect(a)}
          className="shrink-0 rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Reconnect{brokenAccounts.length > 1 ? ` ${a.email}` : ""}
        </button>
      ))}
      {brokenAccounts.some((a) => a.status === "error") ? (
        <button
          type="button"
          onClick={() => onRetrySync()}
          className="shrink-0 rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Retry sync
        </button>
      ) : null}
    </div>
  );
}
