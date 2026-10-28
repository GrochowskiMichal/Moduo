// A new event from the grid (draw, ⌘N, ↵, ⌘V, ⌘D): on Your calendar through
// the module, on a connected Google calendar through Google first, then the
// mirror. Either way one Undo (CALR-4, AC21).

import type { CalendarItemKind } from "@contracts/vocabularies";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { recordUndo } from "../commands/undo";
import { pushGoogleWebEvent } from "../google-web";
import type { CalendarModuleApi } from "../hooks/use-calendar-module";
import { mapGoogleEvent } from "../mirror";
import type { QuickCreateDraft } from "./event-quick-create";

/**
 * What a new event can carry. The composer (CALR-9) adds a place, people, a
 * kind, a Meet link Google makes, and a Moduo or custom calendar row.
 */
export type NewEventDraft = QuickCreateDraft & {
  description?: string;
  location?: string;
  attendees?: { email: string; name?: string }[];
  kind?: CalendarItemKind;
  /** Google only: ask it for a Meet link. */
  meet?: "add";
  /** A Moduo or custom calendar's row id, when `calendarId` is "moduo". */
  nativeCalendarId?: string;
};

export function useCreateEvent(
  calendar: CalendarModuleApi,
  runtime: ModuoRuntime | null,
  workspaceId: string,
): (draft: NewEventDraft) => void {
  // The undo runs later: find the mirrored row in the events as they are then.
  const latest = useRef(calendar);
  useEffect(() => {
    latest.current = calendar;
  });

  return useCallback(
    (draft: NewEventDraft) => {
      const target = calendar.accounts.find((account) => account.id === draft.calendarId);
      if (!target || target.provider !== "google" || !runtime || !workspaceId) {
        const { nativeCalendarId, meet: _meet, calendarId: _account, ...rest } = draft;
        void calendar.createEvent({ ...rest, calendarId: nativeCalendarId });
        return;
      }
      void (async () => {
        try {
          const raw = await pushGoogleWebEvent({
            externalAccountId: target.externalId,
            title: draft.title,
            startsAt: draft.startsAt,
            endsAt: draft.endsAt,
            allDay: draft.allDay,
            rrule: draft.rrule,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            description: draft.description || undefined,
            location: draft.location,
            attendees: draft.attendees?.length ? draft.attendees : undefined,
            meet: draft.meet,
          });
          const mapped = mapGoogleEvent(raw);
          if (!mapped) throw new Error("Google did not return the event.");
          await runtime.calendar.mirrorEvents({
            workspaceId,
            accountId: target.id,
            events: [mapped],
            deletedExternalIds: [],
          });
          await calendar.reload();
          recordUndo(
            "Event added",
            async () => {
              const row = latest.current.events.find(
                (e) =>
                  e.sourceAccountId === target.id && e.externalEventId === mapped.externalEventId,
              );
              if (row) await latest.current.deleteEvent(row.id, { quiet: true });
            },
            { toast: true, description: draft.title },
          );
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't save the event on Google.");
        }
      })();
    },
    [calendar, runtime, workspaceId],
  );
}
