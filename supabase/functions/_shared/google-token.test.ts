import { describe, expect, it } from "@rstest/core";

import { type GoogleTokenDb, googleAccessForRow, googleClients } from "./google-token.ts";
import { decryptToken, encryptToken } from "./token-cipher.ts";

const SECRET = "test-encryption-secret";
const USER = "00000000-0000-0000-0000-0000000000aa";
const NOW = Date.parse("2026-10-20T12:00:00Z");
const CLIENTS = [{ id: "client-a", secret: "secret-a" }];

type Write = { table: string; values: Record<string, unknown>; filters: [string, string][] };

function fakeDb() {
  const writes: Write[] = [];
  const db: GoogleTokenDb = {
    from(table) {
      return {
        update(values) {
          const write: Write = { table, values, filters: [] };
          writes.push(write);
          const builder = {
            eq(column: string, value: string) {
              write.filters.push([column, value]);
              return Object.assign(Promise.resolve({ data: null, error: null }), builder);
            },
          };
          return builder;
        },
      };
    },
  };
  return { db, writes };
}

async function row(id: string, refresh: string, access: string | null, expiry: string | null) {
  return {
    id,
    refresh_token_enc: await encryptToken(refresh, SECRET, USER),
    access_token_enc: access ? await encryptToken(access, SECRET, USER) : null,
    token_expiry: expiry,
  };
}

describe("googleAccessForRow", () => {
  it("returns a stored access token that is still valid, without refreshing or writing", async () => {
    const { db, writes } = fakeDb();
    const valid = await row("row-1", "refresh-1", "access-1", new Date(NOW + 3_600_000).toISOString());
    const access = await googleAccessForRow(
      {
        db,
        encSecret: SECRET,
        clients: CLIENTS,
        now: () => NOW,
        refresh: async () => {
          throw new Error("should not refresh");
        },
      },
      USER,
      valid,
    );
    expect(access).toBe("access-1");
    expect(writes).toHaveLength(0);
  });

  it("saves a refreshed token to that row only, by its id, leaving the host's other Google accounts alone", async () => {
    const { db, writes } = fakeDb();
    // The host has two Google accounts connected; the second one's token expired.
    const expired = await row("row-work", "refresh-work", "old-access", new Date(NOW - 1000).toISOString());
    const access = await googleAccessForRow(
      {
        db,
        encSecret: SECRET,
        clients: CLIENTS,
        now: () => NOW,
        refresh: async ({ refreshToken }) => ({
          accessToken: `fresh-for-${refreshToken}`,
          expiresAt: new Date(NOW + 3_600_000).toISOString(),
          refreshToken,
        }),
      },
      USER,
      expired,
    );
    expect(access).toBe("fresh-for-refresh-work");
    expect(writes).toHaveLength(1);
    expect(writes[0].table).toBe("user_integrations");
    // The whole filter is the row id: never user_id + provider, which matches every account.
    expect(writes[0].filters).toEqual([["id", "row-work"]]);
    expect(await decryptToken(String(writes[0].values.access_token_enc), SECRET, USER)).toBe("fresh-for-refresh-work");
    // An unchanged refresh token keeps its stored ciphertext.
    expect(writes[0].values.refresh_token_enc).toBe(expired.refresh_token_enc);
  });

  it("re-encrypts a rotated refresh token and tries the next client when one refuses", async () => {
    const { db, writes } = fakeDb();
    const expired = await row("row-2", "refresh-old", null, null);
    const tried: string[] = [];
    const access = await googleAccessForRow(
      {
        db,
        encSecret: SECRET,
        clients: [{ id: "desktop", secret: "s1" }, { id: "web", secret: "s2" }],
        now: () => NOW,
        refresh: async ({ clientId }) => {
          tried.push(clientId);
          if (clientId === "desktop") throw new Error("unauthorized_client");
          return { accessToken: "fresh", expiresAt: new Date(NOW + 3_600_000).toISOString(), refreshToken: "refresh-new" };
        },
      },
      USER,
      expired,
    );
    expect(access).toBe("fresh");
    expect(tried).toEqual(["desktop", "web"]);
    expect(writes[0].filters).toEqual([["id", "row-2"]]);
    expect(await decryptToken(String(writes[0].values.refresh_token_enc), SECRET, USER)).toBe("refresh-new");
  });

  it("returns null and writes nothing when no client can refresh", async () => {
    const { db, writes } = fakeDb();
    const expired = await row("row-3", "refresh-3", null, null);
    const access = await googleAccessForRow(
      {
        db,
        encSecret: SECRET,
        clients: CLIENTS,
        now: () => NOW,
        refresh: async () => {
          throw new Error("invalid_grant");
        },
      },
      USER,
      expired,
    );
    expect(access).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it("returns null without a refresh token, an encryption secret or a client", async () => {
    const { db } = fakeDb();
    const r = await row("row-4", "refresh-4", null, null);
    expect(await googleAccessForRow({ db, encSecret: SECRET, clients: CLIENTS }, USER, { ...r, refresh_token_enc: null })).toBeNull();
    expect(await googleAccessForRow({ db, encSecret: "", clients: CLIENTS }, USER, r)).toBeNull();
    expect(await googleAccessForRow({ db, encSecret: SECRET, clients: [] }, USER, r)).toBeNull();
  });
});

describe("googleClients", () => {
  it("keeps only clients with both an id and a secret, desktop first", () => {
    const env: Record<string, string> = {
      GOOGLE_CALENDAR_CLIENT_ID: "desktop",
      GOOGLE_CALENDAR_CLIENT_SECRET: "s1",
      GOOGLE_CALENDAR_WEB_CLIENT_ID: "web",
    };
    expect(googleClients((name) => env[name])).toEqual([{ id: "desktop", secret: "s1" }]);
  });
});
