// The center conversation list (EM-4/EM-5, DESIGN_BRIEF §3). One row per thread:
// sender(s), subject, snippet, time, the account hue dot (Unified scope only),
// unread WEIGHT (font-medium/foreground vs muted — never color-only), a pin glyph
// when starred, and a thread-count chip when messageCount > 1. Hovering a row
// reveals quick-triage icon-buttons (Done / Snooze / Follow-up / Delete) + a ⋯
// menu for the smart-inbox per-sender override (EM-10), each tooltip'd. When
// `sections` is passed, rows are grouped under Personal / Notifications /
// Newsletters headers (EM-10); otherwise a flat list (search results, EM-9).
// Selection is id-based and lifted to the page. Presentational — actions callback.

import { forwardRef, type ReactNode } from "react";
import { Check, Clock3, CornerUpLeft, MoreHorizontal, Pin, Trash2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { IconButton } from "../../../components/ui/icon-button";
import { EmptyState } from "../../../components/ui/empty-state";
import type { LabelColor } from "../../../components/tag-colors";
import {
  EMAIL_SECTIONS,
  SECTION_LABEL,
  type EmailSection,
  type EmailSectionGroup,
} from "../classify";
import { formatEmailDate } from "../utils/email-format";
import type { EmailThread } from "../model/email-types";

type Props = {
  /** Flat rows (search results / a single scope). Ignored when `sections` is set. */
  threads: EmailThread[];
  /** Smart-inbox grouped rows (EM-10). When present, renders section headers. */
  sections?: EmailSectionGroup[] | null;
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
  onFollowUp: (thread: EmailThread) => void;
  onDelete: (thread: EmailThread) => void;
  onRetry: () => void;
  /** Set/clear the sender's smart-inbox override (EM-10). Enables the ⋯ menu. */
  onSetSection?: (thread: EmailThread, section: EmailSection | null) => void;
  /** The sender's current override (a check in the menu), if any. */
  overrideFor?: (thread: EmailThread) => EmailSection | null;
  /** Rendered below the list (the EM-9 server-escalation footer). */
  footer?: ReactNode;
  /** Empty-state copy override (search "no results" vs inbox zero). */
  empty?: { title: string; description: string };
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
    onFollowUp: () => void;
    onDelete: () => void;
    onSetSection?: (section: EmailSection | null) => void;
    activeOverride?: EmailSection | null;
  }
>(function ThreadRow(
  {
    thread,
    selected,
    showAccountDot,
    hue,
    onSelect,
    onArchive,
    onSnooze,
    onFollowUp,
    onDelete,
    onSetSection,
    activeOverride,
  },
  ref,
) {
  const unread = thread.unread;
  return (
    <button
      ref={ref}
      type="button"
      data-thread-id={thread.threadId}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={
        "group relative flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors duration-(--motion-fade) ease-(--ease-out) " +
        (selected ? "bg-(--selected-bg)" : "hover:bg-accent/60")
      }
    >
      {/* selected marker — the app-wide R5 recipe: quiet accent bar + tint */}
      {selected ? (
        <span className="absolute inset-y-1 left-0.5 w-0.5 rounded-full bg-primary" aria-hidden />
      ) : null}
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
          icon={CornerUpLeft}
          label="Remind me to follow up"
          onClick={(e) => {
            e.stopPropagation();
            onFollowUp();
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
        {onSetSection ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                icon={MoreHorizontal}
                label="Sort this sender…"
                onClick={(e) => e.stopPropagation()}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuLabel className="max-w-56 truncate font-normal text-muted-foreground">
                Always put {thread.fromEmail || senderText(thread)} in
              </DropdownMenuLabel>
              {EMAIL_SECTIONS.map((section) => (
                <DropdownMenuItem
                  key={section}
                  onSelect={() => onSetSection(section)}
                  className={activeOverride === section ? "font-medium" : undefined}
                >
                  {SECTION_LABEL[section]}
                  {activeOverride === section ? (
                    <Check className="ml-auto size-icon-xs" aria-hidden />
                  ) : null}
                </DropdownMenuItem>
              ))}
              {activeOverride ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onSetSection(null)}>
                    Reset to automatic
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </button>
  );
});

export function EmailThreadList({
  threads,
  sections,
  loading,
  error,
  selectedThreadId,
  showAccountDot,
  accountHues,
  onSelectThread,
  onArchive,
  onSnooze,
  onFollowUp,
  onDelete,
  onRetry,
  onSetSection,
  overrideFor,
  footer,
  empty,
}: Props) {
  const hasSections = !!sections;
  const flatCount = hasSections
    ? sections.reduce((n, g) => n + g.threads.length, 0)
    : threads.length;

  if (loading && flatCount === 0) {
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

  if (error && flatCount === 0) {
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

  if (flatCount === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex-1">
          <EmptyState
            icon={Check}
            title={empty?.title ?? "Inbox zero"}
            description={empty?.description ?? "Nothing to triage right now. New mail lands here."}
          />
        </div>
        {footer}
      </div>
    );
  }

  const renderRow = (thread: EmailThread) => (
    <ThreadRow
      key={`${thread.accountId}::${thread.threadId}`}
      thread={thread}
      selected={selectedThreadId === thread.threadId}
      showAccountDot={showAccountDot}
      hue={accountHues[thread.accountId] ?? "gray"}
      onSelect={() => onSelectThread(thread)}
      onArchive={() => onArchive(thread)}
      onSnooze={() => onSnooze(thread)}
      onFollowUp={() => onFollowUp(thread)}
      onDelete={() => onDelete(thread)}
      onSetSection={onSetSection ? (section) => onSetSection(thread, section) : undefined}
      activeOverride={overrideFor?.(thread) ?? null}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {hasSections ? (
        <div className="flex flex-col gap-1 p-1">
          {sections.map((group) => (
            <section key={group.section} className="flex flex-col gap-0.5">
              <header className="flex items-center gap-2 px-2.5 pb-0.5 pt-2">
                <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </span>
                <span className="text-2xs tabular-nums text-muted-foreground/70">
                  {group.threads.length}
                </span>
              </header>
              {group.threads.map(renderRow)}
            </section>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5 p-1">{threads.map(renderRow)}</div>
      )}
      {footer}
    </div>
  );
}
