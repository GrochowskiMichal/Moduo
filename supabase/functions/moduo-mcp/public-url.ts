/**
 * The connector's public addresses (docs/decisions/mcp.md, 2026-10-23).
 *
 * Apps reach the connector at its Supabase URL
 * (https://<ref>.supabase.co/functions/v1/moduo-mcp) or at
 * https://mcp.moduo.app, a Cloudflare Worker (infra/mcp-proxy) that forwards
 * every request here unchanged and says which address the client used in
 * PUBLIC_ORIGIN_HEADER. OAuth discovery must name the address the client
 * used: an MCP client checks that the protected-resource document's
 * `resource` matches the URL it connected to.
 *
 * The header is trusted only when it names one of the configured public
 * origins (MCP_PUBLIC_URL, comma-separated; https://mcp.moduo.app when unset),
 * so a client that sends it straight to the Supabase URL can at most make the
 * connector advertise Moduo's own address, which reaches the same function.
 * It can never make it advertise a host of its choosing. Without the header,
 * or with any other value, the Supabase URL is advertised exactly as before.
 */

/** Set by infra/mcp-proxy on every request it forwards: the origin the client called. */
export const PUBLIC_ORIGIN_HEADER = "x-moduo-mcp-origin";

export const DEFAULT_PUBLIC_URL = "https://mcp.moduo.app";

/** The configured public origins, from MCP_PUBLIC_URL (unset or empty → the default). */
export function publicOrigins(configured: string | undefined): Set<string> {
  const entries = (configured ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const origins = new Set<string>();
  for (const entry of entries.length > 0 ? entries : [DEFAULT_PUBLIC_URL]) {
    try {
      const url = new URL(entry);
      if (url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1") {
        origins.add(url.origin);
      }
    } catch {
      console.error("moduo-mcp: MCP_PUBLIC_URL entry is not a URL", entry);
    }
  }
  return origins;
}

/**
 * The resource URL to advertise for this request: the public origin the
 * proxy forwarded it from, or "" (the Supabase URL, @supabase/server's default).
 */
export function publicResource(req: Request, origins: Set<string>): string {
  const claimed = req.headers.get(PUBLIC_ORIGIN_HEADER)?.trim() ?? "";
  return origins.has(claimed) ? claimed : "";
}
