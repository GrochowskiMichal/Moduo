import { describe, expect, it } from "@rstest/core";

import { CANONICAL_APP_ORIGIN } from "./app-origin.ts";
import {
  CONNECT_STATE_TTL_MS,
  connectCodeChallenge,
  connectCodeVerifier,
  connectReturnOrigin,
  connectReturnUrl,
  finishRefusal,
  readConnectState,
  signConnectState,
} from "./oauth-connect.ts";

const SECRET = "test-secret";
const NOW = 1_800_000_000_000;

describe("connectReturnOrigin", () => {
  it("keeps our deployed app hosts", () => {
    expect(connectReturnOrigin("https://app.moduo.app")).toBe("https://app.moduo.app");
    expect(connectReturnOrigin("https://app.staging.moduo.app/calendar")).toBe(
      "https://app.staging.moduo.app",
    );
  });

  it("sends anything else, the dev server included, to app.moduo.app", () => {
    for (const hint of [
      "http://localhost:8081",
      "http://127.0.0.1:8081",
      "https://evil.example",
      "https://app.moduo.app.evil.example",
      "https://moduo.app",
      "http://app.moduo.app",
      "http://localhost:3000",
      "tauri://localhost",
      "javascript:alert(1)",
      "",
      undefined,
      42,
    ]) {
      expect(connectReturnOrigin(hint)).toBe(CANONICAL_APP_ORIGIN);
    }
  });
});

describe("connect state", () => {
  it("round-trips who started and where to return", async () => {
    const state = await signConnectState(SECRET, "google", { uid: "u1", origin: "https://app.moduo.app" }, NOW);
    expect(await readConnectState(SECRET, "google", state, NOW)).toEqual({
      uid: "u1",
      origin: "https://app.moduo.app",
      exp: NOW + CONNECT_STATE_TTL_MS,
    });
  });

  it("signs a forged return host as app.moduo.app", async () => {
    const state = await signConnectState(SECRET, "zoom", { uid: "u1", origin: "https://evil.example" }, NOW);
    expect((await readConnectState(SECRET, "zoom", state, NOW))?.origin).toBe(CANONICAL_APP_ORIGIN);
  });

  it("expires", async () => {
    const state = await signConnectState(SECRET, "google", { uid: "u1", origin: "" }, NOW);
    expect(await readConnectState(SECRET, "google", state, NOW + CONNECT_STATE_TTL_MS)).not.toBeNull();
    expect(await readConnectState(SECRET, "google", state, NOW + CONNECT_STATE_TTL_MS + 1)).toBeNull();
  });

  it("is not accepted by the other provider or under another secret", async () => {
    const state = await signConnectState(SECRET, "google", { uid: "u1", origin: "" }, NOW);
    expect(await readConnectState(SECRET, "zoom", state, NOW)).toBeNull();
    expect(await readConnectState("other-secret", "google", state, NOW)).toBeNull();
    expect(await readConnectState("", "google", state, NOW)).toBeNull();
  });

  it("rejects a payload swapped under a valid signature", async () => {
    const mine = await signConnectState(SECRET, "google", { uid: "attacker", origin: "" }, NOW);
    const theirs = await signConnectState(SECRET, "google", { uid: "victim", origin: "" }, NOW);
    const forged = `${theirs.split(".")[0]}.${mine.split(".")[1]}`;
    expect(await readConnectState(SECRET, "google", forged, NOW)).toBeNull();
  });

  it("rejects a correctly signed state whose return host isn't ours", async () => {
    // What a state from the old function (any https origin) looks like.
    const sign = async (origin: string) => {
      const payload = Buffer.from(
        JSON.stringify({ uid: "u1", origin, exp: NOW + 60_000 }),
      ).toString("base64url");
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(`zoom:${SECRET}`),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
      return `${payload}.${Buffer.from(sig).toString("base64url")}`;
    };
    expect(await readConnectState(SECRET, "zoom", await sign("https://app.moduo.app"), NOW)).not.toBeNull();
    for (const origin of ["https://evil.example", "http://localhost:8081", "https://moduo.app"]) {
      expect(await readConnectState(SECRET, "zoom", await sign(origin), NOW)).toBeNull();
    }
  });

  it("rejects garbage", async () => {
    for (const state of ["", ".", "abc", "abc.", ".abc", "a.b.c", "%%%.%%%", null, 7]) {
      expect(await readConnectState(SECRET, "google", state, NOW)).toBeNull();
    }
  });

  it("refuses to sign without a secret", async () => {
    await expect(signConnectState("", "google", { uid: "u1", origin: "" }, NOW)).rejects.toThrow();
  });
});

describe("PKCE", () => {
  it("derives a valid verifier per state, provider and secret", async () => {
    const a = await connectCodeVerifier(SECRET, "google", "state-a");
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await connectCodeVerifier(SECRET, "google", "state-a")).toBe(a);
    expect(await connectCodeVerifier(SECRET, "google", "state-b")).not.toBe(a);
    expect(await connectCodeVerifier(SECRET, "zoom", "state-a")).not.toBe(a);
    expect(await connectCodeVerifier("other-secret", "google", "state-a")).not.toBe(a);
    await expect(connectCodeVerifier("", "google", "state-a")).rejects.toThrow();
  });

  it("computes the S256 challenge (RFC 7636 appendix B)", async () => {
    expect(await connectCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("finishRefusal", () => {
  const state = { uid: "starter", origin: CANONICAL_APP_ORIGIN, exp: NOW };

  it("lets only the user who started finish", () => {
    expect(finishRefusal(state, "starter")).toBeNull();
    expect(finishRefusal(state, "someone-else")).toBe("wrong_account");
    expect(finishRefusal(null, "starter")).toBe("bad_state");
  });
});

describe("connectReturnUrl", () => {
  it("returns to the calendar with the code and state, encoded", () => {
    const url = new URL(connectReturnUrl("https://app.staging.moduo.app", "zoom", "a&b=c", "p.q"));
    expect(url.origin).toBe("https://app.staging.moduo.app");
    expect(url.pathname).toBe("/calendar");
    expect(url.searchParams.get("connect")).toBe("zoom");
    expect(url.searchParams.get("connect_code")).toBe("a&b=c");
    expect(url.searchParams.get("connect_state")).toBe("p.q");
    expect(url.searchParams.has("code")).toBe(false);
  });

  it("ends in an empty fragment, so the redirect doesn't carry the request's", () => {
    const href = connectReturnUrl("https://app.moduo.app", "zoom", "c", "s");
    expect(href.endsWith("/calendar?connect=zoom&connect_code=c&connect_state=s#")).toBe(true);
    expect(Response.redirect(href, 302).headers.get("location")).toBe(href);
  });

  it("carries only the provider when there is no code", () => {
    const url = new URL(connectReturnUrl("https://app.moduo.app", "google", "", "p.q"));
    expect([...url.searchParams.keys()]).toEqual(["connect"]);
  });

  it("never returns off our hosts", () => {
    const url = new URL(connectReturnUrl("https://evil.example", "google", "c", "s"));
    expect(url.origin).toBe(CANONICAL_APP_ORIGIN);
  });
});
