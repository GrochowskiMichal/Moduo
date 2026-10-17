#!/usr/bin/env bun
// Compare moduo.app's DNS on Vercel with the Cloudflare zone before the nameserver change
// (specs/platform-v2.md, PLAT-8: AC14). Zero differences is the gate for switching nameservers.
//
//   bun scripts/dns-diff.ts                 # record diff (APIs) + live diff (both nameserver sets)
//   bun scripts/dns-diff.ts --sync          # also create on Cloudflare what only Vercel has
//   bun scripts/dns-diff.ts --live-only     # skip the APIs; compare the authoritative answers
//
// Env: VERCEL_TOKEN (+ VERCEL_TEAM_ID when the domain sits in a team), CLOUDFLARE_API_TOKEN
// (Zone: Read + DNS: Read, or DNS: Edit for --sync). DNS_DIFF_DOMAIN overrides moduo.app.
//
// Two checks, because neither is enough alone:
// 1. Records: every record Vercel lists (GET /v5/domains/<d>/records) against Cloudflare's
//    (GET /zones/<id>/dns_records). TTL is ignored (Cloudflare "auto" vs Vercel 60). Vercel's
//    ALIAS is Cloudflare's flattened CNAME. Records Vercel serves without listing them (the hosts
//    attached to a Vercel project) are what check 2 catches.
// 2. Live: `dig` each name from both lists (plus the mail names that matter and a random label
//    for the wildcard) straight at ns1.vercel-dns.com and at the zone's Cloudflare nameservers, per
//    type, and compare the answers. Vercel's anycast addresses rotate per query, so any address
//    in VERCEL_ANYCAST compares as the token "vercel-anycast".
// Prints a Markdown report and exits 1 on any difference.

export type Rec = { name: string; type: string; value: string };
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const DOMAIN = process.env.DNS_DIFF_DOMAIN ?? "moduo.app";
export const LIVE_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "CAA", "SRV", "NS"] as const;
/** Names that must survive exactly even if neither API lists them (mail, DKIM, verification). */
export const MUST_CHECK = [
  "",
  "www",
  "_dmarc",
  "send",
  "resend._domainkey",
  "hostingermail-a._domainkey",
  "hostingermail-b._domainkey",
  "hostingermail-c._domainkey",
  "autodiscover",
  "autoconfig",
  "mail",
];
export const WILDCARD_PROBE = "dns-diff-wildcard-probe";
// Vercel's edge ranges (A answers for hosts on a Vercel project, and cname.vercel-dns.com).
const VERCEL_ANYCAST = [/^216\.198\.79\.\d+$/, /^64\.29\.17\.\d+$/, /^76\.76\.21\.\d+$/];

/** Records each provider manages for itself (Domain Connect discovery); never ours to copy. */
export const providerOwned = (name: string) => /^_domainconnect\./.test(name);

const host = (s: string) => s.trim().toLowerCase().replace(/\.$/, "");

/** `"v=spf1 " "a ~all"` → `v=spf1 a ~all`; a bare value is kept as is. */
export function unquoteTxt(s: string): string {
  const parts = [...s.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, "$1"));
  return parts.length ? parts.join("") : s.trim();
}

/** One comparable string per type, so both providers' spellings meet. */
export function normalizeValue(type: string, value: string): string {
  const v = value.trim();
  switch (type) {
    case "A":
      return VERCEL_ANYCAST.some((re) => re.test(v)) ? "vercel-anycast" : v;
    case "AAAA":
      return v.toLowerCase();
    case "CNAME":
    case "NS":
      return host(v);
    case "MX": {
      const [prio, target] = v.split(/\s+/);
      return `${Number(prio)} ${host(target ?? "")}`;
    }
    case "TXT":
      return unquoteTxt(v);
    case "CAA": {
      const [flags, tag, ...rest] = v.split(/\s+/);
      return `${Number(flags)} ${tag.toLowerCase()} "${unquoteTxt(rest.join(" "))}"`;
    }
    case "SRV": {
      const [p, w, port, target] = v.split(/\s+/);
      return `${Number(p)} ${Number(w)} ${Number(port)} ${host(target ?? "")}`;
    }
    default:
      return v;
  }
}

