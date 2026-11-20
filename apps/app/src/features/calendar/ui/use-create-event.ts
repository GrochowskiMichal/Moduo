// A new event from the grid (draw, ⌘N, ↵, ⌘V, ⌘D) or the composer: one event,
// never two (new-event-create.ts). On Google it is created there first, under
// an id this app made, and kept as the mirror of Google's reply; if Google
// refuses or can't be reached, the toast offers Your calendar instead, which
// first asks Google for that id. One Undo for a saved Google event (CALR-4, AC21).

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { recordUndo } from "../commands/undo";
import type { CalendarAccountModel } from "../events";
import { getGoogleWebEvent, pushGoogleWebEvent } from "../google-web";
import type { CalendarModuleApi } from "../hooks/use-calendar-module";
import {
  createNewEvent,
  type NewEventDraft,
  type NewEventOutcome,
  type NewEventPorts,
} from "../new-event-create";

export type { NewEventDraft } from "../new-event-create";

type Refusal = Parameters<NewEventPorts["onRefused"]>[0];

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
      /** Undo of a Google create: the row if the week has it, else by its Google id. */
      const recordGoogleUndo = (out: Extract<NewEventOutcome, { saved: "google" }>) => {
        recordUndo(
          "Event added",
          async () => {
            const row = latest.current.events.find(
              (e) =>
                e.sourceAccountId === out.accountId && e.externalEventId === out.externalEventId,
            );
            if (row) {
              await latest.current.deleteEvent(row.id, { quiet: true });
              return;
            }
            const account = latest.current.accounts.find((a) => a.id === out.accountId);
            if (account && runtime) await removeByGoogleId(runtime, workspaceId, account, out);
          },
          { toast: true, description: draft.title },
        );
      };

      const offer = (message: string, { saveToYourCalendar }: Refusal) => {
        // Kept until dismissed: the composer has closed, and this is the only
        // place the typed event still lives.
        toast.error(message, {
          duration: Number.POSITIVE_INFINITY,
          description: draft.attendees?.length
            ? "On Your calendar instead, the guests won't be invited."
            : undefined,
          action: {
            label: "Save to Your calendar instead",
            onClick: () => {
              saveToYourCalendar().then(
                (out) => {
                  if (out.saved === "google") {
                    void latest.current.reload();
                    recordGoogleUndo(out);
                    toast("Google had saved it after all: it's on your Google calendar.");
                  }
                },
                () =>
                  offer("Couldn't ask Google whether it saved the event, so nothing was saved.", {
                    reason: message,
                    saveToYourCalendar,
                  }),
              );
            },
          },
        });
      };

      void (async () => {
        const ports: NewEventPorts = {
          // Without a runtime nothing can reach Google: the event stays native.
          accounts: runtime && workspaceId ? calendar.accounts : [],
          createNative: (native) => calendar.createEvent(native),
          pushGoogle: pushGoogleWebEvent,
          findOnGoogle: (externalAccountId, eventId) =>
            getGoogleWebEvent({ externalAccountId, eventId }),
          mirror: async (accountId, event) => {
            await runtime?.calendar.mirrorEvents({
              workspaceId,
              accountId,
              events: [event],
              deletedExternalIds: [],
            });
            await calendar.reload();
          },
          onRefused: (refusal) => offer(refusal.reason, refusal),
        };
        const out = await createNewEvent(draft, ports);
        if (out.saved === "google") recordGoogleUndo(out);
      })();
    },
    [calendar, runtime, workspaceId],
  );
}

/** Deletes a Google event this app created, by the id it made, when the week has no row for it. */
async function removeByGoogleId(
  runtime: ModuoRuntime,
  workspaceId: string,
  account: CalendarAccountModel,
  out: { accountId: string; externalEventId: string },
): Promise<void> {
  const now = new Date().toISOString();
  await runtime.calendar.removeGoogleEvent({
    workspaceId,
    account,
    event: {
      id: "",
      workspaceId,
      ownerId: account.ownerId,
      sourceAccountId: out.accountId,
      externalEventId: out.externalEventId,
      calendarId: account.externalId,
      title: "",
      description: "",
      startsAt: now,
      endsAt: now,
      allDay: false,
      rrule: null,
      status: "confirmed",
      color: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  });
}
