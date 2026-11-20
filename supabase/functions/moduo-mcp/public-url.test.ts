import { describe, expect, it } from "@rstest/core";

import { publicOrigins, publicResource } from "./public-url.ts";

const req = (origin?: string) =>
  new Request("http://kong:8000/moduo-mcp", origin === undefined ? {} : { headers: { "x-moduo-mcp-origin": origin } });

describe("public addresses", () => {
  it("defaults to mcp.moduo.app", () => {
    expect([...publicOrigins(undefined)]).toEqual(["https://mcp.moduo.app"]);
    expect([...publicOrigins(" ")]).toEqual(["https://mcp.moduo.app"]);
  });

  it("reads a comma-separated list as origins, and refuses plain http off this machine", () => {
    const origins = publicOrigins(
      "https://mcp.moduo.app/, http://localhost:8787, http://mcp.example.com, not a url, https://x.workers.dev/path",
    );
    expect([...origins]).toEqual(["https://mcp.moduo.app", "http://localhost:8787", "https://x.workers.dev"]);
  });

  it("advertises a forwarded origin only when it is configured", () => {
    const origins = publicOrigins(undefined);
    expect(publicResource(req("https://mcp.moduo.app"), origins)).toBe("https://mcp.moduo.app");
    expect(publicResource(req("https://mcp.moduo.app/"), origins)).toBe("");
    expect(publicResource(req("https://evil.example"), origins)).toBe("");
    expect(publicResource(req(), origins)).toBe("");
  });
});
