// The system lines above the list (specs/mail-v3.md §4, AC3–AC5, AC9, AC18),
// in this order: offline (every account, or one line per offline account),
// one line per account that needs signing in again (Reconnect) or couldn't
// sync (Retry now), the away line (Dismiss), one failed-ops line per account
// (Undo both / Retry now on exactly those ops), and the follow-up nudge, shown
// only on Personal and only when no other line shows. All `role="status"`
// except the failed line, which is an alert.

import { AlertCircle, Clock, CloudOff, CornerUpLeft, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MailAccount, MailOpRecord, MailThreadRow } from "@/lib/runtime.types.mail-engine";
import { cn } from "@/lib/utils";

import {
  accountErrorBody,
  accountLabel,
  failedReason,
  failedSentence,
  failedTitle,
  failedUndoLabel,
  groupFailedOps,
  nudgeFirstName,
  nudgeTitle,
  offlineBody,
} from "./system-copy";

export { accountLabel } from "./system-copy";

function Line({
  icon,
  title,
  body,
  alert = false,
  warn = false,
  nudge = false,
  children,
}: {
  icon: typeof CloudOff;
  title: ReactNode;
  body: ReactNode;
  alert?: boolean;
  warn?: boolean;
  nudge?: boolean;
  children?: ReactNode;
}) {
  const Icon = icon;
  return (
    <div
      role={alert ? "alert" : "status"}
      data-slot="mail-system-line"
      className={cn(
        "flex items-start gap-2 rounded-md px-2 py-1.5 text-sm",
        nudge ? "border border-hairline" : "bg-tag-chip-surface",
      )}
    >
      <Icon
        className={cn("mt-1 size-3.5 shrink-0", warn ? "text-warning" : "text-muted-foreground")}
        aria-hidden
      />
      <div className="grid min-w-0 flex-1 gap-px text-left">
        {nudge ? (
          title
        ) : (
          <>
            {title}
            {body}
          </>
        )}
      </div>
      {children ? <div className="flex shrink-0 gap-1 self-center">{children}</div> : null}
    </div>
  );
}

const Title = ({ children }: { children: ReactNode }) => (
  <span className="font-medium text-foreground">{children}</span>
);
const Body = ({ children }: { children: ReactNode }) => (
  <span className="text-xs text-muted-foreground">{children}</span>
);

