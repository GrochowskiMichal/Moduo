// A new event from the grid (draw, ⌘N, ↵, ⌘V, ⌘D): on Your calendar through
// the module, on a connected Google calendar through Google first, then the
// mirror. Either way one Undo (CALR-4, AC21).

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { recordUndo } from "../commands/undo";
import { pushGoogleWebEvent } from "../google-web";
import type { CalendarModuleApi } from "../hooks/use-calendar-module";
import { mapGoogleEvent } from "../mirror";
import type { QuickCreateDraft } from "./event-quick-create";

type Draft = QuickCreateDraft & { description?: string };

export function useCreateEvent(
  calendar: CalendarModuleApi,
  runtime: ModuoRuntime | null,
  workspaceId: string,
): (draft: Draft) => void {
  // The undo runs later: find the mirrored row in the events as they are then.
  const latest = useRef(calendar);
  useEffect(() => {
    latest.current = calendar;
  });

  return useCallback(
    (draft: Draft) => {
      const target = calendar.accounts.find((account) => account.id === draft.calendarId);
      if (!target || target.provider !== "google" || !runtime || !workspaceId) {
        void calendar.createEvent(draft);
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
