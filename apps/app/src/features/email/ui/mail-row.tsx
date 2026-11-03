// One list row (decision 11): memoized, takes its own facts plus one stable
// actions object, no Radix root of its own. The hover cluster (Done, Snooze,
// ⋯) is drawn only on the one hovered or cursor row.

import {
  BellOff,
  CalendarDays,
  Check,
  Clock3,
  MoreHorizontal,
  Paperclip,
  Pin,
  Star,
} from "lucide-react";
import { memo } from "react";

import type { LabelColor } from "@/components/tag-colors";
import { IconButton } from "@/components/ui/icon-button";
import { SELECTED_ROW } from "@/components/ui/selection";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";
import { cn } from "@/lib/utils";

export type MailDensity = "comfortable" | "compact";

export type MailRowActions = {
  open(threadId: string): void;
  togglePick(threadId: string): void;
  hover(threadId: string | null): void;
  done(threadId: string): void;
  snooze(threadId: string): void;
  more(threadId: string, anchor: HTMLElement): void;
};

export const ROW_HEIGHT: Record<MailDensity, number> = { comfortable: 72, compact: 52 };

export function senderLine(row: MailThreadRow): string {
  const names = row.senders.map((s) => s.name || s.email.split("@")[0] || s.email);
  if (names.length <= 2) return names.join(", ");
  return `${names[0]} … ${names[names.length - 1]}`;
}

export function formatRowTime(ms: number, nowMs: number): string {
  const d = new Date(ms);
  const n = new Date(nowMs);
  if (d.toDateString() === n.toDateString())
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.getFullYear() === n.getFullYear())
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function initials(row: MailThreadRow): string {
  const s = row.senders[row.senders.length - 1];
  const base = (s?.name || s?.email || "?").trim();
  return base.slice(0, 1).toUpperCase();
}

function RowFlags({ row }: { row: MailThreadRow }) {
  return (
    <>
      {row.priority ? (
        <Star className="size-3.5 shrink-0 text-primary" aria-label="Priority person" />
      ) : null}
      {row.pinned ? <Pin className="size-3.5 shrink-0 text-primary" aria-label="Pinned" /> : null}
      {row.hasAttachments ? (
        <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-label="Attachment" />
      ) : null}
      {row.hasInvite ? (
        <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" aria-label="Invite" />
      ) : null}
      {row.muted ? (
        <BellOff className="size-3.5 shrink-0 text-muted-foreground" aria-label="Muted" />
      ) : null}
      {row.snoozedUntilMs !== null ? (
        <Clock3 className="size-3.5 shrink-0 text-muted-foreground" aria-label="Snoozed" />
      ) : null}
    </>
  );
}

function RowActions({ threadId, actions }: { threadId: string; actions: MailRowActions }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5" data-row-actions>
      <IconButton
        icon={Check}
        label="Done"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          actions.done(threadId);
        }}
      />
      <IconButton
        icon={Clock3}
        label="Snooze"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          actions.snooze(threadId);
        }}
      />
      <IconButton
        icon={MoreHorizontal}
        label="More"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          actions.more(threadId, e.currentTarget);
        }}
      />
    </span>
  );
}

type Props = {
  row: MailThreadRow;
  cursor: boolean;
  picked: boolean;
  showActions: boolean;
  hue: LabelColor;
  showHue: boolean;
  density: MailDensity;
  previewLines: 1 | 2;
  nowMs: number;
  actions: MailRowActions;
};

export const MailRow = memo(function MailRow({
  row,
  cursor,
  picked,
  showActions,
  hue,
  showHue,
  density,
  previewLines,
  nowMs,
  actions,
}: Props) {
  const compact = density === "compact";
  return (
    <div
      role="option"
      aria-selected={cursor}
      data-thread-id={row.threadId}
      data-picked={picked ? "true" : undefined}
      tabIndex={-1}
      onClick={(e) =>
        e.metaKey || e.shiftKey ? actions.togglePick(row.threadId) : actions.open(row.threadId)
      }
      onMouseEnter={() => actions.hover(row.threadId)}
      className={cn(
        "group relative flex h-full w-full cursor-default items-start gap-3 rounded-md px-3 text-left transition-colors duration-(--motion-fade) ease-(--ease-out)",
        compact ? "py-1.5" : "py-2.5",
        cursor || picked ? SELECTED_ROW : "hover:bg-state-hover",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-state-active text-xs font-medium text-muted-foreground",
          compact && "size-6",
        )}
      >
        {initials(row)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          {showHue ? (
            <span data-label={hue} className="tag-dot size-2 shrink-0 rounded-full" aria-hidden />
          ) : null}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              row.unread ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {senderLine(row)}
            {row.messageCount > 1 ? (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                {row.messageCount}
              </span>
            ) : null}
          </span>
          <RowFlags row={row} />
          {showActions ? (
            <RowActions threadId={row.threadId} actions={actions} />
          ) : (
            <time className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatRowTime(row.lastDateMs, nowMs)}
            </time>
          )}
        </div>
        <span
          className={cn(
            "truncate text-sm",
            row.unread ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {row.subject || "(no subject)"}
        </span>
        {compact ? null : (
          <span
            className={cn(
              "text-xs text-muted-foreground",
              previewLines === 1 ? "truncate" : "line-clamp-2",
            )}
          >
            {row.snippet}
          </span>
        )}
      </div>
    </div>
  );
});
