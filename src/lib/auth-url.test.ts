import { afterEach, describe, expect, it } from "@rstest/core";
import { createClient } from "@supabase/supabase-js";

import {
  authLinkWasIgnored,
  isAuthCallbackFragment,
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

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
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
      autoRefreshToken: false, // no refresh timer in a test
      storage: memoryStorage(),
      storageKey: `auth-url-test-${detectSessionInUrl}`,
    },
    global: { fetch: fetchStub as typeof fetch },
  });
  const { data } = await client.auth.getSession();
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

describe("isAuthCallbackFragment", () => {
  it("matches token and link-error fragments", () => {
    expect(isAuthCallbackFragment(FORGED_FRAGMENT)).toBe(true);
    expect(isAuthCallbackFragment("#refresh_token=x")).toBe(true);
    expect(
      isAuthCallbackFragment(
        "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid",
      ),
    ).toBe(true);
  });

  it("leaves ordinary fragments alone", () => {
    expect(isAuthCallbackFragment("")).toBe(false);
    expect(isAuthCallbackFragment("#")).toBe(false);
    expect(isAuthCallbackFragment("#section-2")).toBe(false);
    expect(isAuthCallbackFragment("#token=abc")).toBe(false);
  });
});

describe("scrubAuthCallbackFromUrl", () => {
  it("drops a sign-in fragment and keeps the path and query", () => {
    setUrl(`/join?invite=abc${FORGED_FRAGMENT}`);
    expect(scrubAuthCallbackFromUrl()).toBe(true);
    expect(window.location.pathname).toBe("/join");
    expect(window.location.search).toBe("?invite=abc");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("access_token");
    expect(authLinkWasIgnored()).toBe(true);
  });

  it("does nothing to other URLs", () => {
    setUrl("/calendar?connect=google#section");
    expect(scrubAuthCallbackFromUrl()).toBe(false);
    expect(window.location.hash).toBe("#section");
  });
});
