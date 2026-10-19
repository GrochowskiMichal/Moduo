// Desktop update server on a Cloudflare Worker: the Tauri updater endpoint and the installer
// downloads, both read from the R2 bucket `moduo-releases`. The entry is ./index.ts.
//
// R2 layout (written by .github/workflows/_desktop-release.yml):
//   desktop/<channel>/<version>/<file>   installers, updater bundles, .sig files and that
//                                        version's latest.json; written once, never overwritten
//   desktop/<channel>/latest.json        the channel's current manifest; written last, after
//                                        every file it points at is in place
//
// Rollout and kill switch live in Workers KV under `channel:<channel>`, as JSON
// {"rollout": 0-100, "paused": false}, so they change without a rebuild (desktop-rollout.yml).
// No key means everyone gets the update. A value that doesn't parse counts as paused: a typo
// in the kill switch must not ship an update.

/** The slice of the R2 binding this Worker uses (keeps the package free of Cloudflare types). */
export interface Bucket {
  get(key: string): Promise<StoredObject | null>;
  head(key: string): Promise<Omit<StoredObject, "body" | "text"> | null>;
}

export interface StoredObject {
  size: number;
  httpEtag: string;
  body: ReadableStream;
  text(): Promise<string>;
}

export interface Store {
  get(key: string): Promise<string | null>;
}

export interface Env {
  RELEASES: Bucket;
  UPDATE_CONFIG: Store;
}

export const CHANNELS = ["staging", "production"] as const;
export type Channel = (typeof CHANNELS)[number];

/** The anonymous, per-install id the desktop app sends (apps/desktop/src-tauri/src/install_id.rs). */
export const INSTALL_ID_HEADER = "moduo-install-id";

export interface ChannelConfig {
  rollout: number;
  paused: boolean;
}

interface Platform {
  signature: string;
  url: string;
}

interface Manifest {
  version: string;
  notes?: string;
  pub_date?: string;
  platforms: Record<string, Platform>;
}

const TARGET = /^(darwin|windows|linux)$/;
const ARCH = /^(aarch64|x86_64|i686|armv7)$/;
const INSTALL_ID = /^[A-Za-z0-9-]{8,64}$/;
const FILE = /^[A-Za-z0-9._-]{1,128}$/;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

const DEFAULT_CONFIG: ChannelConfig = { rollout: 100, paused: false };
const PAUSED: ChannelConfig = { rollout: 0, paused: true };

const isChannel = (value: string): value is Channel =>
  (CHANNELS as readonly string[]).includes(value);

const noUpdate = () =>
  new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const notFound = () => json({ error: "not_found" }, 404);

/** Semver precedence: -1, 0 or 1. Build metadata is ignored; null when either side isn't semver. */
export function compareVersions(a: string, b: string): number | null {
  const x = SEMVER.exec(a);
  const y = SEMVER.exec(b);
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return Math.sign(d);
  }
  const pa = x[4]?.split(".");
  const pb = y[4]?.split(".");
  if (!pa && !pb) return 0;
  if (!pa) return 1; // a release outranks its pre-releases
  if (!pb) return -1;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const ia = pa[i];
    const ib = pb[i];
    if (ia === undefined) return -1;
    if (ib === undefined) return 1;
    const na = /^\d+$/.test(ia);
    const nb = /^\d+$/.test(ib);
    if (na && nb) {
      const d = Number(ia) - Number(ib);
      if (d !== 0) return Math.sign(d);
    } else if (na !== nb) {
      return na ? -1 : 1; // numeric identifiers sort before alphanumeric ones
    } else if (ia !== ib) {
      return ia < ib ? -1 : 1;
    }
  }
  return 0;
}

/** Reads a channel's rollout settings. Missing → everyone; unparseable → paused. */
export function parseConfig(raw: string | null): ChannelConfig {
  if (raw === null) return DEFAULT_CONFIG;
  try {
    const value = JSON.parse(raw) as Partial<ChannelConfig>;
    if (typeof value !== "object" || value === null) return PAUSED;
    const rollout = value.rollout ?? 100;
    const paused = value.paused ?? false;
    if (typeof rollout !== "number" || !Number.isFinite(rollout) || typeof paused !== "boolean") {
      return PAUSED;
    }
    return { rollout: Math.min(100, Math.max(0, rollout)), paused };
  } catch {
    return PAUSED;
  }
}

/**
 * The install's rollout bucket for a version, 0–99. Salted with the version, so each release
 * samples a different first cohort, while one install keeps its answer for a given release.
 */
