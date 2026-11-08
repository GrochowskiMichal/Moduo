// One list row (decision 11; specs/mail-v3.md §3, AC15, AC16; specs/mail-improve.md
// §2): memoized, takes its own facts plus one stable actions object, no Radix root of
// its own. The lead is the sender's initials on the label fill, the unread dot and,
// on hover, a check ring inside the avatar circle; picked, the circle fills with
// primary and shows a check. One hue per row: the account is a small tick after the
// time (more than one account only). Hover actions sit over a fade of the row's own
// background, so the time and flags never move. Comfortable is 72 px; compact is one
// 32 px line. The row's accessible name reads its parts with commas.

import { Check, Clock3, MoreHorizontal, Undo2 } from "lucide-react";
import { memo } from "react";

import type { LabelColor } from "@/components/tag-colors";
import { avatarHue } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SELECTED_ROW } from "@/components/ui/selection";
import { initialsOf } from "@/lib/initials";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";
import { cn } from "@/lib/utils";

import type { MailLinkedKind } from "../commands/spine";
import { AccountTick } from "./account-tick";
import { MAIL_THREAD_MIME } from "./mail-page-wiring";
import { MailRowFlags } from "./mail-row-flags";
import {
  type MailRowFlag,
  type MailRowPlace,
  rowFlags,
  rowPerson,
  rowTime,
  rowWho,
  rowWhoCompact,
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

/**
 * A pointer-only row control. The row is a listbox option, which may not hold interactive
 * children (axe nested-interactive), so the hover actions and the pick box are plain spans
 * hidden from assistive tech; the keys (e, s, x, ⇧E) and the reader toolbar carry the same
 * actions for keyboard and screen-reader use (specs/mail-v3.md §3, §7).
 */
function RowControl({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: typeof Check;
  onClick: (e: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <Button asChild variant="ghost" size="icon" className="size-(--ctrl-h-sm)">
      <span aria-hidden data-row-control={label} title={label} onClick={onClick}>
        <Icon aria-hidden />
      </span>
    </Button>
  );
}

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
      data-fade
      className={cn(
        "flex items-center gap-0.5 bg-linear-to-r from-transparent via-(--row-bg) via-25% to-(--row-bg) pl-4",
        className,
      )}
    >
      {done ? (
        <RowControl icon={Undo2} label="Not done" onClick={stop(() => actions.undone(threadId))} />
      ) : (
        <>
          <RowControl icon={Check} label="Done" onClick={stop(() => actions.done(threadId))} />
          <RowControl icon={Clock3} label="Snooze" onClick={stop(() => actions.snooze(threadId))} />
          <RowControl
            icon={MoreHorizontal}
            label="More"
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
  compact,
  actions,
}: {
  row: MailThreadRow;
  person: { name: string; email: string };
  picked: boolean;
  compact: boolean;
  actions: MailRowActions;
}) {
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
        aria-hidden
        data-avatar
        data-label={avatarHue(person.email.toLowerCase() || person.name || "?")}
        className={cn(
          "flex items-center justify-center rounded-full bg-label-fill leading-none font-semibold text-foreground",
          compact ? "size-5 text-3xs" : "size-8 text-xs",
        )}
      >
        {initialsOf(person.name || person.email)}
      </span>
      {/* Pointer-only like the hover actions (see RowControl); x picks from the keyboard.
          Hover: a check ring inside the circle. Picked: the circle fills with primary. */}
      <span
        aria-hidden
        data-check={picked ? "picked" : "hover"}
        data-row-control={picked ? "Deselect · x" : "Select · x"}
        title={picked ? "Deselect · x" : "Select · x"}
        onClick={stop(() => actions.togglePick(row.threadId))}
        className={cn(
          "absolute inset-0 items-center justify-center rounded-full",
          picked
            ? "flex bg-primary text-primary-foreground"
            : "hidden border-2 border-muted-foreground bg-(--row-bg) text-muted-foreground group-hover:flex",
        )}
      >
        <Check aria-hidden className={compact ? "size-3" : "size-3.5"} />
      </span>
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
  /** The account's hue for the tick after the time; null hides it (one account). */
  accountHue: LabelColor | null;
  /** The account's name: the tick's tooltip and the row's accessible name. */
  accountName?: string;
  /** The row sits under the PINNED heading: no pin flag (§2). */
  inPinnedGroup?: boolean;
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
    whoCompact: rowWhoCompact(p.row, place, self),
    person: rowPerson(p.row, place, self),
    time: rowTime(p.row, place, p.nowMs),
    flags: rowFlags(p.row, {
      place,
      nowMs: p.nowMs,
      linked: p.linked,
      notSent: p.notSent,
      offline: p.offline,
      inPinnedGroup: p.inPinnedGroup,
    }),
    subject: stripSubject(p.row.subject) || "(no subject)",
  };
}

/** Unread and the selected row keep full contrast; the rest read quieter (§2). */
const textTone = (strong: boolean) => (strong ? "text-foreground" : "text-muted-foreground");

type Facts = ReturnType<typeof rowFacts>;

function RowWho({
  row,
  who,
  compact,
  strong,
}: {
  row: MailThreadRow;
  who: string;
  compact: boolean;
  strong: boolean;
}) {
  return (
    <span
      data-row-who
      className={cn(
        "truncate text-sm",
        compact ? "w-(--mail-sender-w) shrink-0" : "min-w-0 flex-1",
        row.unread && "font-semibold",
        textTone(strong),
      )}
    >
      {who}
      {row.messageCount > 1 ? (
        <span className="ml-1 text-xs font-normal text-muted-foreground">{row.messageCount}</span>
      ) : null}
    </span>
  );
}

/** Flags, time, then the account tick: the right edge that never moves. */
function RowTail({ f, p }: { f: Facts; p: Props }) {
  return (
    <>
      <MailRowFlags flags={f.flags} />
      <time className="shrink-0 text-xs text-muted-foreground tabular-nums">{f.time}</time>
      {p.accountHue ? (
        <AccountTick hue={p.accountHue} name={p.accountName ?? ""} dim={!p.row.unread} />
      ) : null}
    </>
  );
}

function RowSubject({
  row,
  text,
  strong,
  grow = false,
}: {
  row: MailThreadRow;
  text: string;
  strong: boolean;
  grow?: boolean;
}) {
  return (
    <span
      data-row-subject
      title={row.subject || undefined}
      className={cn("min-w-0 truncate text-sm", grow && "flex-1", textTone(strong))}
    >
      {text}
    </span>
  );
}

/** "Jonas Weber, 6 messages, unread, priority person, has attachments, has a task, 9:58,
 *  Hale & Co, Work": the parts with commas, never the initials (AC28). */
export function rowAccessibleName(
  p: Pick<Props, "row" | "linked" | "accountHue" | "accountName">,
  f: { who: string; time: string; subject: string; flags: readonly MailRowFlag[] },
): string {
  const { row } = p;
  const parts = [
    f.who,
    row.messageCount > 1 ? `${row.messageCount} messages` : null,
    row.unread ? "unread" : null,
    row.priority ? "priority person" : null,
    row.hasAttachments ? "has attachments" : null,
    p.linked?.includes("task") ? "has a task" : null,
    ...f.flags.filter((x) => x.text).map((x) => x.text!.toLowerCase()),
    f.time,
    f.subject,
    p.accountHue && p.accountName ? p.accountName : null,
  ];
  return parts.filter(Boolean).join(", ");
}

type BodyProps = { p: Props; f: Facts };

/** Compact (A4): one line; the snippet takes only what's left, so it hides first. */
function CompactBody({ p, f }: BodyProps) {
  return (
    <>
      <RowWho row={p.row} who={f.whoCompact} compact strong={p.row.unread || p.cursor} />
      <span className="relative flex min-w-0 flex-1 items-center gap-2">
        <RowSubject row={p.row} text={f.subject} strong={p.row.unread || p.cursor} grow />
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
      <RowTail f={f} p={p} />
    </>
  );
}

/** Comfortable: the name line, the subject, one or two preview lines. */
function ComfortableBody({ p, f }: BodyProps) {
  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <RowWho row={p.row} who={f.who} compact={false} strong={p.row.unread || p.cursor} />
          <RowTail f={f} p={p} />
        </div>
        <RowSubject row={p.row} text={f.subject} strong={p.row.unread || p.cursor} />
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
      data-mail-row
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
        "group relative flex h-full w-full cursor-default gap-3 rounded-md px-3 text-left transition-colors duration-(--motion-fade) ease-(--ease-out) outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        "after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-hairline hover:after:hidden",
        compact ? "items-center gap-2" : "items-start py-2.5",
        cursor || picked ? cn(SELECTED_ROW, "after:hidden") : "hover:bg-state-hover",
      )}
    >
      {/* The row's name: one line read with commas (AC28). The visual parts below are
          hidden from assistive tech, so axe never compares a label to the initials. */}
      <span data-row-name className="sr-only">
        {rowAccessibleName(props, f)}
      </span>
      <RowLead row={row} person={f.person} picked={picked} compact={compact} actions={actions} />
      <span aria-hidden className="contents">
        {compact ? <CompactBody p={props} f={f} /> : <ComfortableBody p={props} f={f} />}
      </span>
    </div>
  );
});
