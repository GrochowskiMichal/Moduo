import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, rs } from "@rstest/core";

// The REAL posthog-js behind lib/analytics.ts, with every transport stubbed (fetch, XHR,
// sendBeacon) — nothing leaves the test. It proves what the fake in analytics.test.ts
// can't: no request at all before consent or after withdrawal, only event batches to the
// configured host in between, no scripts injected, the outgoing payload scrubbed, and no
// PostHog storage left behind. Also catches a posthog-js upgrade that adds a default-on call.

type Sent = { url: string; body: unknown };
const sent: Sent[] = [];

// posthog-js picks a body format by what the environment supports (gzip, base64 form
// data or plain JSON; a bare array or `{ api_key, batch }`), so read whatever it sent.
async function decode(body: unknown): Promise<unknown> {
  if (body == null) return null;
  const bytes =
    typeof (body as Blob).arrayBuffer === "function"
      ? new Uint8Array(await (body as Blob).arrayBuffer())
      : body instanceof ArrayBuffer || ArrayBuffer.isView(body)
        ? new Uint8Array(body instanceof ArrayBuffer ? body : body.buffer)
        : new TextEncoder().encode(String(body));
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = isGzip ? gunzipSync(bytes).toString("utf8") : new TextDecoder().decode(bytes);
  if (text.startsWith("data=")) {
    const data = new URLSearchParams(text).get("data") ?? "";
    return JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  }
  return JSON.parse(text);
}

const pending: Promise<void>[] = [];
function record(url: string, body: unknown) {
  pending.push(
    decode(body).then(
      (decoded) => {
        sent.push({ url, body: decoded });
      },
      () => {
        sent.push({ url, body: "<undecodable>" });
      },
    ),
  );
}

async function settled() {
  await Promise.all(pending.splice(0));
}

/** Everything PostHog has queued goes out now (it flushes on page hide, by beacon).
 *  `$identify` skips the batch and goes out by fetch, after an async compression step
 *  where the environment has one, so give that a beat too. */
async function flush() {
  window.dispatchEvent(new Event("pagehide"));
  window.dispatchEvent(new Event("unload"));
  await new Promise((resolve) => setTimeout(resolve, 100));
  await settled();
}

type SentEvent = { event: string; properties: Record<string, unknown> } & object;
const events = (): SentEvent[] =>
  sent.flatMap(({ body }) => {
    if (Array.isArray(body)) return body;
    const batch = (body as { batch?: unknown } | null)?.batch;
    return Array.isArray(batch) ? batch : [body];
  });

const ourStorage = () =>
  [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter(
    (key) => key.startsWith("ph_") || key.startsWith("__ph_"),
  );

beforeAll(() => {
  // posthog-js picks its transports when it loads, so stub them before it ever does.
  rs.stubEnv("PUBLIC_POSTHOG_KEY", "phc_test");
  rs.stubEnv("PUBLIC_POSTHOG_HOST", "https://ph.invalid");
  rs.stubGlobal(
    "fetch",
    rs.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      record(input instanceof Request ? input.url : String(input), init?.body);
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  rs.stubGlobal(
    "XMLHttpRequest",
    class {
      withCredentials = false;
      readyState = 4;
      status = 200;
      responseText = "{}";
      url = "";
      open(_method: string, url: string) {
        this.url = url;
      }
      setRequestHeader() {}
      send(body?: unknown) {
        record(this.url, body);
      }
    },
  );
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: (url: string, body?: unknown) => {
      record(url, body);
      return true;
    },
  });
  localStorage.clear();
  sessionStorage.clear();
});

afterAll(() => {
  rs.unstubAllEnvs();
  rs.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "sendBeacon");
});

describe("analytics with the real posthog-js (network stubbed)", () => {
  it("sends nothing before consent, only scrubbed events to the host after, and nothing once withdrawn", async () => {
    const a = await import("./analytics");
    const scriptsBefore = document.querySelectorAll("script[src]").length;

    // Signed in, no choice made yet: nothing at all.
    await a.setAnalyticsUser("u1");
    await a.Analytics.app.signedIn("cloud");
    await flush();
    expect(sent).toEqual([]);
    expect(ourStorage()).toEqual([]);

    // Opted in, from a URL carrying tokens and campaign tags.
    window.history.replaceState(
      null,
      "",
      "/join/abc123?invite=SECRET&utm_source=newsletter&gclid=CLICKID#access_token=SECRET",
    );
    await a.setAnalyticsConsent("u1", "granted");
    await a.Analytics.app.signedIn("cloud");
    await flush();

    await rs.waitFor(async () => {
      await settled();
      expect(
        events()
          .map((e) => e.event)
          .sort(),
      ).toEqual(["$identify", "app_signed_in"]);
    });
    for (const { url } of sent) expect(url).toMatch(/^https:\/\/ph\.invalid\/e\//);
    for (const e of events()) {
      expect(e.properties.distinct_id).toBe("u1");
      expect(e.properties.surface).toBe("app");
      expect(e.properties.$current_url).toBe("http://localhost:3000/join");
      expect(e).not.toHaveProperty("$set_once");
      expect(Object.keys(e.properties).filter((k) => k.startsWith("$session_entry_"))).toEqual([]);
    }
    const payload = JSON.stringify(sent);
    expect(payload).not.toMatch(/SECRET|CLICKID|newsletter|abc123/);
    // Only PostHog's own storage, under the app's names.
    expect(ourStorage().sort()).toEqual(
      expect.arrayContaining(["__ph_opt_in_out_moduo_app", "ph_moduo_app"]),
    );
    for (const key of ourStorage()) {
      expect(key === "__ph_opt_in_out_moduo_app" || key.startsWith("ph_moduo_app")).toBe(true);
    }

    // Withdrawn: storage wiped, and nothing goes out any more.
    sent.length = 0;
    await a.setAnalyticsConsent("u1", "denied");
    await a.Analytics.app.pageViewed("tasks");
    await flush();
    expect(sent).toEqual([]);
    expect(ourStorage()).toEqual([]);

    // Signed out: still nothing.
    await a.Analytics.app.signedOut();
    await a.setAnalyticsUser(null);
    await flush();
    expect(sent).toEqual([]);
    expect(ourStorage()).toEqual([]);

    // No remote config, toolbar, recorder or survey scripts were ever injected.
    expect(document.querySelectorAll("script[src]").length).toBe(scriptsBefore);
  });
});
