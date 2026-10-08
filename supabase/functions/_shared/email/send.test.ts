import { describe, expect, it } from "@rstest/core";

import {
  base64Utf8,
  formatFrom,
  type OutgoingEmail,
  RESEND_ENDPOINT,
  sendViaResend,
  sendWithRetry,
  viaModuo,
} from "./send.ts";

const EMAIL: OutgoingEmail = {
  from: formatFrom("Moduo", "hello@moduo.app"),
  to: "tom@becker.studio",
  subject: "482913 is your Moduo code",
  html: "<p>hi</p>",
  text: "hi",
  idempotencyKey: "auth_code:abc",
};

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<{ status: number; body?: unknown } | Error>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("From header", () => {
  it("quotes the display name and can't be broken out of", () => {
    expect(formatFrom("Moduo", "hello@moduo.app")).toBe('"Moduo" <hello@moduo.app>');
    expect(formatFrom('Anna "Boss" <evil@x.test>\r\nBcc: a@b', "hello@moduo.app")).toBe(
      '"Anna Boss evil@x.test Bcc: a@b" <hello@moduo.app>',
    );
    expect(formatFrom("", "hello@moduo.app")).toBe('"Moduo" <hello@moduo.app>');
    expect(formatFrom("x".repeat(200), "hello@moduo.app").length).toBeLessThan(90);
  });

  it("names email sent on someone's behalf", () => {
    expect(viaModuo("Anna Carter")).toBe("Anna Carter via Moduo");
    expect(viaModuo("  ")).toBe("Moduo");
  });
});

describe("sendViaResend", () => {
  it("posts the message with the idempotency key", async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { id: "re_123" } }]);
    const result = await sendViaResend(
      { ...EMAIL, replyTo: "anna@northwind.studio", headers: { "X-Entity-Ref-ID": "1" } },
      { apiKey: "re_test", fetch: fn },
    );
    expect(result).toEqual({ ok: true, id: "re_123" });
    expect(calls[0].url).toBe(RESEND_ENDPOINT);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test");
    expect(headers["Idempotency-Key"]).toBe("auth_code:abc");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({
      from: '"Moduo" <hello@moduo.app>',
      to: ["tom@becker.studio"],
      subject: "482913 is your Moduo code",
      text: "hi",
      reply_to: "anna@northwind.studio",
      headers: { "X-Entity-Ref-ID": "1" },
    });
  });

  it("refuses to send without a key", async () => {
    const { fn, calls } = fakeFetch([]);
    expect(await sendViaResend(EMAIL, { apiKey: "", fetch: fn })).toEqual({
      ok: false,
      retryable: false,
      status: null,
      error: "resend_not_configured",
    });
    expect(calls.length).toBe(0);
  });

  it("classifies failures", async () => {
    const server = fakeFetch([{ status: 503, body: { message: "busy" } }]);
    expect(await sendViaResend(EMAIL, { apiKey: "k", fetch: server.fn })).toEqual({
      ok: false,
      retryable: true,
      status: 503,
      error: "busy",
    });
    const limited = fakeFetch([{ status: 429, body: { message: "slow down" } }]);
    expect((await sendViaResend(EMAIL, { apiKey: "k", fetch: limited.fn })).ok).toBe(false);
    expect(await sendViaResend(EMAIL, { apiKey: "k", fetch: fakeFetch([{ status: 422, body: { message: "bad from" } }]).fn })).toEqual({
      ok: false,
      retryable: false,
      status: 422,
      error: "bad from",
    });
    const racingResult = await sendViaResend(EMAIL, {
      apiKey: "k",
      fetch: fakeFetch([{ status: 409, body: { name: "concurrent_idempotent_requests", message: "in flight" } }]).fn,
    });
    expect(racingResult).toMatchObject({ retryable: true, status: 409 });
    const reused = await sendViaResend(EMAIL, {
      apiKey: "k",
      fetch: fakeFetch([{ status: 409, body: { name: "invalid_idempotent_request", message: "different payload" } }]).fn,
    });
    expect(reused).toMatchObject({ retryable: false, status: 409 });
    const offline = await sendViaResend(EMAIL, { apiKey: "k", fetch: fakeFetch([new Error("offline")]).fn });
    expect(offline).toEqual({ ok: false, retryable: true, status: null, error: "offline" });
  });

  it("sends attachments with their content type", async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { id: "re_1" } }]);
    await sendViaResend(
      { ...EMAIL, attachments: [{ filename: "invite.ics", content: "QQ==", contentType: "text/calendar" }] },
      { apiKey: "k", fetch: fn },
    );
    expect(JSON.parse(String(calls[0].init.body)).attachments).toEqual([
      { filename: "invite.ics", content: "QQ==", content_type: "text/calendar" },
    ]);
  });
});

describe("timeouts", () => {
  it("gives up on a hanging request and calls it retryable", async () => {
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    expect(await sendViaResend(EMAIL, { apiKey: "k", fetch: hanging, timeoutMs: 20 })).toEqual({
      ok: false,
      retryable: true,
      status: null,
      error: "timeout",
    });
  });
});

describe("sendWithRetry", () => {
  const noWait = async () => {};

  it("tries again once after a retryable failure", async () => {
    const { fn, calls } = fakeFetch([{ status: 502 }, { status: 200, body: { id: "re_2" } }]);
    expect(await sendWithRetry(EMAIL, { apiKey: "k", fetch: fn }, { sleep: noWait })).toEqual({ ok: true, id: "re_2" });
    expect(calls.length).toBe(2);
  });

  it("doesn't retry a request Resend rejected", async () => {
    const { fn, calls } = fakeFetch([{ status: 400, body: { message: "nope" } }]);
    const result = await sendWithRetry(EMAIL, { apiKey: "k", fetch: fn }, { sleep: noWait });
    expect(result.ok).toBe(false);
    expect(calls.length).toBe(1);
  });
});

describe("base64Utf8", () => {
  it("encodes UTF-8 text", () => {
    expect(base64Utf8("Kraków")).toBe("S3Jha8Ozdw==");
  });
});
