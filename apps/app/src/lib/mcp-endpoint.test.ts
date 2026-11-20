import { describe, expect, it } from "@rstest/core";

import { mcpEndpointFor } from "./mcp-endpoint";

describe("mcpEndpointFor", () => {
  it("gives production's Moduo address", () => {
    expect(mcpEndpointFor("https://wtoonrvuqumihpkbvwvs.supabase.co")).toBe(
      "https://mcp.moduo.app",
    );
    expect(mcpEndpointFor("https://wtoonrvuqumihpkbvwvs.supabase.co/")).toBe(
      "https://mcp.moduo.app",
    );
  });

  it("gives any other project its function URL", () => {
    expect(mcpEndpointFor("http://127.0.0.1:54321")).toBe(
      "http://127.0.0.1:54321/functions/v1/moduo-mcp",
    );
    expect(mcpEndpointFor("https://other.supabase.co")).toBe(
      "https://other.supabase.co/functions/v1/moduo-mcp",
    );
  });
});
