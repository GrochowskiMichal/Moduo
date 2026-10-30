// The Event view (CALR-10, AC25; the popover's big sibling): title, when and
// repeats, Join, Private (P, CALR-15), the calendar, who sees it, the booking
// it came through, Where (place with Map, link with Copy, Add a place / Add a
// Meet link), people with their replies, linked notes and tasks as two-line
// rows, Link (L), the description, the quiet activity trail and Delete. Events you can't change
// render the same layout read-only with where they come from.

import { Trash2, Video, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import { DateField } from "../../../components/ui/date-field";
import { DetailTitle, detailTitleVariants } from "../../../components/ui/detail-title";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { Field } from "../../../components/ui/field";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { Separator } from "../../../components/ui/separator";
import { Switch } from "../../../components/ui/switch";
import type { EntityRef } from "../../../lib/entity-links";
import { useAppHotkeys } from "../../../lib/hotkeys";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { formatTime, formatWeekdayDate } from "../../../lib/time-format";
import { useTimeRegion } from "../../../lib/time-region";
import { timeAgo } from "../../contacts/rollup";
import { EntityTextEditor } from "../../spine/editor/lazy-entity-text-editor";
import { useEntityHub } from "../../spine/hooks/use-entity-hub";
import { createLinkWithToast } from "../../spine/ui/drop-link-toast";
import { EntityRichText } from "../../spine/ui/entity-rich-text";
import { loadEventContext } from "../event-context";
import { canAddMeet, canMakePrivate, type EventContext } from "../event-view";
import type { CalendarAccountModel, CalendarEventModel, CalendarEventPatch } from "../events";
import { meetingLinkOf } from "../meeting-link";
import type { EventWriter } from "../writable";
import { EventFeed } from "./event-feed";
import {
  EventCalendarRows,
  EventLinkedRows,
  EventPeopleRows,
  EventWhereRows,
  type ViewerMember,
} from "./event-view-rows";
import { RepeatPicker } from "./repeat-picker";
import { inCalendarOverlay } from "./use-calendar-hotkeys";
import { SecondZoneTime } from "./zone-gutter";

type Props = {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  currentUserId: string | null;
  event: CalendarEventModel;
  accounts: CalendarAccountModel[];
  canEdit: boolean;
  /** The event can change here (native, or a Google event you connected, CALR-8). Omitted = native only. */
  writable?: boolean;
  /** The workspace's people, for the who-sees-it line. */
  members?: readonly ViewerMember[];
  /** Reads the calendar, its sharing and the booking (injected in tests). */
  loadContext?: (
    event: CalendarEventModel,
    viewer: { userId: string | null; members: readonly ViewerMember[] },
  ) => Promise<EventContext>;
  onPatch: (eventId: string, patch: CalendarEventPatch) => void;
  onDeleteRequest: (eventId: string) => void;
  onClose: () => void;
  /** The ⋯ menu: the right-click menu's items with their keys (CALR-4b). */
  menu?: ReactNode;
};

/** "Thu, Jul 2, 3:00 PM" / "Thu, 2 Jul, 15:00": Time & region's date order and clock. */
function dateTimeText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatWeekdayDate(d)}, ${formatTime(d)}`;
}

export function EventDetailPanel({
  runtime,
  workspaceId,
  currentUserId,
  event,
  accounts,
  canEdit,
  writable,
  members = NO_MEMBERS,
  loadContext,
  onPatch,
  onDeleteRequest,
  onClose,
  menu = null,
}: Props) {
  // The read-only Starts / Ends redraw when Time & region changes.
  useTimeRegion();
  const external = event.sourceAccountId !== null;
  const meeting = meetingLinkOf(event);
  const editable = canEdit && (writable ?? !external);
  // Only Google events are writable from outside Moduo (CALR-8).
  const writer: EventWriter | null = editable ? (external ? "google" : "moduo") : null;
  const defaultLoad = useCallback<NonNullable<Props["loadContext"]>>(
    (e, viewer) => loadEventContext(runtime, e, viewer),
    [runtime],
  );
  const context = useEventContext(event, currentUserId, members, loadContext ?? defaultLoad);
  const account = useMemo(
    () => accounts.find((a) => a.id === event.sourceAccountId) ?? null,
    [accounts, event.sourceAccountId],
  );

  const [title, setTitle] = useState(event.title);
  // Notes are a Lexical editor (DF-23 — `@mention` / `/ref` inline, stored as
  // HTML); it seeds itself and commits on blur, so no local draft state here.
  // Times are DateFields: each saves once, when its picker closes.
  useEffect(() => {
    setTitle(event.title);
  }, [event.id, event.title]);

  const focus = useMemo(() => ({ type: "event", id: event.id }) as const, [event.id]);
  const hub = useEntityHub(runtime, workspaceId, focus);
  const hubReload = hub.reload;

  const linkEntity = useCallback(
    (ref: EntityRef, label: string, icon: string | null) => {
      if (!runtime || !workspaceId) return;
      void (async () => {
        // An edge that already exists isn't news (FX-9 parity).
        try {
          const links = await runtime.spine.listLinks({
            workspaceId,
            entityType: "event",
            entityId: event.id,
          });
          const linked = links.some(
            (l) =>
              (l.sourceType === ref.type && l.sourceId === ref.id) ||
              (l.targetType === ref.type && l.targetId === ref.id),
          );
          if (linked) {
            toast("Already linked");
            return;
          }
        } catch {
          // a failed pre-check must not block a legitimate link
        }
        await createLinkWithToast({
          runtime,
          workspaceId,
          source: { kind: "entity-drag", entityType: ref.type, entityId: ref.id, label, icon },
          target: { kind: "link-target", entityType: "event", entityId: event.id },
          origin: "manual",
          onChanged: hubReload,
        });
      })();
    },
    [runtime, workspaceId, event.id, hubReload],
  );

  const unlink = useCallback(
    (linkId: string) => {
      if (!runtime || !workspaceId) return;
      void runtime.spine
        .deleteLink({ workspaceId, linkId })
        .then(hubReload)
        .catch(() => toast.error("Couldn't remove the link."));
    },
    [runtime, workspaceId, hubReload],
  );

  const commitTitle = useCallback(() => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === event.title) {
      setTitle(event.title);
      return;
    }
    onPatch(event.id, { title: trimmed });
  }, [title, event.id, event.title, onPatch]);

  const commitTime = useCallback(
    (key: "startsAt" | "endsAt", value: Date | null, current: string) => {
      if (!value || Number.isNaN(value.getTime())) return;
      const iso = value.toISOString();
      if (iso !== current) onPatch(event.id, { [key]: iso });
    },
    [event.id, onPatch],
  );

  // Private (P, CALR-15): the owner's call; Google events send visibility first.
  const privateOffered = canMakePrivate(event, currentUserId, editable);
  useAppHotkeys({
    "calendar.private": (e) => {
      if (!privateOffered || e.repeat || inCalendarOverlay(e)) return false;
      onPatch(event.id, { isPrivate: !event.isPrivate });
    },
  });

  const now = new Date();

  return (
    <div className="pane-scroll scrollbar-thin flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>Event</Eyebrow>
        <div className="flex items-center gap-0.5">
          {menu}
          <IconButton icon={X} label="Close details" onClick={onClose} />
        </div>
      </div>

      {editable ? (
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          aria-label="Event title"
          className={detailTitleVariants()}
        />
      ) : (
        <DetailTitle>{event.title}</DetailTitle>
      )}

      {meeting ? (
        <div className="flex flex-col gap-1">
          <Button asChild size="sm" className="w-fit gap-1.5">
            <a href={meeting.url} target="_blank" rel="noreferrer">
              <Video aria-hidden />
              {meeting.label}
            </a>
          </Button>
        </div>
      ) : null}

      <Field label="Starts">
        {editable ? (
          <DateField
            withTime
            variant="outline"
            value={new Date(event.startsAt)}
            onChange={(d) => commitTime("startsAt", d, event.startsAt)}
            formatValue={(d) => dateTimeText(d.toISOString())}
            aria-label="Starts at"
          />
        ) : (
          <span className="text-sm text-foreground">{dateTimeText(event.startsAt)}</span>
        )}
      </Field>
      <Field label="Ends">
        {editable ? (
          <DateField
            withTime
            variant="outline"
            value={new Date(event.endsAt)}
            onChange={(d) => commitTime("endsAt", d, event.endsAt)}
            formatValue={(d) => dateTimeText(d.toISOString())}
            aria-label="Ends at"
          />
        ) : (
          <span className="text-sm text-foreground">{dateTimeText(event.endsAt)}</span>
        )}
      </Field>
      {event.allDay ? null : <SecondZoneTime startsAt={event.startsAt} endsAt={event.endsAt} />}
      <Field label="All day">
        <Switch
          checked={event.allDay}
          disabled={!editable}
          onCheckedChange={(v) => onPatch(event.id, { allDay: v })}
          aria-label="All day"
        />
      </Field>
      {privateOffered ? (
        <Field label="Private">
          <Switch
            checked={!!event.isPrivate}
            onCheckedChange={(v) => onPatch(event.id, { isPrivate: v })}
            aria-label="Private"
          />
        </Field>
      ) : null}

      <RepeatsField
        rrule={event.rrule}
        // A Google event's repeats change in Google for now (CALR-11).
        editable={editable && !external}
        onChange={(rrule) => onPatch(event.id, { rrule })}
      />

      <EventCalendarRows
        event={event}
        account={account}
        external={external}
        editable={editable}
        context={context.value}
        currentUserId={currentUserId}
        members={members}
        syncedAgo={account?.lastSyncAt ? timeAgo(account.lastSyncAt, now) : null}
        onReload={context.reload}
      />

      <EventWhereRows
        event={event}
        editable={editable}
        canMeet={canAddMeet(writer, event)}
        onPatch={(patch) => onPatch(event.id, patch)}
      />

      <EventPeopleRows attendees={event.attendees ?? []} />

      <EventLinkedRows
        eventId={event.id}
        runtime={runtime}
        workspaceId={workspaceId}
        status={hub.status}
        sections={hub.sections}
        canEdit={canEdit}
        onLink={linkEntity}
        onUnlink={unlink}
        onRetry={hubReload}
      />

      <Field label="Description">
        {editable ? (
          <EntityTextEditor
            key={event.id}
            value={event.description}
            editable
            runtime={runtime}
            workspaceId={workspaceId}
            source={{ type: "event", id: event.id }}
            sourceLabel={event.title}
            sourceIcon="event"
            currentUserId={currentUserId}
            ariaLabel="Description"
            placeholder="Description…  @ or / to link"
            onCommit={(html) => {
              if (html !== event.description) onPatch(event.id, { description: html });
            }}
          />
        ) : event.description ? (
          <EntityRichText html={event.description} className="text-sm text-foreground" />
        ) : (
          <span className="text-sm text-foreground">—</span>
        )}
      </Field>

      <Separator />

      <EventFeed
        runtime={runtime}
        workspaceId={workspaceId}
        currentUserId={currentUserId}
        event={event}
      />

      {editable ? (
        <>
          <Separator />
          <Button
            variant="ghost"
            size="sm"
            className="justify-start gap-1.5 text-destructive hover:bg-destructive/10"
            onClick={() => onDeleteRequest(event.id)}
          >
            <Trash2 aria-hidden />
            Delete event
          </Button>
        </>
      ) : null}
    </div>
  );
}

const NO_MEMBERS: readonly ViewerMember[] = [];

/**
 * The event's context (calendar, sharing, booking), read again when the event
 * or its calendar changes; a reply for an event no longer shown is dropped.
 */
function useEventContext(
  event: CalendarEventModel,
  userId: string | null,
  members: readonly ViewerMember[],
  load: NonNullable<Props["loadContext"]>,
): { value: EventContext | null; reload: () => void } {
  const [state, setState] = useState<{ key: string; value: EventContext } | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  // The row's own fields don't change what is read; its id and calendar do.
  const eventRef = useRef(event);
  useEffect(() => {
    eventRef.current = event;
  });
  const eventId = event.id;
  const calendarRef = event.calendarRef;
  useEffect(() => {
    let active = true;
    load(eventRef.current, { userId, members })
      .then((value) => {
        if (active) setState({ key: `${eventId}:${calendarRef ?? ""}`, value });
      })
      .catch(() => {
        if (active) setState(null);
      });
    return () => {
      active = false;
    };
  }, [eventId, calendarRef, userId, members, load, tick]);
  return { value: state?.key === `${eventId}:${calendarRef ?? ""}` ? state.value : null, reload };
}

/** The Repeats row: the picker, and the series note while it repeats. */
function RepeatsField({
  rrule,
  editable,
  onChange,
}: {
  rrule: string | null;
  editable: boolean;
  onChange: (rrule: string | null) => void;
}) {
  return (
    <Field label="Repeats">
      <div className="flex min-w-0 flex-col gap-1">
        <RepeatPicker value={rrule} disabled={!editable} onChange={onChange} />
        {editable && rrule ? (
          <span className="text-2xs text-muted-foreground">Edits apply to the whole series.</span>
        ) : null}
      </div>
    </Field>
  );
}
