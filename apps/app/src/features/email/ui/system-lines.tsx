// The system lines above the list (specs/mail-v3.md §4, AC3–AC5): offline
// (every account, or one line per offline account), one line per account that
// needs signing in again (Reconnect) or couldn't sync (Retry now), and the
// "came back while you were away" line with Dismiss. MV-6 restyles them and
// adds the failed-ops and nudge lines to the same order; this block wires the
// real per-account data through.

import { AlertCircle, Clock, CloudOff, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { MailAccount } from "@/lib/runtime.types.mail-engine";

export const accountLabel = (a: Pick<MailAccount, "displayName" | "address">) =>
  a.displayName || a.address;

function Line({
  icon,
  title,
  body,
  alert = false,
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  alert?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      role={alert ? "alert" : "status"}
      className="mx-2 mb-2 flex items-start gap-2 px-1 text-xs text-muted-foreground"
    >
      {icon}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium text-foreground">{title}</span>
        <span>{body}</span>
      </div>
      {children}
    </div>
  );
}

const ICON = "mt-0.5 size-3.5 shrink-0";

/** "Offline, changes will sync": the body names what waits. */
function offlineBody(outboxCount: number): string {
  if (outboxCount === 0) return "Reading works from what's on this Mac.";
  return outboxCount === 1
    ? "1 message waits in Outbox."
    : `${outboxCount} messages wait in Outbox.`;
}

export type MailSystemLinesProps = {
  accounts: readonly MailAccount[];
  outboxCount: number;
  /** Threads in `awayReturned`. */
  awayCount: number;
  onReconnect?: (accountId: string) => void;
  /** Sync now for that account. */
  onRetry?: (accountId: string) => void;
  onDismissAway?: () => void;
};

export function MailSystemLines({
  accounts,
  outboxCount,
  awayCount,
  onReconnect,
  onRetry,
  onDismissAway,
}: MailSystemLinesProps) {
  const offline = accounts.filter((a) => a.syncState === "offline");
  const allOffline = accounts.length > 0 && offline.length === accounts.length;
  return (
    <>
      {allOffline ? (
        <Line
          icon={<CloudOff className={ICON} aria-hidden />}
          title="Offline, changes will sync"
          body={offlineBody(outboxCount)}
        />
      ) : (
        offline.map((a) => (
          <Line
            key={a.id}
            icon={<CloudOff className={ICON} aria-hidden />}
            title={`${accountLabel(a)} is offline`}
            body="Reading works from what's on this Mac; other accounts keep syncing."
          />
        ))
      )}
      {accounts
        .filter((a) => a.syncState === "reconnect")
        .map((a) => (
          <Line
            key={a.id}
            icon={<AlertCircle className={`${ICON} text-destructive`} aria-hidden />}
            title={`${accountLabel(a)} needs you to sign in again`}
            body="Its new mail is paused until you sign in; other accounts keep syncing."
          >
            <Button size="sm" onClick={() => onReconnect?.(a.id)}>
              Reconnect
            </Button>
          </Line>
        ))}
      {accounts
        .filter((a) => a.syncState === "error")
        .map((a) => (
          <Line
            key={a.id}
            icon={<AlertCircle className={`${ICON} text-destructive`} aria-hidden />}
            title={`${accountLabel(a)} couldn't sync`}
            body={`${a.lastError ? `${a.lastError}; r` : "R"}etrying every minute.`}
          >
            <Button size="sm" variant="secondary" onClick={() => onRetry?.(a.id)}>
              Retry now
            </Button>
          </Line>
        ))}
      {awayCount > 0 ? (
        <Line
          icon={<Clock className={ICON} aria-hidden />}
          title={
            awayCount === 1
              ? "1 email came back while you were away"
              : `${awayCount} emails came back while you were away`
          }
          body="Snoozes return only while Moduo runs, so these came due while it was closed. They're first in Personal, under Came back."
        >
          <Button size="sm" variant="ghost" onClick={onDismissAway}>
            <X aria-hidden />
            Dismiss
          </Button>
        </Line>
      ) : null}
    </>
  );
}