function Tipped({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

export type MailSystemLinesProps = {
  accounts: readonly MailAccount[];
  outboxCount: number;
  /** Triage actions saved on this Mac, not yet on the server (offline line). */
  pendingOps?: number;
  /** Threads in `awayReturned`. */
  awayCount: number;
  failed?: readonly MailOpRecord[];
  /** The account a failed op's thread belongs to, when known. */
  failedAccount?: (op: MailOpRecord) => string | null;
  /** Due follow-ups; shown only when `nudgeAllowed` and no other line shows. */
  followups?: readonly MailThreadRow[];
  /** On the Personal tab of Inbox. */
  nudgeAllowed?: boolean;
  selfAddresses?: readonly string[];
  nowMs?: number;
  onReconnect?: (accountId: string) => void;
  /** Sync now for that account. */
  onRetry?: (accountId: string) => void;
  onDismissAway?: () => void;
  /** Retry now on the failed line: exactly those ops. */
  onRetryOps?: (opIds: string[]) => void;
  /** Undo both / Undo all: drops those ops, showing the threads as the server has them. */
  onUndoOps?: (opIds: string[]) => void;
  onOpenThread?: (threadId: string) => void;
  onDismissFollowup?: (threadId: string) => void;
};

function OfflineLines({
  accounts,
  outboxCount,
  pendingOps,
}: Pick<MailSystemLinesProps, "accounts" | "outboxCount"> & { pendingOps: number }) {
  const offline = accounts.filter((a) => a.syncState === "offline");
  if (accounts.length > 0 && offline.length === accounts.length)
    return (
      <Line
        icon={CloudOff}
        title={<Title>Offline, changes will sync</Title>}
        body={<Body>{offlineBody(outboxCount, pendingOps)}</Body>}
      />
    );
  return offline.map((a) => (
    <Line
      key={a.id}
      icon={CloudOff}
      title={<Title>{`${accountLabel(a)} is offline`}</Title>}
      body={<Body>Reading works from what's on this Mac; other accounts keep syncing.</Body>}
    />
  ));
}

function AccountLines({
  accounts,
  onReconnect,
  onRetry,
}: Pick<MailSystemLinesProps, "accounts" | "onReconnect" | "onRetry">) {
  return (
    <>
      {accounts
        .filter((a) => a.syncState === "reconnect")
        .map((a) => (
          <Line
            key={a.id}
            warn
            icon={AlertCircle}
            title={<Title>{`${accountLabel(a)} needs you to sign in again`}</Title>}
            body={
              <Body>Its new mail is paused until you sign in; other accounts keep syncing.</Body>
            }
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
            warn
            icon={AlertCircle}
            title={<Title>{`${accountLabel(a)} couldn't sync`}</Title>}
            body={<Body>{accountErrorBody(a.lastError)}</Body>}
          >
            <Button size="sm" variant="secondary" onClick={() => onRetry?.(a.id)}>
              Retry now
            </Button>
          </Line>
        ))}
    </>
  );
}

function FailedLines({
  accounts,
  failed,
  failedAccount,
  onRetryOps,
  onUndoOps,
}: Pick<MailSystemLinesProps, "accounts" | "failedAccount" | "onRetryOps" | "onUndoOps"> & {
  failed: readonly MailOpRecord[];
}) {
  const groups = groupFailedOps(failed, accounts, failedAccount ?? (() => null));
  return groups.map((g) => {
    const ids = g.ops.map((o) => o.opId);
    const one = g.ops.length === 1;
    return (
      <Line
        key={g.accountId ?? "unknown"}
        alert
        warn
        icon={AlertCircle}
        title={<Title>{failedTitle(g.ops.length, g.label)}</Title>}
        body={
          <Body>
            {failedSentence(g.ops)} {failedReason(g.ops)}
          </Body>
        }
      >
        <Tipped
          tip={
            one
              ? "Shows the thread as the server has it"
              : "Shows the threads as the server has them"
          }
        >
          <Button size="sm" variant="ghost" onClick={() => onUndoOps?.(ids)}>
            {failedUndoLabel(g.ops.length)}
          </Button>
        </Tipped>
        <Button size="sm" onClick={() => onRetryOps?.(ids)}>
          Retry now
        </Button>
      </Line>
    );
  });
}

function NudgeLines({
  followups,
  selfAddresses,
  nowMs,
  onOpenThread,
  onDismissFollowup,
}: Required<Pick<MailSystemLinesProps, "followups" | "selfAddresses" | "nowMs">> &
  Pick<MailSystemLinesProps, "onOpenThread" | "onDismissFollowup">) {
  return followups.map((row) => {
    const first = nudgeFirstName(row, selfAddresses);
    return (
      <Line
        key={row.threadId}
        nudge
        icon={CornerUpLeft}
        title={
          <button
            type="button"
            className="grid min-w-0 gap-px rounded-sm text-left hover:underline"
            onClick={() => onOpenThread?.(row.threadId)}
          >
            <Title>{nudgeTitle(row, selfAddresses, nowMs)}</Title>
            <span className="sr-only">, </span>
            <span className="truncate text-xs text-muted-foreground">
              {row.subject || "(No subject)"}
            </span>
          </button>
        }
        body={null}
      >
        <Tipped tip={`Stops waiting for ${first}`}>
          <Button size="sm" variant="ghost" onClick={() => onDismissFollowup?.(row.threadId)}>
            <X aria-hidden />
            Dismiss
          </Button>
        </Tipped>
      </Line>
    );
  });
}

/** True when any line other than the nudge shows. */
function othersShow(p: MailSystemLinesProps): boolean {
  const states = new Set(p.accounts.map((a) => a.syncState));
  return (
    states.has("offline") ||
    states.has("reconnect") ||
    states.has("error") ||
    p.awayCount > 0 ||
    (p.failed?.length ?? 0) > 0
  );
}

export function MailSystemLines(props: MailSystemLinesProps) {
  const { accounts, awayCount, failed = [], followups = [], nudgeAllowed = false } = props;
  const nudge = nudgeAllowed && followups.length > 0 && !othersShow(props);
  if (!nudge && !othersShow(props)) return null;
  return (
    <div data-slot="mail-system-lines" className="grid gap-1.5 px-2 pt-2">
      <OfflineLines
        accounts={accounts}
        outboxCount={props.outboxCount}
        pendingOps={props.pendingOps ?? 0}
      />
      <AccountLines accounts={accounts} onReconnect={props.onReconnect} onRetry={props.onRetry} />
      {awayCount > 0 ? (
        <Line
          icon={Clock}
          title={
            <Title>
              {awayCount === 1
                ? "1 email came back while you were away"
                : `${awayCount} emails came back while you were away`}
            </Title>
          }
          body={
            <Body>
              Snoozes return only while Moduo runs, so these came due while it was closed. They're
              first in Personal, under Came back.
            </Body>
          }
        >
          <Button size="sm" variant="ghost" onClick={props.onDismissAway}>
            <X aria-hidden />
            Dismiss
          </Button>
        </Line>
      ) : null}
      {failed.length > 0 ? (
        <FailedLines
          accounts={accounts}
          failed={failed}
          failedAccount={props.failedAccount}
          onRetryOps={props.onRetryOps}
          onUndoOps={props.onUndoOps}
        />
      ) : null}
      {nudge ? (
        <NudgeLines
          followups={followups}
          selfAddresses={props.selfAddresses ?? []}
          nowMs={props.nowMs ?? 0}
          onOpenThread={props.onOpenThread}
          onDismissFollowup={props.onDismissFollowup}
        />
      ) : null}
    </div>
  );
}
