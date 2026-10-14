// Wall clocks in an IANA zone, for engines that compute in "floating" time
// (rrule.js reads every date as UTC). `toFloating` writes an instant's wall
// clock in the zone as a UTC Date; `fromFloating` reads such a Date back as
// the instant it names in the zone. The server does the same
// (tasks__floating / tasks__unfloating, TV-D12), so a 9:00 repeat stays at
// 9:00 across a daylight-saving change on both sides.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(zone);
  if (cached) return cached;
  try {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, f);
    return f;
  } catch {
    return null;
  }
}

function isUtc(zone: string | null | undefined): boolean {
  return !zone || zone === "UTC" || zone === "Etc/UTC" || zone === "GMT";
}

/** The instant's wall clock in `zone`, as a UTC Date (milliseconds kept). */
export function toFloating(at: Date, zone: string | null | undefined): Date {
  if (isUtc(zone)) return new Date(at.getTime());
  const f = formatter(zone as string);
  if (!f) return new Date(at.getTime());
  const parts: Record<string, number> = {};
  for (const p of f.formatToParts(at)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return new Date(
    Date.UTC(
      parts.year ?? 1970,
      (parts.month ?? 1) - 1,
      parts.day ?? 1,
      parts.hour ?? 0,
      parts.minute ?? 0,
      parts.second ?? 0,
      at.getUTCMilliseconds(),
    ),
  );
}

const DAY_MS = 86_400_000;

function offsetAt(ms: number, zone: string): number {
  return toFloating(new Date(ms), zone).getTime() - ms;
}

/**
 * The instant a floating Date names in `zone`, resolved the way Postgres's
 * `timestamp AT TIME ZONE` does: a wall clock that happens twice (clocks go
 * back) is the later instant; one skipped (clocks go forward) reads with the
 * offset from before the change.
 */
export function fromFloating(floating: Date, zone: string | null | undefined): Date {
  if (isUtc(zone)) return new Date(floating.getTime());
  const target = floating.getTime();
  const before = target - offsetAt(target - DAY_MS, zone as string);
  const after = target - offsetAt(target + DAY_MS, zone as string);
  const fits = (ms: number) => toFloating(new Date(ms), zone).getTime() === target;
  const okBefore = fits(before);
  const okAfter = fits(after);
  if (okBefore && okAfter) return new Date(Math.max(before, after));
  if (okAfter) return new Date(after);
  return new Date(before);
}
