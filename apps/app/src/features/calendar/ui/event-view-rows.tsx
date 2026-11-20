// The Event view's rows (CALR-10, AC25): the calendar with who sees it and the
// booking, Where (place with Map, link with Copy, Add a place, Add a Meet link
// on V), people with their replies, and Linked: reference cards as a task's,
// with + (or L) to link a person, note or task.

import {
  Calendar,
  Check,
  Clock,
  Copy,
  Link2,
  type LucideIcon,
  MapPin,
  Plus,
  User,
  Video,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import { CollectionHeader } from "../../../components/ui/collection-header";
import { GroupHeader } from "../../../components/ui/group-header";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { Kbd } from "../../../components/ui/kbd";
import type { EntityRef } from "../../../lib/entity-links";
import { ENTITY_OPEN_EVENT } from "../../../lib/entity-open";
import { useAppHotkeys } from "../../../lib/hotkeys";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { formatDate } from "../../../lib/time-format";
import { cn } from "../../../lib/utils";
import { ShareMenu } from "../../sharing/share-menu";
import type { HubStatus } from "../../spine/hooks/use-entity-hub";
import { useMentionSearch } from "../../spine/hooks/use-mention-search";
import { Reference } from "../../spine/references/ui/reference";
import type { HubSection } from "../../spine/rollup";
import { MentionPicker } from "../../spine/ui/mention-picker";
import {
  type EventContext,
  linkLines,
  mapUrl,
  placeLines,
  replyLabel,
  showsLock,
  whoSeesLine,
} from "../event-view";
import type {
  CalendarAccountModel,
  CalendarAttendee,
  CalendarEventModel,
  CalendarEventPatch,
} from "../events";
import { useEventLinkRequest } from "./event-link-request";
import { inCalendarOverlay } from "./use-calendar-hotkeys";

export type ViewerMember = { userId: string; name: string };

/** One two-line row: a first line, a quieter second line, and what sits at its end. */
function TwoLineRow({
  icon: Icon,
  first,
  second,
  trailing,
  onOpen,
}: {
  icon: LucideIcon;
  first: string;
  second: string | null;
  trailing?: ReactNode;
  onOpen?: () => void;
}) {
  const lines = (
    <>
      <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm leading-snug text-foreground">{first}</span>
        {second ? (
          <span className="truncate text-xs leading-snug text-muted-foreground">{second}</span>
        ) : null}
      </span>
    </>
  );
  return (
    <div
      data-row="two-line"
      className="group flex min-h-8 items-center gap-2 rounded-md px-2 py-1 hover:bg-state-hover"
    >
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {lines}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">{lines}</div>
      )}
      {trailing}
    </div>
  );
}

/** A quiet "add" row (Add a place, Add a Meet link, Link…). */
function AddRow({
  icon: Icon,
  label,
  hint,
  onClick,
  ...rest
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  onClick?: () => void;
} & React.ComponentProps<"button">) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2 px-2 font-normal text-muted-foreground"
      onClick={onClick}
      {...rest}
    >
      <Icon aria-hidden />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {hint ? <Kbd>{hint}</Kbd> : null}
    </Button>
  );
}

/** "Oct 16" / "16 Oct" (the year when it isn't this one): Time & region's date order. */
function fmtBooked(iso: string): string {
  return formatDate(iso);
}

