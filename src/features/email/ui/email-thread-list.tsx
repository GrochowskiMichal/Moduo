// The center conversation list (EM-4/EM-5, DESIGN_BRIEF §3). One row per thread:
// sender(s), subject, snippet, time, the account hue dot (Unified scope only),
// unread WEIGHT (font-medium/foreground vs muted — never color-only), a pin glyph
// when starred, and a thread-count chip when messageCount > 1. Hovering a row
// reveals quick-triage icon-buttons (Done / Snooze / Delete), each tooltip'd.
// Selection is id-based and lifted to the page; clicking a row selects + opens it.
// Presentational — every action is a callback.

import { forwardRef } from "react";
import { Check, Clock3, Pin, Trash2 } from "lucide-react";

import { IconButton } from "../../../components/ui/icon-button";
import { EmptyState } from "../../../components/ui/empty-state";
import type { LabelColor } from "../../../components/tag-colors";
import { formatEmailDate } from "../utils/email-format";
import type { EmailThread } from "../model/email-types";

type Props = {
  threads: EmailThread[];
  loading: boolean;
  error: string | null;
  /** The selected thread's threadId (id-based so it survives reordering). */
  selectedThreadId: string | null;
  /** True when the Unified scope is active — show the per-account hue dot. */
  showAccountDot: boolean;
  accountHues: Record<string, LabelColor>;
  onSelectThread: (thread: EmailThread) => void;
  onArchive: (thread: EmailThread) => void;
  onSnooze: (thread: EmailThread) => void;
  onDelete: (thread: EmailThread) => void;
  onRetry: () => void;
};

const SKELETON_ROWS = 6;

function senderText(thread: EmailThread): string {
  if (thread.participants.length > 1) {
    // First + last distinct participant reads as "a conversation" without noise.
    const first = thread.participants[0];
    const last = thread.participants[thread.participants.length - 1];
    return first === last ? first : `${first}, ${last}`;
  }
  return thread.fromName || thread.participants[0] || thread.fromEmail || "Unknown sender";
}

/** One conversation row. Ref-forwarded so the page can scroll the selection in. */
const ThreadRow = forwardRef<
  HTMLButtonElement,
  {
    thread: EmailThread;
    selected: boolean;
    showAccountDot: boolean;
    hue: LabelColor;
    onSelect: () => void;
    onArchive: () => void;
    onSnooze: () => void;
    onDelete: () => void;
  }
>(function ThreadRow(
  { thread, selected, showAccountDot, hue, onSelect, onArchive, onSnooze, onDelete },
  ref,
) {
  const unread = thread.unread;
  return (
    <button
      ref={ref}
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={
        "group relative flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors " +
        (selected ? "bg-accent" : "hover:bg-accent")
      }
    >
      {/* Unread rail dot — a weight/presence signal, paired with type weight. */}
      <span className="mt-1.5 flex w-2 shrink-0 justify-center" aria-hidden>
        {unread ? <span className="size-2 rounded-full bg-primary" /> : null}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          {showAccountDot ? (
            <span
              data-label={hue}
              className="tag-dot size-2 shrink-0 rounded-full"
              aria-hidden
            />
          ) : null}
          <span
            className={
              "min-w-0 flex-1 truncate text-sm " +
              (unread ? "font-medium text-foreground" : "text-muted-foreground")
            }
          >
            {senderText(thread)}
          </span>
          {thread.starred ? (
            <Pin
              className="size-icon-xs shrink-0 -rotate-45 text-muted-foreground"
              aria-label="Pinned"
            />
          ) : null}
          <time
            className="shrink-0 text-2xs tabular-nums text-muted-foreground/80"
            dateTime={thread.date}
          >
            {formatEmailDate(thread.date)}
          </time>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={
              "min-w-0 flex-1 truncate text-sm " +
              (unread ? "font-medium text-foreground" : "text-foreground/90")
            }
          >
            {thread.subject}
          </span>
          {thread.messageCount > 1 ? (
            <span className="shrink-0 rounded-full bg-muted px-1.5 text-2xs tabular-nums text-muted-foreground">
              {thread.messageCount}
            </span>
          ) : null}
        </div>

        <span className="truncate text-xs text-muted-foreground">
          {thread.snippet || "No preview text."}
        </span>
      </div>

      {/* Hover-reveal quick triage — absolutely positioned so it overlays the
          time/snippet without reflowing the row. Stops propagation so a triage
          click doesn't also open the thread. */}
      <div
        className="absolute right-2 top-1.5 flex items-center gap-0.5 rounded-md bg-card/95 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <IconButton
          icon={Check}
          label="Done (e)"
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
        />
        <IconButton
          icon={Clock3}
          label="Snooze (s)"
          onClick={(e) => {
            e.stopPropagation();
            onSnooze();
          }}
        />
        <IconButton
          icon={Trash2}
          label="Delete (#)"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        />
      </div>
    </button>
  );
});

export function EmailThreadList({
  threads,
  loading,
  error,
  selectedThreadId,
  showAccountDot,
  accountHues,
  onSelectThread,
  onArchive,
  onSnooze,
  onDelete,
  onRetry,
}: Props) {
  if (loading && threads.length === 0) {
    return (
      <div className="flex flex-col gap-1 p-1" aria-busy="true" aria-label="Loading inbox">
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <div key={i} className="flex items-start gap-2.5 px-2.5 py-2">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-muted" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-2.5 w-2/3 animate-pulse rounded bg-muted/70" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error && threads.length === 0) {
    return (
      <EmptyState
        title="Couldn't load your inbox"
        description={error}
        action={
          <button
            type="button"
            onClick={onRetry}
            className="text-sm text-primary underline underline-offset-2 hover:no-underline"
          >
            Try again
          </button>
        }
      />
    );
  }

  if (threads.length === 0) {
    return (
      <EmptyState
        icon={Check}
        title="Inbox zero"
        description="Nothing to triage right now. New mail lands here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-0.5 p-1">
      {threads.map((thread) => (
        <ThreadRow
          key={`${thread.accountId}::${thread.threadId}`}
          thread={thread}
          selected={selectedThreadId === thread.threadId}
          showAccountDot={showAccountDot}
          hue={accountHues[thread.accountId] ?? "gray"}
          onSelect={() => onSelectThread(thread)}
          onArchive={() => onArchive(thread)}
          onSnooze={() => onSnooze(thread)}
          onDelete={() => onDelete(thread)}
        />
      ))}
    </div>
  );
}