export const fqdn = (label: string, domain = DOMAIN) =>
  label === "" || label === "@"
    ? domain
    : host(label).endsWith(domain)
      ? host(label)
      : `${host(label)}.${domain}`;

function rec(name: string, type: string, value: string): Rec {
  const t = type === "ALIAS" ? "CNAME" : type.toUpperCase();
  return { name: host(name), type: t, value: normalizeValue(t, value) };
}

type VercelRecord = {
  name: string;
  type: string;
  value: string;
  mxPriority?: number;
  srv?: { priority: number; weight: number; port: number; target: string };
};

export function fromVercel(records: VercelRecord[], domain = DOMAIN): Rec[] {
  return records.map((r) => {
    const name = fqdn(r.name, domain);
    if (r.type === "MX") return rec(name, "MX", `${r.mxPriority ?? 0} ${r.value}`);
    if (r.type === "SRV" && r.srv)
      return rec(name, "SRV", `${r.srv.priority} ${r.srv.weight} ${r.srv.port} ${r.srv.target}`);
    return rec(name, r.type, r.value);
  });
}

type CloudflareRecord = {
  name: string;
  type: string;
  content: string;
  priority?: number;
  proxied?: boolean;
  data?: { flags?: number; tag?: string; value?: string };
};

/**
 * A proxied (orange-cloud) record answers with Cloudflare's addresses instead of its content, so a
 * proxied DKIM CNAME stops resolving to the key. A pending zone answers proxied records as plain
 * ones, so the live check can't see this before the switch: mark them here instead.
 */
export function fromCloudflare(records: CloudflareRecord[]): Rec[] {
  return records.map((r) => {
    const out = plainCloudflare(r);
    return r.proxied ? { ...out, value: `${out.value} [proxied]` } : out;
  });
}

function plainCloudflare(r: CloudflareRecord): Rec {
  if (r.type === "MX") return rec(r.name, "MX", `${r.priority ?? 0} ${r.content}`);
  if (r.type === "CAA" && r.data?.tag)
    return rec(r.name, "CAA", `${r.data.flags ?? 0} ${r.data.tag} "${r.data.value ?? ""}"`);
  return rec(r.name, r.type, r.content);
}

const key = (r: Rec) => `${r.name}\t${r.type}\t${r.value}`;

export type Diff = { onlyVercel: Rec[]; onlyCloudflare: Rec[] };

export function diff(vercel: Rec[], cloudflare: Rec[]): Diff {
  const v = new Map(vercel.map((r) => [key(r), r]));
  const c = new Map(cloudflare.map((r) => [key(r), r]));
  const sort = (a: Rec, b: Rec) => key(a).localeCompare(key(b));
  return {
    onlyVercel: [...v]
      .filter(([k]) => !c.has(k))
      .map(([, r]) => r)
      .sort(sort),
    onlyCloudflare: [...c]
      .filter(([k]) => !v.has(k))
      .map(([, r]) => r)
      .sort(sort),
  };
}

/** Answer lines of `dig +noall +answer` owned by `name` with `type` (drops CNAME-chain hops). */
export function parseDig(out: string, name: string, type: string): string[] {
  const want = host(name);
  const values = new Set<string>();
  for (const line of out.split("\n")) {
    const m = line.match(/^(\S+)\s+\d+\s+IN\s+(\S+)\s+(.*)$/);
    if (!m || host(m[1]) !== want || m[2] !== type) continue;
    values.add(normalizeValue(type, m[3]));
  }
  return [...values].sort();
}

async function dig(server: string, name: string, type: string): Promise<string[]> {
  const p = Bun.spawn([
    "dig",
    "+noall",
    "+answer",
    "+norecurse",
    "+time=3",
    "+tries=2",
    `@${server}`,
    name,
    type,
  ]);
  const out = await new Response(p.stdout).text();
  await p.exited;
  return parseDig(out, name, type);
}

export type LiveDiff = { name: string; type: string; vercel: string[]; cloudflare: string[] };

/**
 * Where a name sends web traffic. Vercel answers A for a host on a Vercel project (it flattens its
 * ALIAS and wildcard records); Cloudflare's DNS-only copy answers the CNAME to the same target. Both
 * end at Vercel, so a CNAME to a vercel-dns target counts as "vercel-anycast" too. Any other CNAME
 * (the Hostinger DKIM keys) stays exact.
 */
