// Turborepo remote cache (v8 artifacts API) on a Cloudflare Worker, stored in R2.
//
// Two bearer tokens: READ_TOKEN may only read; WRITE_TOKEN may read and write. CI gives pull
// requests the read token, so a PR can't put anything in the cache whatever its workflow says.
// Artifacts are HMAC-signed by turbo itself (`remoteCache.signature`); this Worker stores the
// `x-artifact-tag` signature next to the bytes and hands it back, it never sees the key.

/** The slice of the R2 binding this Worker uses (keeps the package free of Cloudflare types). */
export interface Bucket {
  head(key: string): Promise<StoredObject | null>;
  get(key: string): Promise<(StoredObject & { body: ReadableStream }) | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer,
    options: { customMetadata: Record<string, string> },
  ): Promise<unknown>;
}

export interface StoredObject {
  size: number;
  customMetadata?: Record<string, string>;
}

export interface Env {
  ARTIFACTS: Bucket;
  READ_TOKEN: string;
  WRITE_TOKEN: string;
}

type Access = "read" | "write";

// turbo hashes are 16 hex chars; allow a little room, never a slash or a dot.
const HASH = /^[A-Za-z0-9_-]{1,128}$/;
const TEAM = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BYTES = 95 * 1024 * 1024; // under the Workers request-body limit (100 MB)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const error = (status: number, code: string, message: string) =>
  json({ code, message, error: { code, message } }, status);

/** Constant-time string compare, so a token can't be guessed byte by byte from timings. */
function same(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function access(request: Request, env: Env): Access | null {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (same(token, env.WRITE_TOKEN)) return "write";
  if (same(token, env.READ_TOKEN)) return "read";
  return null;
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (!path.startsWith("/v8/artifacts")) return error(404, "not_found", "Not found");

  const granted = access(request, env);
  if (!granted) return error(401, "unauthorized", "Missing or invalid token");

  if (path === "/v8/artifacts/status" && request.method === "GET") {
    return json({ status: "enabled" });
  }
  // Usage events: turbo sends hit/miss telemetry; accept and drop it.
  if (path === "/v8/artifacts/events" && request.method === "POST") {
    return json({});
  }

  const team = url.searchParams.get("teamId") ?? url.searchParams.get("slug") ?? "default";
  if (!TEAM.test(team)) return error(400, "bad_request", "Invalid team");

  // Batch lookup: { hashes: [...] } → { [hash]: { size, taskDurationMs, tag } | null }
  if (path === "/v8/artifacts" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as { hashes?: unknown } | null;
    const hashes = Array.isArray(body?.hashes) ? body.hashes : null;
    if (
      !hashes ||
      hashes.length > 100 ||
      !hashes.every((h) => typeof h === "string" && HASH.test(h))
    ) {
      return error(400, "bad_request", "Expected { hashes: string[] } (at most 100)");
    }
    const entries = await Promise.all(
      hashes.map(async (hash: string) => {
        const object = await env.ARTIFACTS.head(`${team}/${hash}`);
        return [hash, object ? describe(object) : null] as const;
      }),
    );
    return json(Object.fromEntries(entries));
  }

  const hash = path.slice("/v8/artifacts/".length);
  if (!path.startsWith("/v8/artifacts/") || !HASH.test(hash)) {
    return error(404, "not_found", "Not found");
  }
  const key = `${team}/${hash}`;

  switch (request.method) {
    case "HEAD": {
      const object = await env.ARTIFACTS.head(key);
      return new Response(null, {
        status: object ? 200 : 404,
        headers: object ? headers(object) : {},
      });
    }
    case "GET": {
      const object = await env.ARTIFACTS.get(key);
      if (!object) return error(404, "not_found", "Artifact not found");
      return new Response(object.body, {
        headers: { ...headers(object), "content-type": "application/octet-stream" },
      });
    }
    case "PUT": {
      if (granted !== "write") return error(403, "forbidden", "This token is read-only");
      const length = Number(request.headers.get("content-length") ?? Number.NaN);
      if (!Number.isFinite(length)) return error(411, "length_required", "Content-Length required");
      if (length > MAX_BYTES) return error(413, "too_large", "Artifact too large");
      if (!request.body) return error(400, "bad_request", "Empty body");
      const customMetadata: Record<string, string> = {};
      const tag = request.headers.get("x-artifact-tag");
      const duration = request.headers.get("x-artifact-duration");
      if (tag) customMetadata.tag = tag.slice(0, 1024);
      if (duration && /^\d{1,12}$/.test(duration)) customMetadata.duration = duration;
      await env.ARTIFACTS.put(key, request.body, { customMetadata });
      return json({ urls: [`${url.origin}/v8/artifacts/${hash}`] }, 202);
    }
    default:
      return error(405, "method_not_allowed", "Method not allowed");
  }
}

function headers(object: StoredObject): Record<string, string> {
  const out: Record<string, string> = { "content-length": String(object.size) };
  if (object.customMetadata?.tag) out["x-artifact-tag"] = object.customMetadata.tag;
  if (object.customMetadata?.duration) out["x-artifact-duration"] = object.customMetadata.duration;
  return out;
}

function describe(object: StoredObject) {
  return {
    size: object.size,
    taskDurationMs: Number(object.customMetadata?.duration ?? 0),
    tag: object.customMetadata?.tag,
  };
}

export default { fetch: handle };
