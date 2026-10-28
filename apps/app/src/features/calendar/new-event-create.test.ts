// CALR-20b contract: one event, never two (specs/calendar-rethink.md, Assumptions
// "New events go to"). A new event on a Google calendar is created on Google
// first and the only row Moduo keeps is the mirror of Google's reply: never a
// native row as well. If Google refuses, nothing is saved anywhere and the
// person is offered "Save to Your calendar instead".

import { describe, expect, it, rs } from "@rstest/core";

import type { CalendarAccountModel } from "./events";
import { createNewEvent, type NewEventDeps, type NewEventDraft } from "./new-event-create";

const WORK: CalendarAccountModel = {
  id: "acc-work",
  workspaceId: "w1",
  ownerId: "u1",
  provider: "google",
  externalId: "google:robin@gmail.com:robin@gmail.com",
  displayLabel: "Work",
  isDefaultTarget: false,
  color: null,
  lastSyncAt: null,
  status: "ok",
  syncToken: null,
  deletedAt: null,
  readOnly: false,
  busyDefault: true,
  lastError: null,
};

const GOOGLE_REPLY = {
  id: "g1",
  iCalUID: "g1@google.com",
  summary: "Board",
  start: { dateTime: "2026-11-05T10:00:00Z" },
  end: { dateTime: "2026-11-05T11:00:00Z" },
};

function draft(over: Partial<NewEventDraft> = {}): NewEventDraft {
  return {
    title: "Board",
    startsAt: "2026-11-05T10:00:00.000Z",
    endsAt: "2026-11-05T11:00:00.000Z",
    allDay: false,
    rrule: null,
    calendarId: "moduo",
    ...over,
  };
}

function deps(over: Partial<Record<keyof NewEventDeps, unknown>> = {}) {
  const d = {
    accounts: [WORK],
    createNative: rs.fn(async (_draft: unknown) => undefined),
    pushGoogle: rs.fn(async (_input: unknown) => GOOGLE_REPLY as Record<string, unknown>),
    mirror: rs.fn(async (_accountId: string, _event: unknown) => undefined),
    onRefused: rs.fn((_refusal: unknown) => undefined),
    timeZone: "Europe/Warsaw",
  };
  return { ...d, ...over } as typeof d;
}

describe("a new event on Your calendar", () => {
  it("is one native event, and nothing goes to Google", async () => {
    const d = deps();
    const out = await createNewEvent(draft({ nativeCalendarId: "cal-team" }), d);
    expect(out.saved).toBe("moduo");
    expect(d.createNative).toHaveBeenCalledTimes(1);
    const sent = d.createNative.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.title).toBe("Board");
    expect(sent.calendarId).toBe("cal-team");
    expect("meet" in sent).toBe(false);
    expect(d.pushGoogle).not.toHaveBeenCalled();
    expect(d.mirror).not.toHaveBeenCalled();
  });
});

describe("a new event on a Google calendar", () => {
  it("is created on Google first, and the only row kept is the mirror of Google's reply", async () => {
    const d = deps();
    const out = await createNewEvent(draft({ calendarId: "acc-work", meet: "add" }), d);
    expect(out).toEqual({ saved: "google", accountId: "acc-work", externalEventId: "g1" });
    expect(d.pushGoogle).toHaveBeenCalledTimes(1);
    const pushed = d.pushGoogle.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(pushed.externalAccountId).toBe(WORK.externalId);
    expect(pushed.meet).toBe("add");
    expect(pushed.timeZone).toBe("Europe/Warsaw");
    expect(d.mirror).toHaveBeenCalledTimes(1);
    const [accountId, event] = d.mirror.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(accountId).toBe("acc-work");
    expect(event.externalEventId).toBe("g1");
    expect(event.iCalUID).toBe("g1@google.com");
    // Never a native row as well: that is the copy a later sync would double.
    expect(d.createNative).not.toHaveBeenCalled();
    expect(d.onRefused).not.toHaveBeenCalled();
  });

  it("pushes Google before anything is stored", async () => {
    const order: string[] = [];
    const d = deps({
      pushGoogle: rs.fn(async () => {
        order.push("google");
        return GOOGLE_REPLY as Record<string, unknown>;
      }),
      mirror: rs.fn(async () => {
        order.push("mirror");
      }),
    });
    await createNewEvent(draft({ calendarId: "acc-work" }), d);
    expect(order).toEqual(["google", "mirror"]);
  });

  it("keeps no native copy when storing Google's reply fails (the next sync brings it)", async () => {
    const d = deps({ mirror: rs.fn(async () => Promise.reject(new Error("offline"))) });
    const out = await createNewEvent(draft({ calendarId: "acc-work" }), d);
    expect(out.saved).toBe("google");
    expect(d.createNative).not.toHaveBeenCalled();
    expect(d.onRefused).not.toHaveBeenCalled();
  });
});

describe("Google refuses or is offline", () => {
  it("saves nothing anywhere and says why, with Save to Your calendar instead", async () => {
    const d = deps({
      pushGoogle: rs.fn(async () => Promise.reject(new Error("Google said: forbidden"))),
    });
    const out = await createNewEvent(draft({ calendarId: "acc-work" }), d);
    expect(out.saved).toBe("refused");
    expect(d.mirror).not.toHaveBeenCalled();
    expect(d.createNative).not.toHaveBeenCalled();
    expect(d.onRefused).toHaveBeenCalledTimes(1);
    const refusal = d.onRefused.mock.calls[0]?.[0] as {
      reason: string;
      saveToYourCalendar: () => Promise<void>;
    };
    expect(refusal.reason).toMatch(/forbidden/);

    await refusal.saveToYourCalendar();
    expect(d.createNative).toHaveBeenCalledTimes(1);
    const sent = d.createNative.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.title).toBe("Board");
    expect(sent.calendarId).toBeUndefined();
    expect(d.pushGoogle).toHaveBeenCalledTimes(1);
    expect(d.mirror).not.toHaveBeenCalled();
  });

  it("Save to Your calendar instead saves once, however often it's pressed", async () => {
    const d = deps({ pushGoogle: rs.fn(async () => Promise.reject(new Error("offline"))) });
    await createNewEvent(draft({ calendarId: "acc-work" }), d);
    const refusal = d.onRefused.mock.calls[0]?.[0] as { saveToYourCalendar: () => Promise<void> };
    await Promise.all([refusal.saveToYourCalendar(), refusal.saveToYourCalendar()]);
    expect(d.createNative).toHaveBeenCalledTimes(1);
  });

  it("a reply Google sends without an event is a refusal, not a native save", async () => {
    const d = deps({ pushGoogle: rs.fn(async () => ({}) as Record<string, unknown>) });
    const out = await createNewEvent(draft({ calendarId: "acc-work" }), d);
    expect(out.saved).toBe("refused");
    expect(d.mirror).not.toHaveBeenCalled();
    expect(d.createNative).not.toHaveBeenCalled();
  });
});
