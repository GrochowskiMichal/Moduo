// HV-15 variant of benchmarks/escapes/644-1-error-read-as-empty: `fetchGoogleWebEvents`
// reads an answer without an `events` list (a captive portal's 200 HTML page, which
// functions-js hands back as text) as "no events", so the web sync tombstones every
// mirrored event of that Google account. Fixed in MOD-726: it throws `google_no_events`,
// as Outlook throws `outlook_no_events`. Kept as the regression test.
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { CalendarAccountModel, CalendarEventModel } from "../events";

const h = rs.hoisted(() => ({
  /** What `functions.invoke("calendar-google-web")` answers. */
  answer: { data: null as unknown, error: null as unknown },
}));

rs.mock("../../../lib/runtime.web.client", () => ({
  supabaseClient: {
    functions: { invoke: async () => h.answer },
  },
}));

import { fetchGoogleWebEvents } from "../google-web";
import { useCalendarSync } from "./use-calendar-sync";

const account: CalendarAccountModel = {
  id: "work",
  workspaceId: "w1",
  ownerId: "u1",
  provider: "google",
  externalId: "google:robin.hale@gmail.com:work",
  displayLabel: "Work",
  isDefaultTarget: false,
  color: null,
  lastSyncAt: "2026-11-24T09:00:00.000Z",
  status: "ok",
  syncToken: null,
  deletedAt: null,
};

/** A meeting the mirror already holds for this Google account. */
const mirrored = {
  id: "ev-1",
  sourceAccountId: "work",
  externalEventId: "google-event-1",
} as unknown as CalendarEventModel;

function webRuntime() {
  const mirrorEvents = rs.fn(async (_input: { deletedExternalIds: string[] }) => ({
    upserted: 0,
    removed: 0,
  }));
  const upsertAccount = rs.fn(async () => ({}));
  const runtime = {
    calendar: {
      // What the web runtime does for Google (runtime.web.calendar.ts fetchExternalEvents).
      fetchExternalEvents: ({
        externalAccountId,
        timeMin,
        timeMax,
      }: {
        externalAccountId: string;
        timeMin: string;
        timeMax: string;
      }) => fetchGoogleWebEvents({ externalAccountId, timeMin, timeMax }),
      mirrorEvents,
      upsertAccount,
    },
  } as unknown as ModuoRuntime;
  return { runtime, mirrorEvents };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  rs.useFakeTimers();
  rs.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  rs.useRealTimers();
  rs.restoreAllMocks();
});

describe("HV-15 variant 644-1: an unreadable Google answer tombstones the account's events", () => {
  it("never deletes mirrored Google events when the events answer isn't an events list", async () => {
    // A captive portal (hotel Wi-Fi) answers 200 with an HTML page; functions-js
    // returns a non-JSON body as text, with no error.
    h.answer = { data: "<!doctype html><title>Sign in to Wi-Fi</title>", error: null };
    const { runtime, mirrorEvents } = webRuntime();
    renderHook(() =>
      useCalendarSync({
        runtime,
        workspaceId: "w1",
        accounts: [account],
        events: [mirrored],
        enabled: true,
        onSynced: () => {},
      }),
    );
    await flush();
    const deleted = mirrorEvents.mock.calls.flatMap(([input]) => input.deletedExternalIds);
    expect(deleted).toEqual([]);
  });
});
