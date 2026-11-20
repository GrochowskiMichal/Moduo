// The system lines above the list (specs/mail-v3.md §4, AC3–AC5, AC9, AC18),
// in this order: offline (every account, or one line per offline account),
// one line per account that needs signing in again (Reconnect) or couldn't
// sync (Retry now), the away line (Dismiss), one failed-ops line per account
// (Undo both / Retry now on exactly those ops), and the follow-up nudge, shown
// only on Personal and only when no other line shows. All `role="status"`
// except the failed line, which is an alert.

import { AlertCircle, Clock, CloudOff, CornerUpLeft, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MailAccount, MailOpRecord, MailThreadRow } from "@/lib/runtime.types.mail-engine";
import { cn } from "@/lib/utils";

import { MiddleTruncate } from "./middle-truncate";
import {
  accountErrorBody,
  accountLabel,
  humaniseError,
  nudgeFirstName,
  nudgeTitle,
  offlineBody,
  opLabel,
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

/** "Couldn't {verb}" for each op kind (specs/mail-improve.md §5). */
const FAILED_VERB: Partial<Record<MailOpRecord["kind"], string>> = {
  done: "archive",
  undone: "restore",
  move: "move",
  delete: "delete",
  restore: "restore",
  snooze: "snooze",
  unsnooze: "unsnooze",
  pin: "pin",
  unpin: "unpin",
  mark_read: "mark read",
  mark_unread: "mark unread",
  mute: "mute",
  unmute: "unmute",
  spam: "report",
  not_spam: "restore",
  label_add: "label",
  label_remove: "unlabel",
  block_sender: "block",
};

/** One failed action, one line of at most 32 px: "Couldn't archive "{subject}" · {cause} ·
 *  Retry · Undo". The subject is cut in the middle; the cause never is (AC20). */
function FailedLine({
  op,
  alert,
  onRetryOps,
  onUndoOps,
}: {
  op: MailOpRecord;
  alert: boolean;
  onRetryOps?: (opIds: string[]) => void;
  onUndoOps?: (opIds: string[]) => void;
}) {
  const verb = FAILED_VERB[op.kind] ?? opLabel(op.kind).toLowerCase();
  const subject = op.subject || "(no subject)";
  const cause = humaniseError(op.lastError) ?? "the server refused it";
  return (
    <div
      role={alert ? "alert" : undefined}
      data-slot="mail-failed-line"
      title={`Couldn't ${verb} "${subject}" · ${cause}`}
      className="flex h-(--mail-row-compact) min-w-0 items-center gap-2 rounded-md bg-tag-chip-surface px-2 text-sm"
    >
      <AlertCircle aria-hidden className="size-3.5 shrink-0 text-warning" />
      <span className="flex min-w-0 flex-1 items-center gap-1 text-foreground">
        <span className="shrink-0">Couldn&apos;t {verb} &quot;</span>
        <MiddleTruncate text={subject} keep={12} />
        <span className="shrink-0">&quot;</span>
        <span aria-hidden className="shrink-0 text-muted-foreground">
          ·
        </span>
        <span data-cause className="shrink-0 text-muted-foreground">
          {cause}
        </span>
      </span>
      <Button size="sm" variant="ghost" onClick={() => onRetryOps?.([op.opId])}>
        Retry
      </Button>
      <Tipped tip="Shows the thread as the server has it">
        <Button size="sm" variant="ghost" onClick={() => onUndoOps?.([op.opId])}>
          Undo
        </Button>
      </Tipped>
    </div>
  );
}

/** Failed actions (AC20): one line each; two or more fold into "{n} actions didn't sync ·
 *  Show · Retry all", and Show lists them in a box that scrolls past five lines. */
function FailedLines({
  failed,
  onRetryOps,
  onUndoOps,
}: Pick<MailSystemLinesProps, "onRetryOps" | "onUndoOps"> & {
  failed: readonly MailOpRecord[];
}) {
  const [shown, setShown] = useState(false);
  if (failed.length === 1)
    return <FailedLine op={failed[0]!} alert onRetryOps={onRetryOps} onUndoOps={onUndoOps} />;
  const ids = failed.map((o) => o.opId);
  return (
    <div className="flex flex-col gap-1">
      <div
        role="alert"
        data-slot="mail-system-line"
        className="flex h-(--mail-row-compact) items-center gap-2 rounded-md bg-tag-chip-surface px-2 text-sm"
      >
        <AlertCircle aria-hidden className="size-3.5 shrink-0 text-warning" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {failed.length} actions didn&apos;t sync
        </span>
        <Button size="sm" variant="ghost" aria-expanded={shown} onClick={() => setShown((v) => !v)}>
          {shown ? "Hide" : "Show"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onRetryOps?.(ids)}>
          Retry all
        </Button>
      </div>
      {shown ? (
        <ul
          aria-label="Actions that didn't sync"
          className="flex max-h-(--failed-list-max) flex-col gap-1 overflow-y-auto"
        >
          {failed.map((op) => (
            <li key={op.opId}>
              <FailedLine op={op} alert={false} onRetryOps={onRetryOps} onUndoOps={onUndoOps} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
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
        <FailedLines failed={failed} onRetryOps={props.onRetryOps} onUndoOps={props.onUndoOps} />
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
