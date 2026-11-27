// MOD-554: manage-integration used to trust any user_id behind one shared
// secret (also the AES master key), and the desktop disconnect built its query
// string unencoded, so `provider=zoom&user_id=<victim>` deleted someone else's
// integration. Now the user comes only from the verified session.
// EB-1: the desktop Zoom/Meet sign-in is gone, so the function stores only a
// desktop Google Calendar token and has no disconnect path at all.

import { describe, expect, it } from "@rstest/core";

import { decryptToken } from "../_shared/token-cipher.ts";
import { handleManageIntegration, type IntegrationRow, type IntegrationsDb } from "./handler.ts";

const SECRET = "test-encryption-secret";
const ME = "00000000-0000-0000-0000-0000000000aa";
const VICTIM = "00000000-0000-0000-0000-0000000000bb";
const URL_BASE = "https://x.supabase.co/functions/v1/manage-integration";

/** A three-part token whose payload readers accept; getUser() is faked below. */
function jwt(claims: Record<string, unknown> = {}): string {
  const b64 = (v: unknown) =>
    btoa(JSON.stringify(v)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64({ sub: ME, ...claims })}.sig`;
}

type Row = IntegrationRow & { id: string };

function memoryDb(rows: Row[] = []): IntegrationsDb & { rows: Row[] } {
  const ok = <T>(data: T) => Promise.resolve({ data, error: null });
  return {
    rows,
    findId: (u, p, k) =>
      ok(rows.find((r) => r.user_id === u && r.provider === p && r.account_key === k) ?? null),
    insert(row) {
      rows.push({ ...row, id: `row-${rows.length + 1}` });
      return ok(null);
    },
    update(id, row) {
      const i = rows.findIndex((r) => r.id === id);
      rows[i] = { ...row, id };
      return ok(null);
    },
    remove(u, p) {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].user_id === u && rows[i].provider === p) rows.splice(i, 1);
      }
      return ok(null);
    },
  };
}

function deps(db: IntegrationsDb, email: string | null = "Me@Gmail.com") {
  return {
    auth: {
      getUser: (token: string) =>
        Promise.resolve(
          token.endsWith(".sig")
            ? { data: { user: { id: ME } }, error: null }
            : { data: { user: null }, error: new Error("bad jwt") },
        ),
    },
    db,
    encryptionSecret: SECRET,
    googleEmail: () => Promise.resolve(email),
    now: () => new Date("2026-11-22T10:00:00Z"),
  };
}

function post(body: unknown, auth: string | null = `Bearer ${jwt()}`): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = auth;
  return new Request(URL_BASE, { method: "POST", headers, body: JSON.stringify(body) });
}

function del(query: string, auth: string | null = `Bearer ${jwt()}`): Request {
  return new Request(`${URL_BASE}?${query}`, {
    method: "DELETE",
    headers: auth ? { Authorization: auth } : {},
  });
}

const GOOGLE = { provider: "google_calendar", access_token: "acc", refresh_token: "ref" };

function victimRow(provider = "zoom"): Row {
  return {
    id: "victim-1",
    user_id: VICTIM,
    provider,
    account_key: "",
    access_token_enc: "x",
    refresh_token_enc: null,
    token_expiry: null,
    updated_at: "2026-11-01T00:00:00Z",
  };
}

describe("manage-integration auth (MOD-554)", () => {
  it("refuses a request without a person's session, even with the old shared secret", async () => {
    const db = memoryDb();
    const old = new Request(URL_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Moduo-Secret": SECRET },
      body: JSON.stringify({ ...GOOGLE, user_id: VICTIM }),
    });
    expect((await handleManageIntegration(old, deps(db))).status).toBe(401);
    expect((await handleManageIntegration(post(GOOGLE, "Bearer nope"), deps(db))).status).toBe(401);
    expect(db.rows).toHaveLength(0);
  });

  it("refuses an app's OAuth token", async () => {
    const db = memoryDb();
    const res = await handleManageIntegration(
      post(GOOGLE, `Bearer ${jwt({ client_id: "claude" })}`),
      deps(db),
    );
    expect(res.status).toBe(403);
    expect(db.rows).toHaveLength(0);
  });

  it("a body naming another user is refused, not obeyed", async () => {
    const db = memoryDb();
    const res = await handleManageIntegration(post({ ...GOOGLE, user_id: VICTIM }), deps(db));
    expect(res.status).toBe(400);
    expect(db.rows).toHaveLength(0);
  });
});

describe("manage-integration providers (EB-1)", () => {
  it("refuses zoom and google_meet", async () => {
    const db = memoryDb();
    for (const provider of ["zoom", "google_meet"]) {
      const res = await handleManageIntegration(post({ provider, access_token: "a" }), deps(db));
      expect(res.status).toBe(400);
    }
    expect(db.rows).toHaveLength(0);
  });

  it("has no disconnect: a DELETE is refused and removes nothing", async () => {
    const mine = { ...victimRow(), id: "mine", user_id: ME };
    const db = memoryDb([victimRow(), mine]);
    for (const query of ["provider=zoom", "provider=google_meet", `provider=zoom&user_id=${VICTIM}`]) {
      expect((await handleManageIntegration(del(query), deps(db))).status).toBe(405);
    }
    expect(db.rows.map((r) => r.id)).toEqual(["victim-1", "mine"]);
  });

  it("refuses providers the desktop doesn't connect", async () => {
    const db = memoryDb();
    for (const provider of ["microsoft_calendar", "evil", ""]) {
      const res = await handleManageIntegration(post({ provider, access_token: "a" }), deps(db));
      expect(res.status).toBe(400);
    }
    expect(db.rows).toHaveLength(0);
  });
});

describe("manage-integration save", () => {
  it("stores google_calendar, encrypted server-side for the session's user", async () => {
    const db = memoryDb();
    const res = await handleManageIntegration(post({ ...GOOGLE, expires_at: 1_790_000_000 }), deps(db));
    expect(res.status).toBe(200);
    expect(db.rows).toHaveLength(1);
    const row = db.rows[0];
    expect(row).toMatchObject({ user_id: ME, provider: "google_calendar", account_key: "me@gmail.com" });
    expect(await decryptToken(row.access_token_enc, SECRET, ME)).toBe("acc");
    expect(await decryptToken(row.refresh_token_enc ?? "", SECRET, ME)).toBe("ref");
    expect(row.token_expiry).toBe(new Date(1_790_000_000 * 1000).toISOString());
  });

  it("updates the existing row instead of inserting a second one", async () => {
    const db = memoryDb();
    await handleManageIntegration(post({ ...GOOGLE, access_token: "a1" }), deps(db));
    await handleManageIntegration(post({ ...GOOGLE, access_token: "a2" }), deps(db));
    expect(db.rows).toHaveLength(1);
    expect(await decryptToken(db.rows[0].access_token_enc, SECRET, ME)).toBe("a2");
  });

  it("keys a Google Calendar token by the login's email from Google, adopting a legacy unkeyed row", async () => {
    const legacy = { ...victimRow("google_calendar"), id: "legacy", user_id: ME };
    const db = memoryDb([legacy]);
    const res = await handleManageIntegration(post(GOOGLE), deps(db));
    expect(res.status).toBe(200);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ id: "legacy", account_key: "me@gmail.com" });
  });

  it("refuses to save a Google Calendar token whose login Google won't name", async () => {
    const db = memoryDb();
    const res = await handleManageIntegration(post({ ...GOOGLE, access_token: "stale" }), deps(db, null));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "google_email_unknown" });
    expect(db.rows).toHaveLength(0);
  });

  it("answers 503 when the encryption secret isn't configured", async () => {
    const res = await handleManageIntegration(post(GOOGLE), {
      ...deps(memoryDb()),
      encryptionSecret: "",
    });
    expect(res.status).toBe(503);
  });
});