export async function rolloutBucket(seed: string, version: string): Promise<number> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${version}:${seed}`),
  );
  return new DataView(digest).getUint32(0) % 100;
}

/**
 * Who this request is, for bucketing. Builds with PLAT-6's Rust change send an install id; a build
 * without it (a production build that predates the change) falls back to the connecting
 * IP, hashed with the version and never stored.
 */
function rolloutSeed(request: Request): string {
  const id = request.headers.get(INSTALL_ID_HEADER) ?? "";
  if (INSTALL_ID.test(id)) return `install:${id}`;
  return `ip:${request.headers.get("cf-connecting-ip") ?? ""}`;
}

const usable = (platform: Platform | undefined): platform is Platform =>
  Boolean(platform?.url && platform.signature);

function isManifest(value: unknown): value is Manifest {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Manifest;
  return typeof m.version === "string" && typeof m.platforms === "object" && m.platforms !== null;
}

async function checkForUpdate(
  request: Request,
  env: Env,
  channel: Channel,
  target: string,
  arch: string,
  currentVersion: string,
): Promise<Response> {
  if (!TARGET.test(target) || !ARCH.test(arch)) return notFound();
  if (!SEMVER.test(currentVersion)) return json({ error: "bad_version" }, 400);

  const config = parseConfig(await env.UPDATE_CONFIG.get(`channel:${channel}`));
  if (config.paused || config.rollout <= 0) return noUpdate();

  const object = await env.RELEASES.get(`desktop/${channel}/latest.json`);
  if (!object) return noUpdate();
  let manifest: unknown;
  try {
    manifest = JSON.parse(await object.text());
  } catch {
    return noUpdate();
  }
  if (!isManifest(manifest)) return noUpdate();

  // Macs get their arch's own bundle (REL-5); a release without the asked key offers nothing.
  const platform = manifest.platforms[`${target}-${arch}`];
  if (!usable(platform)) return noUpdate();
  if (compareVersions(manifest.version, currentVersion) !== 1) return noUpdate();

  if (config.rollout < 100) {
    const bucket = await rolloutBucket(rolloutSeed(request), manifest.version);
    if (bucket >= config.rollout) return noUpdate();
  }

  return json({
    version: manifest.version,
    notes: manifest.notes ?? "",
    pub_date: manifest.pub_date,
    url: platform.url,
    signature: platform.signature,
  });
}

const CONTENT_TYPES: Record<string, string> = {
  ".dmg": "application/x-apple-diskimage",
  ".exe": "application/vnd.microsoft.portable-executable",
  ".gz": "application/gzip",
  ".json": "application/json",
  ".sig": "text/plain; charset=utf-8",
};

async function download(
  request: Request,
  env: Env,
  channel: Channel,
  version: string,
  file: string,
): Promise<Response> {
  if (!SEMVER.test(version) || !FILE.test(file) || file.startsWith(".")) return notFound();
  const key = `desktop/${channel}/${version}/${file}`;
  const ext = file.slice(file.lastIndexOf("."));
  const head = request.method === "HEAD";
  const object = head ? await env.RELEASES.head(key) : await env.RELEASES.get(key);
  if (!object) return notFound();
  const headers = new Headers({
    "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
    "content-length": String(object.size),
    etag: object.httpEtag,
    // Versioned paths are written once and never change.
    "cache-control": "public, max-age=31536000, immutable",
  });
  if (ext === ".dmg" || ext === ".exe") {
    headers.set("content-disposition", `attachment; filename="${file}"`);
    console.log(JSON.stringify({ event: "download", channel, version, file }));
  }
  return new Response(head ? null : (object as StoredObject).body, { headers });
}

export async function handle(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  }
  const url = new URL(request.url);
  let parts: string[];
  try {
    parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return notFound();
  }

  if (parts.length === 1 && parts[0] === "health") return json({ ok: true });

  // /desktop/<channel>/latest.json: the channel's current manifest, for CI and for people.
  if (parts.length === 3 && parts[0] === "desktop" && parts[2] === "latest.json") {
    const channel = parts[1]!;
    if (!isChannel(channel)) return notFound();
    const object = await env.RELEASES.get(`desktop/${channel}/latest.json`);
    if (!object) return notFound();
    return new Response(request.method === "HEAD" ? null : object.body, {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  // /desktop/<channel>/<target>/<arch>/<current_version> (Tauri's {{target}}/{{arch}}/{{current_version}})
  if (parts.length === 5 && parts[0] === "desktop") {
    const [, channel, target, arch, current] = parts as [string, string, string, string, string];
    if (!isChannel(channel)) return notFound();
    // Fail closed: an error here would be a 5xx, and the updater would then try its next
    // endpoint. "No update" is the safe answer when KV or R2 can't be read.
    try {
      return await checkForUpdate(request, env, channel, target, arch, current);
    } catch (err) {
      console.error(JSON.stringify({ event: "check_failed", channel, error: String(err) }));
      return noUpdate();
    }
  }

  // /download/desktop/<channel>/<version>/<file>
  if (parts.length === 5 && parts[0] === "download" && parts[1] === "desktop") {
    const [, , channel, version, file] = parts as [string, string, string, string, string];
    if (!isChannel(channel)) return notFound();
    return download(request, env, channel, version, file);
  }

  return notFound();
}
