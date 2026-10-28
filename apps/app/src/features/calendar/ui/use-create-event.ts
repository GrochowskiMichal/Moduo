// A new event from the grid (draw, ⌘N, ↵, ⌘V, ⌘D) or the composer: one event,
// never two (new-event-create.ts). On Google it is created there first and kept
// as the mirror of Google's reply; if Google refuses, the toast offers Your
// calendar instead. One Undo for a saved Google event (CALR-4, AC21).

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { recordUndo } from "../commands/undo";
import { pushGoogleWebEvent } from "../google-web";
import type { CalendarModuleApi } from "../hooks/use-calendar-module";
import { createNewEvent, type NewEventDraft, type NewEventPorts } from "../new-event-create";

export type { NewEventDraft } from "../new-event-create";

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
      void (async () => {
        const ports: NewEventPorts = {
          // Without a runtime nothing can reach Google: the event stays native.
          accounts: runtime && workspaceId ? calendar.accounts : [],
          createNative: (native) => calendar.createEvent(native),
          pushGoogle: pushGoogleWebEvent,
          mirror: async (accountId, event) => {
            await runtime?.calendar.mirrorEvents({
              workspaceId,
              accountId,
              events: [event],
              deletedExternalIds: [],
            });
            await calendar.reload();
          },
          onRefused: ({ reason, saveToYourCalendar }) => {
            toast.error(reason, {
              action: {
                label: "Save to Your calendar instead",
                onClick: () => void saveToYourCalendar(),
              },
            });
          },
        };
        const out = await createNewEvent(draft, ports);
        if (out.saved !== "google") return;
        recordUndo(
          "Event added",
          async () => {
            const row = latest.current.events.find(
              (e) =>
                e.sourceAccountId === out.accountId && e.externalEventId === out.externalEventId,
            );
            if (row) await latest.current.deleteEvent(row.id, { quiet: true });
          },
          { toast: true, description: draft.title },
        );
      })();
    },
    [calendar, runtime, workspaceId],
  );
}
