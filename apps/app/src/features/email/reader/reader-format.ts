// Small formatters for the reader's chips, who-card and to-lines (specs/mail-v3.md §8):
// "reminds Thu", "Returns Mon 9:00", "to you, Dana".

const DAY = 86_400_000;

function midnight(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "today", "Thu" within a week either side, else "6 Nov". */
export function shortDay(ms: number, nowMs: number): string {
  const days = Math.round((midnight(ms) - midnight(nowMs)) / DAY);
  const d = new Date(ms);
  if (days === 0) return "today";
  if (Math.abs(days) < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "9:00", 24-hour, no leading zero on the hour. */
export function clock(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "Mon 9:00" (or "today 18:00"). */
export function dayTime(ms: number, nowMs: number): string {
  return `${shortDay(ms, nowMs)} ${clock(ms)}`;
}

export type Person = { name: string; email: string };

/** The first word of a display name, else the address's local part. */
export function firstName(p: Person): string {
  const name = p.name.trim();
  if (name) return name.split(/\s+/)[0]!;
  return p.email.split("@")[0] ?? p.email;
}

/** A message's recipients without its sender, each once; your own addresses read "you". */
export function recipientsOf(
  message: { from: Person; to: Person[]; cc: Person[] },
  self: ReadonlySet<string>,
): { person: Person; you: boolean }[] {
  const seen = new Set<string>();
  const sender = message.from.email.toLowerCase();
  const out: { person: Person; you: boolean }[] = [];
  for (const p of [...message.to, ...message.cc]) {
    const key = p.email.trim().toLowerCase();
    if (!key || seen.has(key) || key === sender) continue;
    seen.add(key);
    out.push({ person: p, you: self.has(key) });
  }
  // "to you, Dana": you first.
  return out.sort((a, b) => Number(b.you) - Number(a.you));
}

/** "you, Dana" (short) or "Robin <robin@x.com>, Dana <dana@y.com>" (addresses shown). */
export function toLine(recipients: { person: Person; you: boolean }[], addresses: boolean): string {
  if (recipients.length === 0) return "undisclosed recipients";
  return recipients
    .map(({ person, you }) => {
      if (addresses) return person.name ? `${person.name} <${person.email}>` : person.email;
      return you ? "you" : firstName(person);
    })
    .join(", ");
}

/** True while the app draws in its dark theme (the default; `data-theme="light"` opts out). */
export function isDarkTheme(): boolean {
  if (typeof document === "undefined") return true;
  return document.documentElement.dataset.theme !== "light";
}
