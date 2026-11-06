// One list row (decision 11; specs/mail-v3.md §3, AC15, AC16): memoized, takes
// its own facts plus one stable actions object, no Radix root of its own. The
// lead is the sender's identity avatar (ringed in the account's hue with more
// than one account), the unread dot and, on hover or while picking, a checkbox
// over the avatar. Hover actions overlay the end of the snippet, so the time
// and flags never move. Comfortable is 72 px; compact is one 32 px line.

import { Check, Clock3, MoreHorizontal, Undo2 } from "lucide-react";
import { memo } from "react";

import type { LabelColor } from "@/components/tag-colors";
import { avatarHue } from "@/components/ui/avatar";
import { IconButton } from "@/components/ui/icon-button";
import { SELECTED_ROW } from "@/components/ui/selection";
import { initialsOf } from "@/lib/initials";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";
import { cn } from "@/lib/utils";

import type { MailLinkedKind } from "../commands/spine";
import { MAIL_THREAD_MIME } from "./mail-page-wiring";
import { MailRowFlags } from "./mail-row-flags";
import {
  type MailRowPlace,
  rowFlags,
  rowPerson,
  rowTime,
  rowWho,
  stripSubject,
} from "./mail-row-model";

export { formatRowTime, senderLine } from "./mail-row-model";

export type MailDensity = "comfortable" | "compact";

export type MailRowActions = {
  open(threadId: string): void;
  togglePick(threadId: string): void;
  hover(threadId: string | null): void;
  done(threadId: string): void;
  /** "Not done" on a row in Archive. */
  undone(threadId: string): void;
  snooze(threadId: string): void;
  more(threadId: string, anchor: HTMLElement): void;
};

/** Row heights for the virtual list. `compact` mirrors `--mail-row-compact` in
 *  tokens.css (decision 13); `mail-row.test.tsx` keeps the two equal. */
export const ROW_HEIGHT: Record<MailDensity, number> = { comfortable: 72, compact: 32 };

const stop = (fn: () => void) => (e: React.MouseEvent) => {
  e.stopPropagation();
  fn();
};

function RowActions({
  threadId,
  done,
  actions,
  className,
}: {
  threadId: string;
  done: boolean;
  actions: MailRowActions;
  className: string;
}) {
  return (
    <span
      data-row-actions
      className={cn(
        "flex items-center gap-0.5 bg-linear-to-r from-transparent via-card via-25% to-card pl-4",
        className,
      )}
    >
      {done ? (
        <IconButton
          icon={Undo2}
          label="Not done"
          size="sm"
          onClick={stop(() => actions.undone(threadId))}
        />
      ) : (
        <>
          <IconButton
            icon={Check}
            label="Done"
            size="sm"
            onClick={stop(() => actions.done(threadId))}
          />
          <IconButton
            icon={Clock3}
            label="Snooze"
            size="sm"
            onClick={stop(() => actions.snooze(threadId))}
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
        </>
      )}
    </span>
  );
}

function RowLead({
  row,
  person,
  picked,
  selecting,
  accountHue,
  compact,
  actions,
}: {
  row: MailThreadRow;
  person: { name: string; email: string };
  picked: boolean;
  selecting: boolean;
  accountHue: LabelColor | null;
  compact: boolean;
  actions: MailRowActions;
}) {
  const checking = picked || selecting;
  return (
    <span className={cn("relative flex shrink-0", compact ? "self-center" : "mt-0.5 self-start")}>
      {row.unread ? (
        <span
          aria-hidden
          data-unread-dot
          className="absolute top-1/2 -left-2.5 size-1.5 -translate-y-1/2 rounded-full bg-primary"
        />
      ) : null}
      <span
        data-account-ring={accountHue ?? undefined}
        data-label={accountHue ?? undefined}
        className={cn("flex rounded-full", accountHue && "bg-card p-px ring-2 ring-(--label)")}
      >
        <span
          aria-hidden
          data-avatar
          data-label={avatarHue(person.email.toLowerCase() || person.name || "?")}
          className={cn(
            "flex items-center justify-center rounded-full bg-label-fill leading-none font-semibold text-foreground group-hover:invisible",
            compact ? "size-5 text-3xs" : "size-8 text-xs",
            checking && "invisible",
          )}
        >
          {initialsOf(person.name || person.email)}
        </span>
      </span>
      <button
        type="button"
        tabIndex={-1}
        aria-label={picked ? "Deselect · x" : "Select · x"}
        aria-pressed={picked}
        onClick={stop(() => actions.togglePick(row.threadId))}
        className={cn(
          "absolute inset-1 hidden items-center justify-center rounded-sm border border-muted-foreground bg-card group-hover:flex",
          checking && "flex",
          picked && "border-primary bg-primary text-primary-foreground",
        )}
      >
        {picked ? <Check aria-hidden className="size-3" /> : null}
      </button>
    </span>
  );
}

type Props = {
  row: MailThreadRow;
  cursor: boolean;
  picked: boolean;
  /** Anything is picked: every row shows its checkbox. */
  selecting?: boolean;
  showActions: boolean;
  /** The account's hue for the avatar ring; null without a ring (one account). */
  accountHue: LabelColor | null;
  density: MailDensity;
  /** Comfortable only; compact is always one line (decision 14). */
  previewLines: 1 | 2;
  place?: MailRowPlace;
  /** Your own addresses (the "To {name}" counterpart is someone else). */
  self?: ReadonlySet<string>;
  linked?: readonly MailLinkedKind[];
  notSent?: boolean;
  offline?: boolean;
  nowMs: number;
  actions: MailRowActions;
};