/** The calendar's name and its quiet facts ("· Google, view only, synced 2m ago"). */
function calendarFacts(input: {
  account: CalendarAccountModel | null;
  external: boolean;
  editable: boolean;
  calendarName: string | null;
  syncedAgo: string | null;
}): { name: string; sub: string } {
  const { account, external } = input;
  const name = external
    ? account?.displayLabel || "External calendar"
    : (input.calendarName ?? "Moduo calendar");
  let source = "Moduo";
  if (external)
    source = account?.provider === "google" ? "Google" : account?.provider || "External";
  const sub = [
    `· ${source}`,
    input.editable ? null : "view only",
    input.syncedAgo ? `synced ${input.syncedAgo}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return { name, sub };
}

/** The who-sees-it line; for the calendar's owner it opens Sharing. */
function WhoSeesRow({
  line,
  calendarRef,
  canShare,
  currentUserId,
  members,
  onReload,
}: {
  line: string;
  calendarRef: string | null;
  canShare: boolean;
  currentUserId: string | null;
  members: readonly ViewerMember[];
  onReload: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  if (!canShare || !calendarRef) {
    return (
      <div className="flex min-h-7 items-center gap-2 px-2 text-sm text-muted-foreground">
        <User className="size-icon-sm shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{line}</span>
      </div>
    );
  }
  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 px-2 font-normal text-muted-foreground"
        aria-label={`${line}. Change who sees your calendar`}
        onClick={() => setSharing(true)}
      >
        <User aria-hidden />
        <span className="min-w-0 truncate">{line}</span>
      </Button>
      {sharing ? (
        <ShareMenu
          resourceType="calendar"
          resourceId={calendarRef}
          members={[...members]}
          selfUserId={currentUserId}
          levels={CAL_LEVELS}
          defaultLevel="freebusy"
          defaultOpen
          anchor="parent"
          onOpenChange={(open) => {
            if (open) return;
            setSharing(false);
            onReload();
          }}
        />
      ) : null}
    </div>
  );
}

/** The calendar the event is on, who sees it (which opens Sharing), and its booking. */
export function EventCalendarRows({
  event,
  account,
  external,
  editable,
  context,
  currentUserId,
  members,
  syncedAgo,
  onReload,
}: {
  event: CalendarEventModel;
  account: CalendarAccountModel | null;
  external: boolean;
  editable: boolean;
  context: EventContext | null;
  currentUserId: string | null;
  members: readonly ViewerMember[];
  syncedAgo: string | null;
  onReload: () => void;
}) {
  const { name, sub } = calendarFacts({
    account,
    external,
    editable,
    calendarName: context?.calendarName ?? null,
    syncedAgo,
  });
  // Only the calendar's owner gets the line: their grants are the whole truth,
  // while on a teammate's calendar the owner holds no grant row and the list
  // of who else it is shared with isn't yours to read. It also waits for the
  // workspace's people, or an empty list would read as "Only you see it".
  // (The calendar's owner when read, else the event's own.)
  const owned = !!currentUserId && (context?.calendarOwnerId ?? event.ownerId) === currentUserId;
  // Your own private event says so whatever has loaded (CALR-15).
  const line = showsLock(event, currentUserId)
    ? whoSeesLine({ workspaceLevel: null, people: [] }, members, currentUserId, {
        isPrivate: true,
      })
    : // A teammate's private event on your calendar reaches you as "Busy":
      // your calendar's sharing doesn't describe it.
      owned &&
        !(event.isPrivate && event.ownerId !== currentUserId) &&
        context?.share &&
        members.length > 0
      ? whoSeesLine(context.share, members, currentUserId, { isFocus: event.kind === "focus" })
      : null;
  const booked = context?.bookedThrough ?? null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-7 items-center gap-2 px-2 text-sm">
        <Calendar className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate text-foreground">{name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{sub}</span>
      </div>
      {line ? (
        <WhoSeesRow
          line={line}
          calendarRef={event.calendarRef ?? null}
          canShare={members.length >= 2}
          currentUserId={currentUserId}
          members={members}
          onReload={onReload}
        />
      ) : null}
      {booked ? (
        <div className="flex min-h-7 items-center gap-2 px-2 text-sm text-muted-foreground">
          <Link2 className="size-icon-sm shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            Booked through {booked.name}{" "}
            <span className="text-subtle-foreground">· {fmtBooked(booked.bookedAt)}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

const CAL_LEVELS = [
  { id: "freebusy", label: "Busy only" },
  { id: "view", label: "Can view" },
  { id: "edit", label: "Can edit" },
] as const;

/**
 * "Add a Meet link" (V). One request per event: until Google answers, the
 * event has no link yet, and a second add could swap the first for another.
 */
function MeetAddRow({
  eventId,
  hasPlace,
  onAdd,
}: {
  eventId: string;
  hasPlace: boolean;
  onAdd: () => void;
}) {
  const [askedFor, setAskedFor] = useState<string | null>(null);
  const offered = askedFor !== eventId;
  const add = () => {
    if (!offered) return;
    setAskedFor(eventId);
    onAdd();
  };
  useAppHotkeys({
    "calendar.add-meet": (e) => {
      if (!offered || e.repeat || inCalendarOverlay(e)) return false;
      add();
    },
  });
  if (!offered) return null;
  return (
    <AddRow
      icon={Video}
      label={hasPlace ? "Add a Meet link, for anyone joining remotely" : "Add a Meet link"}
      hint="V"
      onClick={add}
    />
  );
}

/** Where: the place on two lines with Map, the link on two lines with Copy, and the adds. */
export function EventWhereRows({
  event,
  editable,
  canMeet,
  onPatch,
}: {
  event: CalendarEventModel;
  editable: boolean;
  canMeet: boolean;
  onPatch: (patch: CalendarEventPatch) => void;
}) {
  const place = placeLines(event.location);
  const link = linkLines(event);
  const [placeDraft, setPlaceDraft] = useState<string | null>(null);

  const commitPlace = () => {
    const value = placeDraft?.trim() ?? "";
    setPlaceDraft(null);
    if (value) onPatch({ location: value });
  };

  if (!place && !link && !editable) return null;
  const copy = (url: string) => {
    void navigator.clipboard
      ?.writeText(url)
      .then(() => toast("Link copied"))
      .catch(() => toast.error("Couldn't copy the link."));
  };

  return (
    <div className="flex flex-col gap-0.5">
      <GroupHeader label="Where" />
      {place ? (
        <TwoLineRow
          icon={MapPin}
          first={place.name}
          second={place.address}
          trailing={
            <Button asChild variant="ghost" size="sm" className="shrink-0">
              <a href={mapUrl(event.location ?? "")} target="_blank" rel="noreferrer">
                Map
              </a>
            </Button>
          }
        />
      ) : null}
      {link ? (
        <TwoLineRow
          icon={Video}
          first={link.provider}
          second={link.url}
          trailing={
            <IconButton
              icon={Copy}
              label="Copy the meeting link"
              size="sm"
              className="shrink-0"
              onClick={() => copy(link.url)}
            />
          }
        />
      ) : null}
      {editable && !place ? (
        placeDraft !== null ? (
          <Input
            autoFocus
            value={placeDraft}
            placeholder="Name, address"
            aria-label="Place"
            onChange={(e) => setPlaceDraft(e.target.value)}
            onBlur={commitPlace}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitPlace();
              if (e.key === "Escape") {
                e.preventDefault();
                setPlaceDraft(null);
              }
            }}
          />
        ) : (
          <AddRow
            icon={MapPin}
            label={link ? "Add a place, for anyone in the room" : "Add a place"}
            onClick={() => setPlaceDraft("")}
          />
        )
      ) : null}
      {canMeet ? (
        <MeetAddRow eventId={event.id} hasPlace={!!place} onAdd={() => onPatch({ meet: "add" })} />
      ) : null}
    </div>
  );
}

function ReplyMark({ status }: { status: string }) {
  const label = replyLabel(status);
  const Icon = label === "Accepted" ? Check : label === "Declined" ? X : Clock;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs",
        label === "Accepted" ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <Icon className="size-icon-xs" aria-hidden />
      {label}
    </span>
  );
}

/** People: each guest's name and address, with their reply. */
export function EventPeopleRows({ attendees }: { attendees: readonly CalendarAttendee[] }) {
  if (attendees.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <GroupHeader label="People" count={attendees.length} />
      {attendees.map((person) => {
        const name = person.name?.trim() || person.email;
        return (
          <TwoLineRow
            key={person.email}
            icon={User}
            first={person.self ? `${name} (you)` : name}
            second={name === person.email ? null : person.email}
            trailing={<ReplyMark status={person.status} />}
          />
        );
      })}
    </div>
  );
}

const LINKABLE = ["contact", "note", "task"];
/** Linked shows this many cards, then "Show n more" (as a task's). */
const LINKED_VISIBLE = 5;

/** Linked: one header with + (and L), then a reference card per item, as a task's Linked. */
export function EventLinkedRows({
  runtime,
  workspaceId,
  status,
  sections,
  canEdit,
  eventId,
  onLink,
  onUnlink,
  onRetry,
}: {
  /** The event shown: an event menu's Link opens this picker (CALR-4b). */
  eventId?: string;
  runtime: ModuoRuntime | null;
  workspaceId: string;
  status: HubStatus;
  sections: HubSection[];
  canEdit: boolean;
  onLink: (ref: EntityRef, label: string, icon: string | null) => void;
  onUnlink: (linkId: string) => void;
  onRetry: () => void;
}) {
  const rows = sections.flatMap((s) => s.rows);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(false);
  const openPicker = useCallback(() => setOpen(true), []);
  const linking = canEdit && !!runtime;
  const search = useMentionSearch({
    runtime,
    workspaceId,
    trigger: "ref",
    types: LINKABLE,
    canCreate: false,
    createType: null,
    includePeople: false,
    enabled: open,
  });
  useAppHotkeys({
    "calendar.link": (e) => {
      if (!linking || e.repeat || inCalendarOverlay(e)) return false;
      setOpen(true);
    },
  });
  useEventLinkRequest(eventId ?? "", linking && !!eventId, openPicker);

  const shown = all ? rows : rows.slice(0, LINKED_VISIBLE);
  // The same Linked as a task's: one header with +, then a card per item.
  return (
    <div>
      <CollectionHeader
        label="Linked"
        count={rows.length}
        action={
          linking ? (
            <MentionPicker
              open={open}
              onOpenChange={setOpen}
              trigger={<IconButton icon={Plus} label="Link a person, note or task" />}
              candidates={search.candidates}
              query={search.query}
              onQueryChange={search.setQuery}
              loading={search.loading}
              placeholder="Link a person, note or task…"
              emptyLabel="Nothing to link."
              onSelect={(candidate) => {
                setOpen(false);
                if (candidate.kind === "entity")
                  onLink(candidate.ref, candidate.label, candidate.icon);
              }}
            />
          ) : null
        }
      />
      {status === "error" ? (
        <p className="text-xs text-muted-foreground">
          Linked items didn’t load.{" "}
          <Button variant="ghost" size="sm" onClick={onRetry} className="-my-1 px-1.5 text-xs">
            Retry
          </Button>
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        {shown.map((r) => (
          <div key={r.link.id} className="group relative">
            <Reference type={r.other.type} id={r.other.id} display="card" fallbackLabel={r.title} />
            {canEdit ? (
              <IconButton
                icon={X}
                label="Unlink"
                tooltip="Unlink (keeps the item)"
                onClick={() => onUnlink(r.link.id)}
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              />
            ) : null}
          </div>
        ))}
      </div>
      {!all && rows.length > LINKED_VISIBLE ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAll(true)}
          className="-ms-2 mt-1 text-xs font-normal text-muted-foreground"
        >
          Show {rows.length - LINKED_VISIBLE} more
        </Button>
      ) : null}
    </div>
  );
}
