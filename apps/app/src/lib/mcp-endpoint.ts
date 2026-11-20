// The address apps connect the Moduo MCP connector at. Production's is https://mcp.moduo.app, a
// Worker (infra/mcp-proxy) in front of the moduo-mcp Edge Function, so Claude shows Moduo's icon
// (it reads a custom connector's icon off its URL's domain). Any other project, such as the local
// stack, gets its function URL; the Worker only forwards to production.

const PRODUCTION_SUPABASE_HOST = "wtoonrvuqumihpkbvwvs.supabase.co";
export const PRODUCTION_MCP_URL = "https://mcp.moduo.app";

/** The connector URL for the Supabase project at `supabaseUrl`. */
export function mcpEndpointFor(supabaseUrl: string): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  try {
    if (new URL(base).host === PRODUCTION_SUPABASE_HOST) return PRODUCTION_MCP_URL;
  } catch {
    // Not a URL: fall through to the plain function path, as before.
  }
  return `${base}/functions/v1/moduo-mcp`;
}
