// HV-15 variant of benchmarks/escapes/509-1-error-read-as-empty: a failed read of the removed
// Google calendars (`tombstonedGoogleIds`) reads as "none removed", so opening Calendar
// re-adds a calendar the person removed. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/calendar/google-web.509-1.variant.test.ts
import { beforeEach, describe, expect, it, rs } from "@rstest/core";

import type { ModuoRuntime } from "@/lib/runtime.types";

const h = rs.hoisted(() => ({
  /** What a read of `calendar_accounts` answers. */
  tombstones: { data: null as unknown, error: null as unknown },
}));

rs.mock("../../lib/runtime.web.client", () => {
  const chain = (): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown) =>
              Promise.resolve(h.tombstones).then(resolve);
          }
          return () => chain();
        },
      },
    );
  return {
    supabaseClient: {
      from: () => chain(),
      functions: {
        invoke: async () => ({
          data: {
            calendars: [
              {
                email: "me@example.com",
                accountId: "google:me@example.com:work",
                summary: "Work",
                googleCalendarId: "work@group.calendar.google.com",
              },
            ],
          },
          error: null,
        }),
      },
    },
  };
});

rs.mock("./connect-return", () => ({
  finishConnectReturn: async () => null,
  rememberConnectStart: () => {},
}));

import { ensureGoogleCalendarAccounts } from "./google-web";

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

hunt("HV-15 variant 509-1: a failed tombstone read brings back a removed Google calendar", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("a removed calendar stays removed when the read of removed calendars fails", async () => {
    const upserts: unknown[] = [];
    const runtime = {
      calendar: {
        upsertAccount: async (input: unknown) => {
          upserts.push(input);
          return input;
        },
      },
    } as unknown as ModuoRuntime;
    // The person removed "Work" earlier: its row is tombstoned, so the page's
    // live account list doesn't have it.
    const accounts = [
      {
        provider: "google",
        externalId: "google:me@example.com:work",
        deletedAt: "2026-10-18T10:00:00.000Z",
      },
    ];

    // Control: with the read answering, the removal holds.
    h.tombstones = { data: [{ external_id: "google:me@example.com:work" }], error: null };
    await ensureGoogleCalendarAccounts({ runtime, workspaceId: "w1", accounts });
    expect(upserts).toHaveLength(0);

    // The same read fails (a 5xx / a dropped connection).
    h.tombstones = { data: null, error: { message: "TypeError: Failed to fetch" } };
    const added = await ensureGoogleCalendarAccounts({
      runtime,
      workspaceId: "w1",
      accounts,
    }).catch(() => false);
    expect(upserts).toHaveLength(0);
    expect(added).toBe(false);
  });
});
