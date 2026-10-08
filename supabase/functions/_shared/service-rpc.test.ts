import { describe, expect, it } from "@rstest/core";

import { ServiceRpcError, serviceRpc } from "./service-rpc.ts";

function fakeFetch(status: number, body: string) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("serviceRpc", () => {
  it("posts the arguments to /rest/v1/rpc/<fn> with the secret key and returns the JSON result", async () => {
    const fake = fakeFetch(200, "true");
    const result = await serviceRpc<boolean>(
      { baseUrl: "https://example.supabase.co/", key: "sb_secret_x", fetch: fake.fn },
      "email_outbox__authorize",
      { p_secret: "s" },
    );
    expect(result).toBe(true);
    expect(fake.calls[0].url).toBe("https://example.supabase.co/rest/v1/rpc/email_outbox__authorize");
    expect((fake.calls[0].init.headers as Record<string, string>).apikey).toBe("sb_secret_x");
    expect(fake.calls[0].init.body).toBe('{"p_secret":"s"}');
  });

  it("returns null for an empty answer (a void function)", async () => {
    const fake = fakeFetch(200, "");
    expect(await serviceRpc({ baseUrl: "https://e.co", key: "k", fetch: fake.fn }, "f", {})).toBeNull();
  });

  it("throws on an error answer, naming the function and status", async () => {
    const fake = fakeFetch(404, '{"code":"PGRST202"}');
    await expect(serviceRpc({ baseUrl: "https://e.co", key: "k", fetch: fake.fn }, "missing_fn", {})).rejects.toThrow(
      ServiceRpcError,
    );
    await expect(serviceRpc({ baseUrl: "https://e.co", key: "k", fetch: fake.fn }, "missing_fn", {})).rejects.toThrow(
      "rpc missing_fn: 404",
    );
  });
});
