// One new event, never two (specs/calendar-rethink.md, Assumptions "New events
// go to"). On Your calendar it is one native event. On a Google calendar it is
// created on Google first and the only row kept is the mirror of Google's reply:
// never a native row as well, also not when storing the reply fails (the next
// sync brings it). If Google refuses, nothing is saved and the person is offered
// "Save to Your calendar instead", which saves once however often it's pressed.

import type { CalendarItemKind } from "@contracts/vocabularies";

import type { CalendarAccountModel, CalendarMirrorEventInput } from "./events";
import type { pushGoogleWebEvent } from "./google-web";
import { mapGoogleEvent } from "./mirror";
import type { QuickCreateDraft } from "./ui/event-quick-create";

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

export type NativeEventDraft = Omit<NewEventDraft, "calendarId" | "meet" | "nativeCalendarId"> & {
  calendarId?: string;
};

export type NewEventPorts = {
  accounts: readonly CalendarAccountModel[];
  createNative: (draft: NativeEventDraft) => Promise<unknown>;
  pushGoogle: typeof pushGoogleWebEvent;
  mirror: (accountId: string, event: CalendarMirrorEventInput) => Promise<unknown>;
  onRefused: (refusal: { reason: string; saveToYourCalendar: () => Promise<void> }) => void;
  timeZone?: string;
};

/**
 * NewEventPorts as createNewEvent takes them: the callbacks are loose here so a
 * test can hand in spies and read their calls back; they are read as the ports.
 */
export type NewEventDeps = Pick<NewEventPorts, "accounts" | "timeZone"> &
  Record<"createNative" | "pushGoogle" | "mirror" | "onRefused", any>;

export type NewEventOutcome =
  | { saved: "moduo" }
  | { saved: "google"; accountId: string; externalEventId: string }
  | { saved: "refused" };

function nativeOf(draft: NewEventDraft): NativeEventDraft {
  const { nativeCalendarId, meet: _meet, calendarId: _account, ...rest } = draft;
  return { ...rest, calendarId: nativeCalendarId };
}

export async function createNewEvent(
  draft: NewEventDraft,
  ports: NewEventDeps,
): Promise<NewEventOutcome> {
  const deps: NewEventPorts = ports;
  const target = deps.accounts.find((a) => a.id === draft.calendarId && a.provider === "google");
  if (!target) {
    await deps.createNative(nativeOf(draft));
    return { saved: "moduo" };
  }
  let mapped: CalendarMirrorEventInput | null;
  try {
    mapped = mapGoogleEvent(
      await deps.pushGoogle({
        externalAccountId: target.externalId,
        title: draft.title,
        startsAt: draft.startsAt,
        endsAt: draft.endsAt,
        allDay: draft.allDay,
        rrule: draft.rrule,
        timeZone: deps.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        description: draft.description || undefined,
        location: draft.location,
        attendees: draft.attendees?.length ? draft.attendees : undefined,
        meet: draft.meet,
      }),
    );
    if (!mapped) throw new Error("Google did not return the event.");
  } catch (err) {
    let saving: Promise<void> | null = null;
    deps.onRefused({
      reason: err instanceof Error ? err.message : "Couldn't save the event on Google.",
      saveToYourCalendar: () => {
        saving ??= deps
          .createNative({ ...nativeOf(draft), calendarId: undefined })
          .then(() => undefined);
        return saving;
      },
    });
    return { saved: "refused" };
  }
  try {
    await deps.mirror(target.id, mapped);
  } catch {
    // Google has the event; the next sync brings the row. Never a native copy.
  }
  return { saved: "google", accountId: target.id, externalEventId: mapped.externalEventId };
}