export function addresses(a: string[], cname: string[]): string[] {
  const viaVercel = cname.map((c) =>
    /(^|\.)vercel-dns(-\d+)?\.com$/.test(c) ? "vercel-anycast" : c,
  );
  return [...new Set([...a, ...viaVercel])].sort();
}

const caaIssuer = (v: string) => v.replace(/;.*"$/, '"').replace(/\s+"$/, '"');

/** Cloudflare adds its Universal SSL CAs to any CAA set (always on): extra CAs are fine, a missing one of ours is not. */
export function caaCovered(vercel: string[], cloudflare: string[]): boolean {
  const cf = new Set(cloudflare.map(caaIssuer));
  return vercel.every((v) => cf.has(caaIssuer(v)));
}

export async function liveDiff(
  names: string[],
  vercelNs: string,
  cloudflareNs: string,
  digFn = dig,
): Promise<LiveDiff[]> {
  const out: LiveDiff[] = [];
  const both = (q: string, type: string) =>
    Promise.all([digFn(vercelNs, q, type), digFn(cloudflareNs, q, type)]);
  for (const name of names) {
    if (providerOwned(name)) continue;
    const q = name.startsWith("*.") ? `${WILDCARD_PROBE}.${name.slice(2)}` : name;
    const [[va, ca], [vc, cc]] = await Promise.all([both(q, "A"), both(q, "CNAME")]);
    const [v, c] = [addresses(va, vc), addresses(ca, cc)];
    if (v.join("\n") !== c.join("\n"))
      out.push({ name, type: "A/CNAME", vercel: v, cloudflare: c });
    for (const type of LIVE_TYPES) {
      if (type === "A" || type === "CNAME") continue;
      if (type === "NS" && q === DOMAIN) continue; // the apex NS set is the one thing that differs
      const [v, c] = await both(q, type);
      if (v.join("\n") === c.join("\n")) continue;
      if (type === "CAA" && caaCovered(v, c)) continue;
      out.push({ name, type, vercel: v, cloudflare: c });
    }
  }
  return out;
}

async function json<T>(f: Fetch, url: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await f(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = (await res.json()) as T;
  if (!res.ok)
    throw new Error(
      `${init.method ?? "GET"} ${url.replace(/\?.*/, "")}: ${res.status} ${JSON.stringify(body)}`,
    );
  return body;
}

export async function vercelRecords(
  token: string,
  teamId?: string,
  f: Fetch = fetch,
): Promise<VercelRecord[]> {
  const all: VercelRecord[] = [];
  let until: number | null | undefined;
  do {
    const q = new URLSearchParams({ limit: "100" });
    if (teamId) q.set("teamId", teamId);
    if (until) q.set("until", String(until));
    const page = await json<{ records: VercelRecord[]; pagination?: { next: number | null } }>(
      f,
      `https://api.vercel.com/v5/domains/${DOMAIN}/records?${q}`,
      token,
    );
    all.push(...page.records);
    until = page.pagination?.next;
  } while (until);
  return all;
}

const CF = "https://api.cloudflare.com/client/v4";

export async function cloudflareZone(token: string, f: Fetch = fetch) {
  const z = await json<{ result: { id: string; status: string; name_servers: string[] }[] }>(
    f,
    `${CF}/zones?name=${DOMAIN}`,
    token,
  );
  if (!z.result.length)
    throw new Error(`No Cloudflare zone named ${DOMAIN}: add it in the dashboard first.`);
  return z.result[0];
}

export async function cloudflareRecords(token: string, zoneId: string, f: Fetch = fetch) {
  const all: CloudflareRecord[] = [];
  for (let page = 1; ; page++) {
    const r = await json<{ result: CloudflareRecord[]; result_info: { total_pages: number } }>(
      f,
      `${CF}/zones/${zoneId}/dns_records?per_page=500&page=${page}`,
      token,
    );
    all.push(...r.result);
    if (page >= r.result_info.total_pages) break;
  }
  return all;
}

/** The Cloudflare create body for a record Vercel has. DNS-only: the copy answers as Vercel does. */
export function cloudflareBody(r: Rec): Record<string, unknown> {
  const base = { name: r.name, type: r.type, ttl: 1, proxied: false };
  if (r.type === "MX") {
    const [prio, target] = r.value.split(" ");
    return { ...base, content: target, priority: Number(prio) };
  }
  if (r.type === "CAA") {
    const m = r.value.match(/^(\d+) (\S+) "(.*)"$/);
    return { ...base, data: { flags: Number(m?.[1]), tag: m?.[2], value: m?.[3] } };
  }
  if (r.type === "TXT") return { ...base, content: `"${r.value.replace(/"/g, '\\"')}"` };
  if (r.type === "A" && r.value === "vercel-anycast")
    throw new Error(
      `${r.name} A points at Vercel's anycast; add it as CNAME cname.vercel-dns.com by hand.`,
    );
  return { ...base, content: r.value };
}

const fmt = (r: Rec) => `| ${r.name} | ${r.type} | \`${r.value.replace(/\|/g, "\\|")}\` |`;

export function report(
  d: Diff | null,
  live: LiveDiff[] | null,
  ns: { vercel: string; cloudflare: string },
): string {
  const lines = [
    `**DNS diff · ${DOMAIN}** (Vercel \`${ns.vercel}\` vs Cloudflare \`${ns.cloudflare}\`)`,
    "",
  ];
  if (d) {
    lines.push(
      `Records: ${d.onlyVercel.length} only on Vercel, ${d.onlyCloudflare.length} only on Cloudflare.`,
    );
    for (const [title, rs] of [
      ["Only on Vercel", d.onlyVercel],
      ["Only on Cloudflare", d.onlyCloudflare],
    ] as const) {
      if (!rs.length) continue;
      lines.push(
        "",
        `${title}:`,
        "",
        "| Name | Type | Value |",
        "| --- | --- | --- |",
        ...rs.map(fmt),
      );
    }
    lines.push("");
  }
  if (live) {
    lines.push(`Live answers: ${live.length} difference(s).`);
    if (live.length) {
      lines.push(
        "",
        "| Name | Type | Vercel answers | Cloudflare answers |",
        "| --- | --- | --- | --- |",
      );
      for (const l of live)
        lines.push(
          `| ${l.name} | ${l.type} | ${l.vercel.join("<br>") || "—"} | ${l.cloudflare.join("<br>") || "—"} |`,
        );
    }
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const args = new Set(process.argv.slice(2));
  const liveOnly = args.has("--live-only");
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  const vToken = process.env.VERCEL_TOKEN;
  if (!cfToken || (!liveOnly && !vToken)) {
    console.error(
      "Set CLOUDFLARE_API_TOKEN and VERCEL_TOKEN (VERCEL_TEAM_ID too if the domain is in a team).",
    );
    process.exit(2);
  }
  const zone = await cloudflareZone(cfToken);
  const ns = { vercel: "ns1.vercel-dns.com", cloudflare: zone.name_servers[0] };
  let d: Diff | null = null;
  let names = MUST_CHECK.map((l) => fqdn(l));
  names.push(`*.${DOMAIN}`);
  if (!liveOnly && vToken) {
    const v = fromVercel(await vercelRecords(vToken, process.env.VERCEL_TEAM_ID));
    let c = fromCloudflare(await cloudflareRecords(cfToken, zone.id));
    // Apex NS records are each provider's own; never compare them.
    const own = (r: Rec) => !(r.type === "NS" && r.name === DOMAIN) && !providerOwned(r.name);
    d = diff(v.filter(own), c.filter(own));
    if (args.has("--sync") && d.onlyVercel.length) {
      for (const r of d.onlyVercel) {
        await json(fetch, `${CF}/zones/${zone.id}/dns_records`, cfToken, {
          method: "POST",
          body: JSON.stringify(cloudflareBody(r)),
        });
        console.error(`created ${r.type} ${r.name}`);
      }
      c = fromCloudflare(await cloudflareRecords(cfToken, zone.id));
      d = diff(v.filter(own), c.filter(own));
    }
    names.push(...v.map((r) => r.name), ...c.map((r) => r.name));
  }
  names = [...new Set(names)].sort();
  const live = await liveDiff(names, ns.vercel, ns.cloudflare);
  console.log(report(d, live, ns));
  const clean = (!d || (!d.onlyVercel.length && !d.onlyCloudflare.length)) && !live.length;
  process.exit(clean ? 0 : 1);
}
