/**
 * Shared Edge Function helper: who is calling, for the per-IP rate limits on
 * the public endpoints (waitlist-join, booking-public).
 *
 * Read `cf-connecting-ip` first. Every request reaches a function through
 * Cloudflare, which sets it to the address that actually connected and refuses
 * any request that arrives already carrying one (error 1000), so a caller
 * can't choose it. `x-forwarded-for` is only the fallback: when probed on
 * 2026-10-08, Supabase's gateway rebuilt it and dropped a forged value, but
 * that is undocumented gateway behaviour, and a 2025 report shows the forged
 * value kept. `x-real-ip` never reaches the function. docs/gotchas/supabase.md
 *
 * IPv6 callers are keyed by their /64, the block a single subscriber or server
 * gets, so cycling addresses inside it doesn't buy fresh buckets.
 */

/** The rate-limit key for this request's caller, or "unknown" if the platform sent no address. */
export function clientIp(req: Pick<Request, "headers">): string {
  let ip = req.headers.get("cf-connecting-ip")?.trim().toLowerCase();
  if (!ip) {
    ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim().toLowerCase();
    if (!ip) return "unknown";
    console.warn("[client-ip] no cf-connecting-ip; falling back to x-forwarded-for");
  }
  return ip.includes(":") ? (ipv6Key(ip) ?? ip) : ip;
}

/** An IPv4-mapped address as dotted IPv4, any other IPv6 address as its /64; null if unparseable. */
function ipv6Key(ip: string): string | null {
  const groups = ipv6Groups(ip.split("%")[0]);
  if (!groups) return null;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

/** The eight 16-bit groups of an IPv6 address, expanding `::` and a dotted IPv4 tail. */
function ipv6Groups(addr: string): number[] | null {
  let text = addr;
  const dotted = text.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(2).map(Number);
    if ([a, b, c, d].some((o) => o > 255)) return null;
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const gap = 8 - head.length - tail.length;
  if (halves.length === 1 ? gap !== 0 : gap < 1) return null;

  const parts = [...head, ...Array<string>(halves.length === 2 ? gap : 0).fill("0"), ...tail];
  if (!parts.every((p) => /^[0-9a-f]{1,4}$/.test(p))) return null;
  return parts.map((p) => Number.parseInt(p, 16));
}