const NO_SELF: ReadonlySet<string> = new Set();

function rowFacts(p: Props) {
  const place = p.place ?? "inbox";
  const self = p.self ?? NO_SELF;
  return {
    place,
    who: rowWho(p.row, place, self),
    person: rowPerson(p.row, place, self),
    time: rowTime(p.row, place, p.nowMs),
    flags: rowFlags(p.row, {
      place,
      nowMs: p.nowMs,
      linked: p.linked,
      notSent: p.notSent,
      offline: p.offline,
    }),
    subject: stripSubject(p.row.subject) || "(no subject)",
  };
}

const textTone = (unread: boolean) => (unread ? "text-foreground" : "text-muted-foreground");

type Facts = ReturnType<typeof rowFacts>;

function RowWho({ row, who, compact }: { row: MailThreadRow; who: string; compact: boolean }) {
  return (
    <span
      data-row-who
      className={cn(
        "truncate text-sm",
        compact ? "w-(--mail-sender-w) shrink-0" : "min-w-0 flex-1",
        row.unread ? "font-semibold text-foreground" : "text-muted-foreground",
      )}
    >
      {who}
      {row.messageCount > 1 ? (
        <span className="ml-1 text-xs font-normal text-muted-foreground">{row.messageCount}</span>
      ) : null}
    </span>
  );
}

/** Flags then time: the right edge that never moves. */
function RowTail({ f }: { f: Facts }) {
  return (
    <>
      <MailRowFlags flags={f.flags} />
      <time className="shrink-0 text-xs text-muted-foreground tabular-nums">{f.time}</time>
    </>
  );
}

function RowSubject({ row, text }: { row: MailThreadRow; text: string }) {
  return (
    <span
      data-row-subject
      title={row.subject || undefined}
      className={cn("min-w-0 truncate text-sm", textTone(row.unread))}
    >
      {text}
    </span>
  );
}

type BodyProps = { p: Props; f: Facts };

/** Compact (A4): one line; the snippet takes only what's left, so it hides first. */
function CompactBody({ p, f }: BodyProps) {
  return (
    <>
      <RowWho row={p.row} who={f.who} compact />
      <span className="relative flex min-w-0 flex-1 items-center gap-2">
        <RowSubject row={p.row} text={f.subject} />
        <span
          data-row-snippet
          className="min-w-0 flex-1 basis-0 truncate text-xs text-muted-foreground mask-r-from-60%"
        >
          {p.row.snippet}
        </span>
        {p.showActions ? (
          <RowActions
            threadId={p.row.threadId}
            done={f.place === "archive"}
            actions={p.actions}
            className="absolute inset-y-0 right-0"
          />
        ) : null}
      </span>
      <RowTail f={f} />
    </>
  );
}

/** Comfortable: the name line, the subject, one or two preview lines. */
function ComfortableBody({ p, f }: BodyProps) {
  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <RowWho row={p.row} who={f.who} compact={false} />
          <RowTail f={f} />
        </div>
        <RowSubject row={p.row} text={f.subject} />
        <span
          data-row-snippet
          className={cn(
            "text-xs text-muted-foreground",
            p.previewLines === 1 ? "truncate" : "line-clamp-2",
          )}
        >
          {p.row.snippet}
        </span>
      </div>
      {p.showActions ? (
        <RowActions
          threadId={p.row.threadId}
          done={f.place === "archive"}
          actions={p.actions}
          className="absolute right-2 bottom-1.5"
        />
      ) : null}
    </>
  );
}

export const MailRow = memo(function MailRow(props: Props) {
  const { row, cursor, picked, density, actions } = props;
  const compact = density === "compact";
  const f = rowFacts(props);
  return (
    <div
      role="option"
      aria-selected={cursor}
      data-thread-id={row.threadId}
      data-picked={picked ? "true" : undefined}
      data-row-density={density}
      tabIndex={-1}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MAIL_THREAD_MIME, row.threadId);
        e.dataTransfer.effectAllowed = "link";
      }}
      onClick={(e) =>
        e.metaKey || e.shiftKey ? actions.togglePick(row.threadId) : actions.open(row.threadId)
      }
      onMouseEnter={() => actions.hover(row.threadId)}
      className={cn(
        "group relative flex h-full w-full cursor-default gap-3 rounded-md px-3 text-left transition-colors duration-(--motion-fade) ease-(--ease-out)",
        "after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-hairline hover:after:hidden",
        compact ? "items-center gap-2" : "items-start py-2.5",
        cursor || picked ? cn(SELECTED_ROW, "after:hidden") : "hover:bg-state-hover",
      )}
    >
      <RowLead
        row={row}
        person={f.person}
        picked={picked}
        selecting={props.selecting ?? false}
        accountHue={props.accountHue}
        compact={compact}
        actions={actions}
      />
      {compact ? <CompactBody p={props} f={f} /> : <ComfortableBody p={props} f={f} />}
    </div>
  );
});
