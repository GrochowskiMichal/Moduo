// A reference's card (tasks-v3 §11; research §6, prototype round-1c frames
// 2–4): the key facts and one action. The same body is the card form in
// prose, the hover preview and the panel's view of an item it can't show in
// full. Tokens only; the kit's Chip/ItemCard language (DS-6).

import type { LucideIcon } from "lucide-react";
import {
  Ban,
  CalendarDays,
  Circle,
  CircleCheck,
  CircleDashed,
  Contrast,
  FolderKanban,
  Hourglass,
  ListChecks,
  Mail,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";

import { PersonAvatar } from "../../../../components/ui/avatar";
import { CompleteToggle } from "../../../../components/ui/complete-toggle";
import { cn } from "../../../../lib/utils";
import { resolveEntityIcon } from "../../icon-map";
import type { ReferenceLead as Lead, ReferenceFacts, ReferenceMeta, TaskCategory } from "../types";

const STATUS_ICONS: Record<TaskCategory, LucideIcon> = {
  backlog: CircleDashed,
  todo: Circle,
  in_progress: Contrast,
  done: CircleCheck,
  wont_do: Ban,
};

const STATUS_WORDS: Record<TaskCategory, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  wont_do: "Won’t do",
};

/** A task's category icon (53a): dotted · empty · half · check · crossed. */
export function StatusGlyph({
  category,
  className,
}: {
  category: TaskCategory;
  className?: string;
}) {
  const Icon = STATUS_ICONS[category];
  return (
    <Icon
      aria-label={STATUS_WORDS[category]}
      role="img"
      className={cn(
        "size-icon-sm shrink-0",
        category === "done" ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    />
  );
}

/** What leads a link or a chip: status icon, avatar, colour dot or type icon. */
export function ReferenceLead({ lead }: { lead: Lead }) {
  switch (lead.kind) {
    case "status":
      return <StatusGlyph category={lead.category} />;
    case "person":
      return (
        <PersonAvatar
          name={lead.person.name}
          id={lead.person.id ?? undefined}
          src={lead.person.avatarUrl}
          size="icon"
        />
      );
    case "dot":
      return (
        <span
          data-label={lead.color ?? "gray"}
          className="tag-dot size-2 shrink-0 rounded-full"
          aria-hidden
        />
      );
    case "icon": {
      const Icon = resolveEntityIcon(lead.type);
      return <Icon aria-hidden className="size-icon-sm shrink-0 text-muted-foreground" />;
    }
  }
}

const META_ICONS: Record<string, LucideIcon> = {
  due: CalendarDays,
  project: FolderKanban,
  subtasks: ListChecks,
  waiting: Hourglass,
  people: Users,
  mail: Mail,
};

function MetaItem({ item }: { item: ReferenceMeta }) {
  const Icon = item.icon ? META_ICONS[item.icon] : undefined;
  return (
    <span
      title={item.title ?? undefined}
      className={cn(
        "inline-flex min-w-0 items-center gap-1",
        item.tone === "late" && "text-subtle-foreground",
      )}
    >
      {Icon ? <Icon aria-hidden className="size-icon-xs shrink-0 text-subtle-foreground" /> : null}
      <span className="min-w-0 break-words">{item.text}</span>
    </span>
  );
}

export type ReferenceCardBodyProps = {
  facts: ReferenceFacts;
  /** The card's facts are on their way (a hover just opened). */
  pending?: boolean;
  /** Complete / reopen a task; absent = the action isn't offered here. */
  onComplete?: (done: boolean) => void;
  /** The title opens the item (a button), when given. */
  onOpen?: (event: React.MouseEvent<HTMLElement>) => void;
  /** Extra controls at the end (the hover card's "Show as"). */
  footer?: ReactNode;
};

/** The card's content: overline, title row (with its one action), excerpt, meta. */
export function ReferenceCardBody({
  facts,
  pending,
  onComplete,
  onOpen,
  footer,
}: ReferenceCardBodyProps) {
  const card = facts.card;
  const action = card?.action;
  const lead =
    action?.kind === "complete" && onComplete ? (
      <CompleteToggle
        done={action.done}
        onToggle={() => onComplete(!action.done)}
        aria-label={action.done ? "Mark as not done" : "Mark as done"}
      />
    ) : (
      <ReferenceLead lead={facts.lead} />
    );
  const title = onOpen ? (
    <button
      type="button"
      onClick={onOpen}
      className="min-w-0 break-words text-left outline-none hover:underline focus-visible:underline"
    >
      {facts.title}
    </button>
  ) : (
    <span className="min-w-0 break-words">{facts.title}</span>
  );
  return (
    <span className="flex min-w-0 flex-col gap-1" aria-busy={pending || undefined}>
      {card?.overline ? (
        <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
          {card.overline.person ? (
            <PersonAvatar
              name={card.overline.person.name}
              id={card.overline.person.id ?? undefined}
              src={card.overline.person.avatarUrl}
            />
          ) : null}
          <span className="min-w-0 break-words font-medium">{card.overline.text}</span>
          {card.overline.trailing ? (
            <span className="ms-auto shrink-0 text-xs text-subtle-foreground">
              {card.overline.trailing}
            </span>
          ) : null}
        </span>
      ) : null}
      <span className="flex min-w-0 items-start gap-2 text-base leading-snug text-foreground">
        <span className="flex h-lh shrink-0 items-center">{lead}</span>
        {title}
      </span>
      {card?.excerpt ? (
        <span className="line-clamp-2 block ps-6 text-sm text-muted-foreground">
          {card.excerpt}
        </span>
      ) : null}
      {card && (card.meta.length > 0 || card.person) ? (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 ps-6 text-xs text-muted-foreground tabular-nums">
          {card.meta.map((item) => (
            <MetaItem key={item.key} item={item} />
          ))}
          {card.person ? (
            <span className="ms-auto inline-flex items-center gap-1" title={card.person.name}>
              <PersonAvatar
                name={card.person.name}
                id={card.person.id ?? undefined}
                src={card.person.avatarUrl}
              />
              <span className="sr-only">{card.person.name}</span>
            </span>
          ) : null}
        </span>
      ) : pending ? (
        <span className="block ps-6 text-xs text-subtle-foreground">…</span>
      ) : null}
      {footer}
    </span>
  );
}
