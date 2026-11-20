// One new event, never two (specs/calendar-rethink.md, Assumptions "New events
// go to"). On Your calendar it is one native event. On a Google calendar it is
// created on Google first and the only row kept is the mirror of Google's reply:
// never a native row as well, also not when storing the reply fails (the next
// sync brings it). The app names the Google event's id, so a create whose
// answer was lost can be found again: if Google refuses or can't be reached,
// nothing is saved and the person is offered "Save to Your calendar instead",
// which first asks Google for that id and stores Google's event when it has
// one, else saves on Your calendar, once however often it's pressed.

import type { CalendarItemKind } from "@contracts/vocabularies";

import type { CalendarAccountModel, CalendarMirrorEventInput } from "./events";
import type { pushGoogleWebEvent } from "./google-web";
import { mapGoogleEvent } from "./mirror";

/** A new event's basics. */
export type QuickCreateDraft = {
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  rrule: string | null;
  /** "moduo" or a connected account id. */
  calendarId: string;
};

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
  onRefused: (refusal: {
    reason: string;
    saveToYourCalendar: () => Promise<NewEventOutcome>;
  }) => void;
  /**
   * The event Google has under the id this app made, or null; throws when it
   * can't tell. Without it, Save to Your calendar saves without asking.
   */
  findOnGoogle?: (
    externalAccountId: string,
    eventId: string,
  ) => Promise<Record<string, unknown> | null>;
  /** A new Google event id (base32hex); a dashless uuid by default. */
  newGoogleId?: () => string;
  timeZone?: string;
};

/** What createNewEvent works with: the accounts, and the calls it makes. */
export type NewEventDeps = NewEventPorts;

export type NewEventOutcome =
  | { saved: "moduo" }
  | { saved: "google"; accountId: string; externalEventId: string }
  | { saved: "refused" };

/** Google takes a-v and 0-9 for an id it is given; a uuid's hex digits are both. */
export function newGoogleEventId(): string {
  return crypto.randomUUID().replace(/-/g, "").toLowerCase();
}

function nativeOf(draft: NewEventDraft): NativeEventDraft {
  const { nativeCalendarId, meet: _meet, calendarId: _account, ...rest } = draft;
  return { ...rest, calendarId: nativeCalendarId };
}

/** Stores Google's event; a failed write is the next sync's to catch up. */
async function keepGoogles(
  deps: NewEventDeps,
  target: CalendarAccountModel,
  mapped: CalendarMirrorEventInput,
): Promise<NewEventOutcome> {
  try {
    await deps.mirror(target.id, mapped);
  } catch {
    // Google has the event; the next sync brings the row. Never a native copy.
  }
  return { saved: "google", accountId: target.id, externalEventId: mapped.externalEventId };
}

/**
 * Save to Your calendar instead: only once Google says it has no event under
 * this id. If it has one, that event is kept; if Google can't be asked, this
 * throws and nothing is saved (a retry asks again).
 */
async function saveInstead(
  draft: NewEventDraft,
  deps: NewEventDeps,
  target: CalendarAccountModel,
  googleId: string,
): Promise<NewEventOutcome> {
  if (deps.findOnGoogle) {
    const found = await deps.findOnGoogle(target.externalId, googleId);
    if (found) {
      const mapped = mapGoogleEvent(found);
      if (mapped) return keepGoogles(deps, target, mapped);
      return { saved: "google", accountId: target.id, externalEventId: googleId };
    }
  }
  await deps.createNative({ ...nativeOf(draft), calendarId: undefined });
  return { saved: "moduo" };
}

export async function createNewEvent(
  draft: NewEventDraft,
  deps: NewEventDeps,
): Promise<NewEventOutcome> {
  const target = deps.accounts.find((a) => a.id === draft.calendarId && a.provider === "google");
  if (!target) {
    await deps.createNative(nativeOf(draft));
    return { saved: "moduo" };
  }
  const googleId = (deps.newGoogleId ?? newGoogleEventId)();
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
        eventId: googleId,
      }),
    );
    if (!mapped) throw new Error("Google did not return the event.");
  } catch (err) {
    // One save at a time and at most one that lands; a failed check can be retried.
    let saving: Promise<NewEventOutcome> | null = null;
    deps.onRefused({
      reason: err instanceof Error ? err.message : "Couldn't save the event on Google.",
      saveToYourCalendar: () => {
        saving ??= saveInstead(draft, deps, target, googleId).catch((checkErr: unknown) => {
          saving = null;
          throw checkErr;
        });
        return saving;
      },
    });
    return { saved: "refused" };
  }
  return keepGoogles(deps, target, mapped);
}
