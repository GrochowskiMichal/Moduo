import { describe, expect, it } from "@rstest/core";

import {
  makePostHogEraser,
  POSTHOG_DEFAULT_API_HOST,
  postHogEraserFromEnv,
} from "./posthog-erasure.ts";

type Call = { url: string; init: RequestInit };

/** A fetch that records each request and answers with the given status and body. */
function fakeFetch(status: number, body: unknown = "") {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(status === 204 ? null : text, { status });
  }) as typeof fetch;
  return { calls, impl };
}

const USER = "11111111-1111-4111-8111-111111111111";

describe("makePostHogEraser", () => {
  it("asks PostHog's private API to delete the person by distinct id, with their events", async () => {
    const { calls, impl } = fakeFetch(202, { persons_found: 1, deletion_errors: [] });
    const eraser = makePostHogEraser({ apiKey: "phx_key", projectId: "12345", fetch: impl });

    const result = await eraser.erasePerson(USER);

    expect(result).toEqual({ status: "queued", personsFound: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://eu.posthog.com/api/projects/12345/persons/bulk_delete/");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({
      Authorization: "Bearer phx_key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      distinct_ids: [USER],
      delete_events: true,
      delete_recordings: true,
    });
  });

  it("counts nobody found as done: a retry, or someone who never said yes", async () => {
    const { impl } = fakeFetch(202, { persons_found: 0, deletion_errors: [] });
    const eraser = makePostHogEraser({ apiKey: "phx_key", projectId: "12345", fetch: impl });

    expect(await eraser.erasePerson(USER)).toEqual({ status: "queued", personsFound: 0 });
  });

  it("uses another host when given one, without a doubled slash", async () => {
    const { calls, impl } = fakeFetch(202, {});
    const eraser = makePostHogEraser({
      apiKey: "phx_key",
      projectId: "7",
      host: "https://us.posthog.com/",
      fetch: impl,
    });

    await eraser.erasePerson(USER);

    expect(calls[0].url).toBe("https://us.posthog.com/api/projects/7/persons/bulk_delete/");
  });

  it.each([400, 401, 403, 404])(
    "reports a %s as refused for good, without throwing",
    async (status) => {
      const { impl } = fakeFetch(status, { detail: "nope" });
      const eraser = makePostHogEraser({ apiKey: "phx_key", projectId: "12345", fetch: impl });

      expect(await eraser.erasePerson(USER)).toEqual({ status: "refused", httpStatus: status });
    },
  );

  it.each([429, 500, 503])("throws on a %s, so the caller retries", async (status) => {
    const { impl } = fakeFetch(status, "busy");
    const eraser = makePostHogEraser({ apiKey: "phx_key", projectId: "12345", fetch: impl });

    await expect(eraser.erasePerson(USER)).rejects.toThrow(`PostHog ${status}`);
  });

  it("throws when the network fails", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const eraser = makePostHogEraser({ apiKey: "phx_key", projectId: "12345", fetch: impl });

    await expect(eraser.erasePerson(USER)).rejects.toThrow("fetch failed");
  });

  it("throws when PostHog matched the person but couldn't finish deleting", async () => {
    const { impl } = fakeFetch(202, { persons_found: 1, deletion_errors: [{ id: "p1" }] });
    const eraser = makePostHogEraser({ apiKey: "phx_key", projectId: "12345", fetch: impl });

    await expect(eraser.erasePerson(USER)).rejects.toThrow("couldn't finish");
  });
});

describe("postHogEraserFromEnv", () => {
  const env = (values: Record<string, string>) => (name: string) => values[name];

  it("is null unless both the key and the project id are set", () => {
    expect(postHogEraserFromEnv(env({}))).toBeNull();
    expect(postHogEraserFromEnv(env({ POSTHOG_PERSONAL_API_KEY: "phx_key" }))).toBeNull();
    expect(postHogEraserFromEnv(env({ POSTHOG_PROJECT_ID: "12345" }))).toBeNull();
    expect(
      postHogEraserFromEnv(env({ POSTHOG_PERSONAL_API_KEY: " ", POSTHOG_PROJECT_ID: "12345" })),
    ).toBeNull();
  });

  it("defaults to the EU private API and trims the secrets", async () => {
    const { calls, impl } = fakeFetch(202, {});
    const eraser = postHogEraserFromEnv(
      env({ POSTHOG_PERSONAL_API_KEY: " phx_key\n", POSTHOG_PROJECT_ID: " 12345 " }),
      impl,
    );

    await eraser?.erasePerson(USER);

    expect(POSTHOG_DEFAULT_API_HOST).toBe("https://eu.posthog.com");
    expect(calls[0].url).toBe(`${POSTHOG_DEFAULT_API_HOST}/api/projects/12345/persons/bulk_delete/`);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer phx_key");
  });

  it("uses POSTHOG_API_HOST when it's set", async () => {
    const { calls, impl } = fakeFetch(202, {});
    const eraser = postHogEraserFromEnv(
      env({
        POSTHOG_PERSONAL_API_KEY: "phx_key",
        POSTHOG_PROJECT_ID: "12345",
        POSTHOG_API_HOST: "https://posthog.example.com",
      }),
      impl,
    );

    await eraser?.erasePerson(USER);

    expect(calls[0].url).toBe("https://posthog.example.com/api/projects/12345/persons/bulk_delete/");
  });
});
