// A failed sync retries quietly, sooner than the 15-minute tick (1, 3, 10
// minutes), so a blip heals before anyone sees it; the account keeps its last
// good sync time, which is what keeps it quiet (sync-status.ts). A sign-in the
// desktop engine reports revoked is marked reauth (reconnect), not retried.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { CalendarAccountModel } from "../events";
import { RETRY_DELAYS_MS, useCalendarSync } from "./use-calendar-sync";

const account: CalendarAccountModel = {
  id: "work",
  workspaceId: "w1",
  ownerId: "u1",
  provider: "google",
  externalId: "google:robin.hale@gmail.com:work",
  displayLabel: "Work",
  isDefaultTarget: false,
  color: null,
  lastSyncAt: "2026-11-03T09:00:00.000Z",
  status: "ok",
  syncToken: null,
  deletedAt: null,
};

function fakeRuntime(fetches: (() => Promise<Record<string, unknown>[]>)[]) {
  const fetchExternalEvents = rs.fn(() => (fetches.shift() ?? (async () => []))());
  const upsertAccount = rs.fn(async () => ({}));
  const mirrorEvents = rs.fn(async () => ({ upserted: 0, removed: 0 }));
  const runtime = {
    calendar: { fetchExternalEvents, upsertAccount, mirrorEvents },
  } as unknown as ModuoRuntime;
  return { runtime, fetchExternalEvents, upsertAccount };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
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

describe("a failed sync retries quietly", () => {
  it("tries again a minute later, keeping the last good sync time meanwhile", async () => {
    const { runtime, fetchExternalEvents, upsertAccount } = fakeRuntime([
      async () => {
        throw new Error("google_calendar_events_failed:503");
      },
      async () => [],
    ]);
    renderHook(() =>
      useCalendarSync({
        runtime,
        workspaceId: "w1",
        accounts: [account],
        events: [],
        enabled: true,
        onSynced: () => {},
      }),
    );
    await flush();
    expect(fetchExternalEvents).toHaveBeenCalledTimes(1);
    expect(upsertAccount).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error", lastSyncAt: account.lastSyncAt }),
    );

    await act(async () => {
      rs.advanceTimersByTime(RETRY_DELAYS_MS[0]);
    });
    await flush();
    expect(fetchExternalEvents).toHaveBeenCalledTimes(2);
    expect(upsertAccount).toHaveBeenLastCalledWith(expect.objectContaining({ status: "ok" }));
  });

  it("a revoked sign-in is marked for reconnecting and not retried", async () => {
    const { runtime, fetchExternalEvents, upsertAccount } = fakeRuntime([
      async () => {
        throw new Error("google_calendar_reauth:reconnect_google_account");
      },
    ]);
    renderHook(() =>
      useCalendarSync({
        runtime,
        workspaceId: "w1",
        accounts: [account],
        events: [],
        enabled: true,
        onSynced: () => {},
      }),
    );
    await flush();
    expect(upsertAccount).toHaveBeenLastCalledWith(expect.objectContaining({ status: "reauth" }));
    await act(async () => {
      rs.advanceTimersByTime(RETRY_DELAYS_MS[0]);
    });
    await flush();
    expect(fetchExternalEvents).toHaveBeenCalledTimes(1);
  });
});
