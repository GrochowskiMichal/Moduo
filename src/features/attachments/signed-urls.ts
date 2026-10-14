// Signed links are minted in batches and reused until a minute before they
// expire, so re-rendering or reopening a task doesn't re-sign every thumbnail
// (previews 1 h, originals 10 min: spec decision 11).

import type { ModuoRuntime } from "@/lib/runtime.types";

type Entry = { url: string; expiresAt: number };

const cache = new Map<string, Entry>();
const MARGIN_MS = 60_000;

export async function signPaths(
  runtime: Pick<ModuoRuntime, "attachments">,
  paths: string[],
  ttlSeconds: number,
  now: () => number = Date.now,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missing: string[] = [];
  for (const path of new Set(paths)) {
    const hit = cache.get(path);
    if (hit && hit.expiresAt - MARGIN_MS > now()) out.set(path, hit.url);
    else missing.push(path);
  }
  if (missing.length > 0) {
    const signed = await runtime.attachments.signedUrls(missing, ttlSeconds);
    const expiresAt = now() + ttlSeconds * 1000;
    for (const [path, url] of signed) {
      cache.set(path, { url, expiresAt });
      out.set(path, url);
    }
  }
  return out;
}

/** Tests only. */
export function clearSignedUrlCache(): void {
  cache.clear();
}
