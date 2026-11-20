// A revoked token asks to reconnect (CALR-20, specs/calendar-rethink.md AC37):
// Google answering a refresh with invalid_grant is "revoked", not "unavailable";
// calendar-google-web then marks that login's calendars reauth through
// calendar_op__google_reauth (their events stay) and answers 409
// { error: "google_reauth" }. A good token for the same login clears it.
// The status action also says, per calendar, whether Google lets you write it.

import { afterEach, describe, expect, it, rs } from "@rstest/core";

import { listGoogleCalendars } from "../_shared/google-calendar.ts";
import { type GoogleTokenDb, googleAccessOutcome } from "../_shared/google-token.ts";
import { encryptToken } from "../_shared/token-cipher.ts";
import { recordGoogleAccess, statusCalendars } from "./accounts.ts";

const SECRET = "test-encryption-secret";
const USER = "00000000-0000-0000-0000-0000000000aa";
const NOW = Date.parse("2026-10-28T12:00:00Z");
const CLIENTS = [
  { id: "desktop", secret: "s1" },
  { id: "web", secret: "s2" },
];

afterEach(() => {
  rs.restoreAllMocks();
});

function quietDb(): GoogleTokenDb {
  return {
    from() {
      return {
        update() {
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
      };
    },
  };
}

async function expiredRow() {
  return {
    id: "row-1",
    refresh_token_enc: await encryptToken("refresh-1", SECRET, USER),
    access_token_enc: null,
    token_expiry: null,
  };
}

function refusing(answers: Record<string, string>) {
  return async ({ clientId }: { clientId: string }) => {
    throw new Error(answers[clientId] ?? "google_refresh_failed");
  };
}

describe("a revoked token asks to reconnect", () => {
  it("invalid_grant from Google is a revoked token, even when the other client refuses for another reason", async () => {
    const outcome = await googleAccessOutcome(
      {
        db: quietDb(),
        encSecret: SECRET,
        clients: CLIENTS,
        now: () => NOW,
        refresh: refusing({ desktop: "unauthorized_client", web: "invalid_grant" }),
      },
      USER,
      await expiredRow(),
    );
    expect(outcome).toEqual({ kind: "revoked", reason: "invalid_grant" });
  });

  it("a refresh that fails for any other reason is unavailable, not revoked", async () => {
    const outcome = await googleAccessOutcome(
      {
        db: quietDb(),
        encSecret: SECRET,
        clients: CLIENTS,
        now: () => NOW,
        refresh: refusing({ desktop: "unauthorized_client", web: "google_refresh_failed" }),
      },
      USER,
      await expiredRow(),
    );
    expect(outcome).toEqual({ kind: "unavailable" });
  });

  it("no stored refresh token is unavailable", async () => {
    const outcome = await googleAccessOutcome(
      { db: quietDb(), encSecret: SECRET, clients: CLIENTS, now: () => NOW },
      USER,
      { id: "row-1", refresh_token_enc: null, access_token_enc: null, token_expiry: null },
    );
    expect(outcome).toEqual({ kind: "unavailable" });
  });

  it("a working token is ok", async () => {
    const outcome = await googleAccessOutcome(
      {
        db: quietDb(),
        encSecret: SECRET,
        clients: CLIENTS,
        now: () => NOW,
        refresh: async () => ({
          accessToken: "fresh",
          expiresAt: new Date(NOW + 3_600_000).toISOString(),
          refreshToken: "refresh-1",
        }),
      },
      USER,
      await expiredRow(),
    );
    expect(outcome).toEqual({ kind: "ok", accessToken: "fresh" });
  });

  it("a revoked login is marked reauth with the reason; its rows are left to the op, which keeps them", async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const db = {
      rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        return Promise.resolve({ data: 2, error: null });
      },
    };
    await recordGoogleAccess(db, USER, "Robin.Hale@Gmail.com", {
      kind: "revoked",
      reason: "invalid_grant",
    });
    expect(calls).toEqual([
      {
        fn: "calendar_op__google_reauth",
        args: {
          p_owner_id: USER,
          p_email: "robin.hale@gmail.com",
          p_reauth: true,
          p_error: "invalid_grant",
        },
      },
    ]);
  });

  it("reconnecting clears it: a working token for the login clears reauth", async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const db = {
      rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        return Promise.resolve({ data: 0, error: null });
      },
    };
    await recordGoogleAccess(db, USER, "robin.hale@gmail.com", { kind: "ok", accessToken: "a" });
    expect(calls).toEqual([
      {
        fn: "calendar_op__google_reauth",
        args: { p_owner_id: USER, p_email: "robin.hale@gmail.com", p_reauth: false, p_error: null },
      },
    ]);
  });

  it("an unavailable token changes nothing, and a failed write never throws", async () => {
    const calls: string[] = [];
    await recordGoogleAccess(
      {
        rpc(fn: string) {
          calls.push(fn);
          return Promise.resolve({ data: null, error: null });
        },
      },
      USER,
      "robin.hale@gmail.com",
      { kind: "unavailable" },
    );
    expect(calls).toEqual([]);
    await expect(
      recordGoogleAccess(
        { rpc: () => Promise.reject(new Error("db down")) },
        USER,
        "robin.hale@gmail.com",
        { kind: "revoked", reason: "invalid_grant" },
      ),
    ).resolves.toBeUndefined();
  });
});

