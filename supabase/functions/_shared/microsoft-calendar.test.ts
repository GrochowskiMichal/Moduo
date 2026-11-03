// Outlook on the web reads Graph with a refresh token stored per Microsoft
// login. A token near expiry is refreshed and saved back to its own row;
// Microsoft's rotated refresh token replaces the old one; invalid_grant means
// reconnect; every calendarView page is read.

import { afterEach, describe, expect, it, rs } from "@rstest/core";

import {
  listMicrosoftEvents,
  microsoftAccessOutcome,
  type MicrosoftTokenDb,
  microsoftUserEmail,
  outlookAccountEmail,
  refreshMicrosoftAccess,
} from "./microsoft-calendar.ts";
import { decryptToken, encryptToken } from "./token-cipher.ts";

const SECRET = "test-encryption-secret";
const USER = "00000000-0000-0000-0000-0000000000aa";
const NOW = Date.parse("2026-11-03T12:00:00Z");
const CLIENT = { id: "web-client", secret: "web-secret" };

afterEach(() => {
  rs.restoreAllMocks();
});

function recordingDb() {
  const writes: { values: Record<string, unknown>; id: string }[] = [];
  const db: MicrosoftTokenDb = {
    from() {
      return {
        update(values) {
          return {
            eq: (_column, id) => {
              writes.push({ values, id });
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };
  return { db, writes };
}

async function row(expiry: string) {
  return {
    id: "row-1",
    refresh_token_enc: await encryptToken("refresh-old", SECRET, USER),
    access_token_enc: await encryptToken("access-old", SECRET, USER),
    token_expiry: expiry,
  };
}

describe("microsoftAccessOutcome", () => {
  it("uses the stored access token while it has time left, without refreshing", async () => {
    const refresh = rs.fn();
    const { db, writes } = recordingDb();
    const outcome = await microsoftAccessOutcome(
      { db, encSecret: SECRET, client: CLIENT, refresh, now: () => NOW },
      USER,
      await row("2026-11-03T13:00:00Z"),
    );
    expect(outcome).toEqual({ kind: "ok", accessToken: "access-old" });
    expect(refresh).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it("refreshes an expiring token and saves the rotated refresh token to that row", async () => {
    const refresh = rs.fn(async () => ({
      accessToken: "access-new",
      refreshToken: "refresh-new",
      expiresAt: "2026-11-03T13:00:00Z",
    }));
    const { db, writes } = recordingDb();
    const outcome = await microsoftAccessOutcome(
      { db, encSecret: SECRET, client: CLIENT, refresh, now: () => NOW },
      USER,
      await row("2026-11-03T12:00:30Z"),
    );
    expect(outcome).toEqual({ kind: "ok", accessToken: "access-new" });
    expect(refresh).toHaveBeenCalledWith({ client: CLIENT, refreshToken: "refresh-old" });
    expect(writes).toHaveLength(1);
    expect(writes[0].id).toBe("row-1");
    expect(await decryptToken(writes[0].values.refresh_token_enc as string, SECRET, USER)).toBe("refresh-new");
    expect(await decryptToken(writes[0].values.access_token_enc as string, SECRET, USER)).toBe("access-new");
  });

  it("reads invalid_grant as revoked and any other failure as unavailable", async () => {
    rs.spyOn(console, "error").mockImplementation(() => {});
    const { db } = recordingDb();
    const expired = await row("2026-11-01T00:00:00Z");
    const revoked = await microsoftAccessOutcome(
      { db, encSecret: SECRET, client: CLIENT, refresh: async () => Promise.reject(new Error("invalid_grant")) },
      USER,
      expired,
    );
    expect(revoked).toEqual({ kind: "revoked" });
    const down = await microsoftAccessOutcome(
      { db, encSecret: SECRET, client: CLIENT, refresh: async () => Promise.reject(new Error("fetch failed")) },
      USER,
      expired,
    );
    expect(down).toEqual({ kind: "unavailable" });
  });

  it("is unavailable without a client or a stored refresh token", async () => {
    const { db } = recordingDb();
    const stored = await row("2026-11-01T00:00:00Z");
    expect(
      await microsoftAccessOutcome({ db, encSecret: SECRET, client: { id: "", secret: "" } }, USER, stored),
    ).toEqual({ kind: "unavailable" });
    expect(
      await microsoftAccessOutcome({ db, encSecret: SECRET, client: CLIENT }, USER, {
        ...stored,
        refresh_token_enc: null,
      }),
    ).toEqual({ kind: "unavailable" });
  });
});

describe("refreshMicrosoftAccess", () => {
  it("throws Microsoft's error code, so invalid_grant can be told apart", async () => {
    rs.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    );
    await expect(refreshMicrosoftAccess({ client: CLIENT, refreshToken: "r" })).rejects.toThrow("invalid_grant");
  });
});

describe("Graph reads", () => {
  it("reads every calendarView page and asks for UTC times", async () => {
    const fetchSpy = rs.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const body = url.includes("skiptoken")
        ? { value: [{ id: "b" }] }
        : { value: [{ id: "a" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/next?$skiptoken=x" };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const events = await listMicrosoftEvents({
      accessToken: "t",
      calendarId: "AAMk/x=",
      timeMin: "2026-10-01T00:00:00Z",
      timeMax: "2027-03-01T00:00:00Z",
    });
    expect(events.map((e) => e.id)).toEqual(["a", "b"]);
    const [firstUrl, firstInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(firstUrl).toContain("/me/calendars/AAMk%2Fx%3D/calendarView");
    expect(new URL(firstUrl).searchParams.get("startDateTime")).toBe("2026-10-01T00:00:00Z");
    expect((firstInit.headers as Record<string, string>).prefer).toBe('outlook.timezone="UTC"');
    expect(new URL(firstUrl).searchParams.get("$select")).toContain("onlineMeeting");
  });

  it("never follows a next page off Graph with the token", async () => {
    const fetchSpy = rs.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ value: [{ id: "a" }], "@odata.nextLink": "https://evil.example/next" }),
        { status: 200 },
      ),
    );
    const events = await listMicrosoftEvents({ accessToken: "t", calendarId: "c", timeMin: "a", timeMax: "b" });
    expect(events.map((e) => e.id)).toEqual(["a"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("fails the read on a refused page instead of returning part of it", async () => {
    rs.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 503 }));
    await expect(
      listMicrosoftEvents({ accessToken: "t", calendarId: "c", timeMin: "a", timeMax: "b" }),
    ).rejects.toThrow("microsoft_events_failed:503");
  });

  it("names a login by mail, else its principal name, lowercased", async () => {
    rs.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ mail: null, userPrincipalName: "Ana@Outlook.com" }), { status: 200 }),
    );
    expect(await microsoftUserEmail("t")).toBe("ana@outlook.com");
  });
});

describe("outlookAccountEmail", () => {
  it("takes the app's outlook:<email> account id only", () => {
    expect(outlookAccountEmail("outlook:Ana@Example.com")).toBe("ana@example.com");
    expect(outlookAccountEmail("outlook:ana@example.com:AAMk")).toBeNull();
    expect(outlookAccountEmail("google:ana@example.com")).toBeNull();
    expect(outlookAccountEmail(42)).toBeNull();
  });
});
