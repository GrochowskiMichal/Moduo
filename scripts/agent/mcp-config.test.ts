import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// AC10 (Harness v3): a session in this repo gets one Moduo server, at mcp.moduo.app, and one Supabase server.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
type McpJson = {
  mcpServers: Record<string, { type?: string; url?: string; headers?: Record<string, string> }>;
};
const read = (rel: string): McpJson => JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));

describe(".mcp.json", () => {
  const servers = read(".mcp.json").mcpServers;

  it("has exactly one Moduo and one Supabase server", () => {
    expect(Object.keys(servers).sort()).toEqual(["moduo", "supabase"]);
    const urls = Object.values(servers).map((s) => s.url ?? "");
    expect(urls.filter((u) => u.includes("moduo"))).toHaveLength(1);
    expect(urls.filter((u) => u.includes("mcp.supabase.com"))).toHaveLength(1);
  });

  it("points moduo at https://mcp.moduo.app with the agent's key from MODUO_MCP_KEY", () => {
    expect(servers.moduo).toEqual({
      type: "http",
      url: "https://mcp.moduo.app",
      headers: { Authorization: "Bearer ${MODUO_MCP_KEY:-}" },
    });
  });

  it("matches the moduo-agent plugin's copy", () => {
    expect(read("tools/claude-plugins/moduo-agent/.mcp.json").mcpServers.moduo).toEqual(
      servers.moduo,
    );
  });
});
