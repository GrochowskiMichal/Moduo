// The chip row under the subject (specs/mail-v3.md §8, AC22): the thread's
// state ("Waiting · reminds Thu", "Returns Mon 9:00", "Done"), one chip per
// linked item (a click opens it; the hover ✕ unlinks, with undo) and the Link
// chip with its `l` key cap.

import {
  Archive,
  BellRing,
  CalendarDays,
  Clock,
  Folder,
  Link2,
  ListTodo,
  StickyNote,
  User,
} from "lucide-react";
import type { ComponentType } from "react";

import { Chip, ChipButton } from "@/components/ui/chip";
import { Kbd } from "@/components/ui/kbd";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import type { MailThreadLink } from "../commands/spine";
import { dayTime, shortDay } from "./reader-format";
import { linkChipLabel } from "./thread-links";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

const KIND_ICON: Record<string, Icon> = {
  task: ListTodo,
  note: StickyNote,
  contact: User,
  project: Folder,
  calendar_event: CalendarDays,
  event: CalendarDays,
};

export type ChipRowProps = {
  row: MailThreadRow;
  nowMs: number;
  /** The thread sits in Archive (the place the reader was opened from). */
  done?: boolean;
  links: readonly MailThreadLink[];
  onOpenLink?: (link: MailThreadLink) => void;
  onUnlink?: (link: MailThreadLink) => void;
  /** The Link chip; absent hides it (no spine on this page). */
  onLink?: () => void;
};

function StateChips({ row, nowMs, done }: Pick<ChipRowProps, "row" | "nowMs" | "done">) {
  const followUp = row.followUpAtMs ?? null;
  const snoozed = row.snoozedUntilMs !== null && row.snoozedUntilMs > nowMs;
  return (
    <>
      {followUp !== null ? (
        <Chip size="xs" icon={BellRing}>
          Waiting · reminds {shortDay(followUp, nowMs)}
        </Chip>
      ) : null}
      {snoozed ? (
        <Chip size="xs" icon={Clock}>
          Returns {dayTime(row.snoozedUntilMs!, nowMs)}
        </Chip>
      ) : null}
      {done ? (
        <Chip size="xs" icon={Archive}>
          Done
        </Chip>
      ) : null}
    </>
  );
}

function LinkChip({
  link,
  onOpen,
  onUnlink,
}: {
  link: MailThreadLink;
  onOpen?: (link: MailThreadLink) => void;
  onUnlink?: (link: MailThreadLink) => void;
}) {
  const label = linkChipLabel(link);
  return (
    <Chip
      size="xs"
      icon={KIND_ICON[link.entity.type] ?? Link2}
      removeOnHover
      removeLabel={`Unlink ${label}`}
      onRemove={onUnlink ? () => onUnlink(link) : undefined}
      data-link-id={link.linkId}
    >
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(link)}
          className="min-h-6 max-w-full truncate rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {label}
        </button>
      ) : (
        label
      )}
    </Chip>
  );
}

export function ChipRow({ row, nowMs, done, links, onOpenLink, onUnlink, onLink }: ChipRowProps) {
  return (
    <div
      role="group"
      aria-label="What this thread is to you"
      className="flex min-w-0 flex-wrap items-center gap-1.5 px-4 pb-2 text-xs text-muted-foreground"
    >
      <StateChips row={row} nowMs={nowMs} done={done} />
      {links.map((link) => (
        <LinkChip key={link.linkId} link={link} onOpen={onOpenLink} onUnlink={onUnlink} />
      ))}
      {onLink ? (
        // "Link…" with its key after it (specs/mail-improve.md §4).
        <ChipButton
          size="xs"
          icon={Link2}
          aria-label="Link… to a task, contact or note"
          aria-keyshortcuts="l"
          title="Link to a task, contact or note  l"
          onClick={onLink}
        >
          <span className="flex items-center gap-1">
            Link… <Kbd>l</Kbd>
          </span>
        </ChipButton>
      ) : null}
    </div>
  );
}