describe("the status action's calendars carry Google's access role", () => {
  it("lists accessRole from Google's calendar list", async () => {
    rs.spyOn(globalThis, "fetch").mockImplementation((async () =>
      new Response(
        JSON.stringify({
          items: [
            { id: "robin.hale@gmail.com", summary: "Robin", primary: true, accessRole: "owner" },
            { id: "family", summary: "Family", accessRole: "writer" },
            { id: "holidays", summary: "Holidays", accessRole: "reader" },
            { id: "kai", summary: "Kai", accessRole: "freeBusyReader" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch);
    const listed = await listGoogleCalendars("token");
    expect(listed.map((c) => [c.id, c.accessRole])).toEqual([
      ["robin.hale@gmail.com", "owner"],
      ["family", "writer"],
      ["holidays", "reader"],
      ["kai", "freeBusyReader"],
    ]);
  });

  it("readers and free/busy readers are read-only; the primary comes first", () => {
    const rows = statusCalendars("robin.hale@gmail.com", [
      { id: "holidays", summary: "Holidays", primary: false, accessRole: "reader" },
      { id: "family", summary: "Family", primary: false, accessRole: "writer" },
      { id: "kai", summary: "Kai", primary: false, accessRole: "freeBusyReader" },
      { id: "robin.hale@gmail.com", summary: "Robin", primary: true, accessRole: "owner" },
    ]);
    expect(rows).toEqual([
      {
        email: "robin.hale@gmail.com",
        accountId: "google:robin.hale@gmail.com:robin.hale@gmail.com",
        summary: "Robin",
        googleCalendarId: "robin.hale@gmail.com",
        primary: true,
        readOnly: false,
      },
      {
        email: "robin.hale@gmail.com",
        accountId: "google:robin.hale@gmail.com:holidays",
        summary: "Holidays",
        googleCalendarId: "holidays",
        primary: false,
        readOnly: true,
      },
      {
        email: "robin.hale@gmail.com",
        accountId: "google:robin.hale@gmail.com:family",
        summary: "Family",
        googleCalendarId: "family",
        primary: false,
        readOnly: false,
      },
      {
        email: "robin.hale@gmail.com",
        accountId: "google:robin.hale@gmail.com:kai",
        summary: "Kai",
        googleCalendarId: "kai",
        primary: false,
        readOnly: true,
      },
    ]);
  });

  it("an empty list falls back to the primary calendar, writable", () => {
    expect(statusCalendars("robin.hale@gmail.com", [])).toEqual([
      {
        email: "robin.hale@gmail.com",
        accountId: "google:robin.hale@gmail.com:primary",
        summary: "robin.hale@gmail.com",
        googleCalendarId: "primary",
        primary: true,
        readOnly: false,
      },
    ]);
  });
});
