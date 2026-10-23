import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, rs } from "@rstest/core";

import { type Env, FAVICON_URL, handle, PUBLIC_ORIGIN_HEADER, upstreamUrl } from "./server";

/** What the stand-in function received. */
type Seen = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };

let server: Server;
let env: Env;
let seen: Seen[] = [];

// A real HTTP server stands in for the Edge Function, so forwarding runs over a socket: headers,
// body and a response that arrives in chunks.
beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({
        method: req.method!,
        url: req.url!,
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      });
      if (req.url!.endsWith("/stream")) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("event: message\ndata: one\n\n");
        setTimeout(() => res.end("event: message\ndata: two\n\n"), 30);
        return;
      }
      if (!req.headers.authorization) {
        res.writeHead(401, {
          "content-type": "application/json",
          "www-authenticate":
            'Bearer resource_metadata="https://mcp.moduo.app/oauth-protected-resource"',
          "access-control-allow-origin": "*",
        });
        res.end(JSON.stringify({ error: "Missing, invalid, revoked or expired API key." }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "none" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  env = { UPSTREAM: `http://127.0.0.1:${port}/functions/v1/moduo-mcp` };
});

afterAll(() => {
  rs.restoreAllMocks();
  server.close();
});

const PUBLIC = "https://mcp.moduo.app";
const toolsList = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

describe("forwarding", () => {
  it("sends a POST through unchanged: path, query, Authorization, MCP headers and body", async () => {
    seen = [];
    const res = await handle(
      new Request(`${PUBLIC}/?debug=1`, {
        method: "POST",
        headers: {
          authorization: "Bearer moduo_sk_abc",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/list",
          "mcp-session-id": "s-1",
        },
        body: toolsList,
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBe("none");
    expect(await res.json()).toEqual({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
    const [req] = seen;
    expect(req!.method).toBe("POST");
    expect(req!.url).toBe("/functions/v1/moduo-mcp?debug=1");
    expect(req!.body).toBe(toolsList);
    expect(req!.headers.authorization).toBe("Bearer moduo_sk_abc");
    expect(req!.headers["mcp-protocol-version"]).toBe("2026-07-28");
    expect(req!.headers["mcp-method"]).toBe("tools/list");
    expect(req!.headers["mcp-session-id"]).toBe("s-1");
    expect(req!.headers.accept).toBe("application/json, text/event-stream");
    expect(req!.headers[PUBLIC_ORIGIN_HEADER]).toBe(PUBLIC);
  });

  it("passes the function's 401 back with its WWW-Authenticate and CORS headers", async () => {
    const res = await handle(new Request(PUBLIC, { method: "POST", body: toolsList }), env);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://mcp.moduo.app/oauth-protected-resource"',
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("streams a response as it arrives", async () => {
    const res = await handle(
      new Request(`${PUBLIC}/stream`, { method: "POST", headers: { authorization: "x" } }),
      env,
    );
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("data: one");
    let rest = "";
    for (let r = await reader.read(); !r.done; r = await reader.read())
      rest += new TextDecoder().decode(r.value);
    expect(rest).toContain("data: two");
  });

  it("forwards GET and OPTIONS (discovery, CORS preflight) to the same path below the function", async () => {
    seen = [];
    await handle(new Request(`${PUBLIC}/oauth-protected-resource`), env);
    await handle(
      new Request(PUBLIC, {
        method: "OPTIONS",
        headers: { "access-control-request-method": "POST" },
      }),
      env,
    );
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "GET /functions/v1/moduo-mcp/oauth-protected-resource",
      "OPTIONS /functions/v1/moduo-mcp",
    ]);
    expect(seen[0]!.body).toBe("");
  });

  it("names the origin the client called, and never a forwarding claim the client sent", async () => {
    seen = [];
    await handle(
      new Request(PUBLIC, {
        method: "POST",
        headers: {
          authorization: "x",
          [PUBLIC_ORIGIN_HEADER]: "https://evil.example",
          "x-forwarded-host": "evil.example",
          forwarded: "host=evil.example",
          "cf-connecting-ip": "203.0.113.9",
        },
        body: toolsList,
      }),
      env,
    );
    const { headers } = seen[0]!;
    expect(headers[PUBLIC_ORIGIN_HEADER]).toBe(PUBLIC);
    expect(headers["x-forwarded-host"]).toBeUndefined();
    expect(headers.forwarded).toBeUndefined();
    expect(headers["cf-connecting-ip"]).toBeUndefined();
  });
});

describe("paths", () => {
  const up = "https://ref.supabase.co/functions/v1/moduo-mcp";
  const map = (path: string) => upstreamUrl(new Request(`${PUBLIC}${path}`), up);

  it("mounts the function at the root", () => {
    expect(map("/")).toBe(up);
    expect(map("")).toBe(up);
    expect(map("/oauth-protected-resource")).toBe(`${up}/oauth-protected-resource`);
    expect(map("/mcp?x=1")).toBe(`${up}/mcp?x=1`);
  });

  it("answers the RFC 9728 well-known paths with the function's document", () => {
    expect(map("/.well-known/oauth-protected-resource")).toBe(`${up}/oauth-protected-resource`);
    expect(map("/.well-known/oauth-protected-resource/")).toBe(`${up}/oauth-protected-resource`);
    expect(map("/.well-known/oauth-protected-resource/mcp")).toBe(`${up}/oauth-protected-resource`);
    expect(map("/.well-known/oauth-protected-resource-x")).toBe(
      `${up}/.well-known/oauth-protected-resource-x`,
    );
  });
});

describe("favicon", () => {
  it("serves Moduo's icon from moduo.app, cached for a day", async () => {
    const real = globalThis.fetch;
    const spy = rs.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === FAVICON_URL) {
        return new Response(new Uint8Array([0, 0, 1, 0]), {
          headers: { "content-type": "image/vnd.microsoft.icon" },
        });
      }
      return real(input, init);
    });
    seen = [];
    const res = await handle(new Request(`${PUBLIC}/favicon.ico`), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/vnd.microsoft.icon");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0, 0, 1, 0]));
    expect(seen).toEqual([]);
    spy.mockRestore();
  });
});
