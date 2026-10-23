// mcp.moduo.app: forwards every request to the moduo-mcp Edge Function, unchanged (method, path
// below the function, query, headers including Authorization and the MCP headers, body, and the
// streamed response). It adds one header, PUBLIC_ORIGIN_HEADER, so the function names this address
// in OAuth discovery (supabase/functions/moduo-mcp/public-url.ts); the function only believes it
// for origins it is configured with. Besides forwarding it answers two paths itself:
//   /favicon.ico   Moduo's icon, from moduo.app (Claude shows a custom connector's domain icon)
//   /.well-known/oauth-protected-resource[/…]   the function's protected-resource document, for
//                  RFC 9728 clients that look there before reading the 401's resource_metadata

export type Env = {
  /** The function's own URL, e.g. https://<ref>.supabase.co/functions/v1/moduo-mcp. */
  UPSTREAM: string;
};

/** The origin the client called; must match supabase/functions/moduo-mcp/public-url.ts. */
export const PUBLIC_ORIGIN_HEADER = "x-moduo-mcp-origin";

export const FAVICON_URL = "https://moduo.app/favicon.ico";

const WELL_KNOWN_METADATA = "/.well-known/oauth-protected-resource";

/**
 * Headers that describe the client's hop, not the request: Cloudflare sets its own on the
 * subrequest, and a client must not be able to pass forwarding claims through to the function.
 */
function dropHeader(name: string): boolean {
  return (
    name === "host" ||
    name === "cdn-loop" ||
    name === "x-real-ip" ||
    name === "forwarded" ||
    name === PUBLIC_ORIGIN_HEADER ||
    name.startsWith("cf-") ||
    name.startsWith("x-forwarded-")
  );
}

/** The function URL a request to this Worker maps to. */
export function upstreamUrl(request: Request, upstream: string): string {
  const url = new URL(request.url);
  const base = upstream.replace(/\/+$/, "");
  let path = url.pathname;
  if (path === WELL_KNOWN_METADATA || path.startsWith(`${WELL_KNOWN_METADATA}/`)) {
    path = "/oauth-protected-resource";
  }
  return `${base}${path === "/" ? "" : path}${url.search}`;
}

async function favicon(): Promise<Response> {
  let res: Response;
  try {
    // cf.cacheTtl: Cloudflare keeps a copy at the edge for a day (ignored outside Workers).
    res = await fetch(FAVICON_URL, { cf: { cacheTtl: 86400 } } as RequestInit);
  } catch {
    return new Response(null, { status: 502 });
  }
  if (!res.ok) return new Response(null, { status: res.status === 404 ? 404 : 502 });
  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "image/x-icon",
      "cache-control": "public, max-age=86400",
    },
  });
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  // An encoded slash or backslash could step out of the function's path if a gateway decodes it;
  // the connector never uses one.
  if (/%2f|%5c/i.test(url.pathname)) return new Response(null, { status: 404 });
  if (url.pathname === "/favicon.ico" && (request.method === "GET" || request.method === "HEAD")) {
    return favicon();
  }

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (!dropHeader(name.toLowerCase())) headers.append(name, value);
  }
  headers.set(PUBLIC_ORIGIN_HEADER, url.origin);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  // The response is returned as is: its body streams through, its headers (WWW-Authenticate, CORS,
  // content type) are the function's.
  return fetch(upstreamUrl(request, env.UPSTREAM), {
    method: request.method,
    headers,
    body: hasBody ? request.body : null,
    redirect: "manual",
    // Node (the tests) needs this to send a streamed body; Workers ignores it.
    duplex: "half",
  } as RequestInit);
}
