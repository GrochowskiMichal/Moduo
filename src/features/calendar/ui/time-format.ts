// Locale-aware time formatters for the grid chrome. Intl.DateTimeFormat
// construction is expensive (~0.1–1ms) and the grid calls these per chip per
// render — the instances are cached at module level (the tasks/helpers
// pattern) and hour labels are memoized over their 24-value domain.

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const HOUR_FMT = new Intl.DateTimeFormat(undefined, { hour: "numeric" });

const hourLabelCache = new Map<number, string>();

/** "9 AM" / "14" — the hour-gutter label. */
export function formatHourLabel(hour: number): string {
  const cached = hourLabelCache.get(hour);
  if (cached !== undefined) return cached;
  const label = HOUR_FMT.format(new Date(2000, 0, 1, hour));
  hourLabelCache.set(hour, label);
  return label;
}

/** "9:00 AM" — chip time readouts, from a real instant. */
export function formatTimeOfDay(ms: number): string {
  return TIME_FMT.format(ms);
}
