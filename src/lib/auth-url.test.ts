import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "@rstest/core";
import { createClient } from "@supabase/supabase-js";

import {
  authCallbackKind,
  clearIgnoredAuthLink,
  ignoredAuthLink,
  SUPABASE_AUTH_OPTIONS,
  scrubAuthCallbackFromUrl,
} from "./auth-url";

const SUPABASE_URL = "https://example.supabase.co";

function b64url(value: object): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Structurally valid (unsigned) JWT: the shape a forged link would carry.
const now = Math.floor(Date.now() / 1000);
const ATTACKER_TOKEN = [
  b64url({ alg: "HS256", typ: "JWT" }),
  b64url({ sub: "attacker-id", email: "attacker@example.com", exp: now + 3600, iat: now }),
  "sig",
].join(".");
const FORGED_FRAGMENT = `#access_token=${ATTACKER_TOKEN}&refresh_token=attacker-refresh&expires_in=3600&token_type=bearer&type=magiclink`;

function setUrl(path: string) {
  window.history.replaceState(null, "", path);
}

/** A client wired like runtime.web's, against a fetch that answers /auth/v1/user as the attacker. */
async function sessionAfterBoot(detectSessionInUrl: boolean) {
  const calls: string[] = [];
  const fetchStub = async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.endsWith("/auth/v1/user")) {
      return new Response(
        JSON.stringify({ id: "attacker-id", aud: "authenticated", email: "attacker@example.com" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  };
  const client = createClient(SUPABASE_URL, "sb_publishable_test", {
    auth: {
      ...SUPABASE_AUTH_OPTIONS,
      detectSessionInUrl,
      // In-memory session, no refresh timer, no cross-tab channel: nothing to
      // leak between tests. Neither setting affects reading the URL.
      autoRefreshToken: false,
      persistSession: false,
    },
    global: { fetch: fetchStub as typeof fetch },
  });
  const { data } = await client.auth.getSession();
  await client.auth.stopAutoRefresh(); // also drops the visibilitychange listener
  return { session: data.session, calls };
}

afterEach(() => setUrl("/"));

describe("SUPABASE_AUTH_OPTIONS", () => {
  it("never reads a session from the URL", () => {
    expect(SUPABASE_AUTH_OPTIONS.detectSessionInUrl).toBe(false);
  });

  it("ignores a forged #access_token link (login CSRF)", async () => {
    setUrl(`/notes${FORGED_FRAGMENT}`);
    const { session, calls } = await sessionAfterBoot(SUPABASE_AUTH_OPTIONS.detectSessionInUrl);
    expect(session).toBeNull();
    expect(calls.some((url) => url.endsWith("/auth/v1/user"))).toBe(false);
  });

  it("control: with detection on, the same link signs the tab in as the sender", async () => {
    // Proves the test above exercises auth-js's URL path rather than passing
    // vacuously (e.g. if auth-js didn't treat jsdom as a browser).
    setUrl(`/notes${FORGED_FRAGMENT}`);
    const { session } = await sessionAfterBoot(true);
    expect(session?.user.email).toBe("attacker@example.com");
  });
});

describe("authCallbackKind", () => {
  it("tells session fragments from link errors", () => {
    expect(authCallbackKind(FORGED_FRAGMENT)).toBe("session");
    expect(authCallbackKind("#refresh_token=x")).toBe("session");
    expect(
      authCallbackKind(
        "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid",
      ),
    ).toBe("error");
  });

  it("leaves ordinary fragments alone", () => {
    expect(authCallbackKind("")).toBeNull();
    expect(authCallbackKind("#")).toBeNull();
    expect(authCallbackKind("#section-2")).toBeNull();
    expect(authCallbackKind("#token=abc")).toBeNull();
    expect(authCallbackKind("#error=x")).toBeNull();
  });
});

describe("scrubAuthCallbackFromUrl", () => {
  it("drops a sign-in fragment and keeps the path and query", () => {
    setUrl(`/join?invite=abc${FORGED_FRAGMENT}`);
    expect(scrubAuthCallbackFromUrl()).toBe("session");
    expect(window.location.pathname).toBe("/join");
    expect(window.location.search).toBe("?invite=abc");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("access_token");
    expect(ignoredAuthLink()).toBe("session");
    clearIgnoredAuthLink(); // what a SIGNED_IN does (runtime.web.ts)
    expect(ignoredAuthLink()).toBeNull();
  });

  it("runs before the router: auth-url-boot is main.tsx's first import", () => {
    const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
    const firstImport = main.split("\n").find((line) => line.startsWith("import "));
    expect(firstImport).toBe('import "./lib/auth-url-boot";');
  });

  it("does nothing to other URLs", () => {
    setUrl("/calendar?connect=google#section");
    expect(scrubAuthCallbackFromUrl()).toBeNull();
    expect(window.location.hash).toBe("#section");
    expect(ignoredAuthLink()).toBeNull();
  });
});
