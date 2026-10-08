// Pure view logic for the My tasks panel: no `$`, no network, so tests cover it directly.

import type { Bucket, Filter, Group, QueueCard, Row, Task, ViewModel } from "../types";

const DAY_MS = 86_400_000;

/** The calendar day at `nowMs` in `timeZone` as YYYY-MM-DD (the person's "today", never UTC's). */
export function localDate(nowMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The time zone to read "today" in: the setting when it names a valid zone, else the host's. */
export function resolveTimeZone(setting: string | undefined): string {
  const wanted = (setting ?? "").trim();
  if (wanted) {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: wanted });
      return wanted;
    } catch {
      // An unknown zone name falls through to the host's zone.
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * Text that came from Moduo (titles, bucket names) is other people's input drawn on a
 * terminal: drop control characters and bidi overrides so it can't inject escape sequences.
 */
export function clean(text: string | null | undefined): string {
  let out = "";
  for (const ch of text ?? "") {
    const c = ch.codePointAt(0) ?? 0;
    const isControl = c < 0x20 || (c >= 0x7f && c <= 0x9f);
    const isBidi = (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
    if (c === 0x0a || c === 0x09 || c === 0x0d) out += " ";
    else if (!isControl && !isBidi) out += ch;
  }
  return out;
}

/** Whole local calendar days between two instants (0 = the same local day). */
function localDaysBetween(fromMs: number, toMs: number, timeZone: string): number {
  const day = (ms: number) => Date.parse(`${localDate(ms, timeZone)}T00:00:00Z`);
  return Math.round((day(toMs) - day(fromMs)) / DAY_MS);
}

function metaOf(t: Task, nowMs: number, timeZone: string): { meta: string; tone: Row["tone"] } {
  const bits: string[] = [];
  let tone: Row["tone"] = "plain";
  if (t.drifted) {
    const d = t.scheduled_at ? localDaysBetween(Date.parse(t.scheduled_at), nowMs, timeZone) : 0;
    bits.push(d <= 0 ? "drifting" : `drifting ${d} ${d === 1 ? "day" : "days"}`);
    tone = "drift";
  }
  if (t.blocked) {
    bits.push("blocked");
    if (tone === "plain") tone = "blocked";
  }
  if (t.duration_minutes) bits.push(`${t.duration_minutes} min`);
  if (t.recurrence) bits.push("repeats");
  return { meta: bits.join(" · "), tone };
}

/** The person's own user id, read off a list fetched with assignee "me". */
export function ownerOf(mine: Task[]): string | null {
  return mine.find((t) => t.assignee_id)?.assignee_id ?? null;
}

/**
 * Builds the panel: open tasks grouped by bucket in the app's bucket order, today's queue
 * and "Done today" (today's queue items already done).
 * Queue numbers are positions in the whole day's queue, as the app shows them; under "me"
 * only the person's own items are listed, and nothing when their id is not known yet.
 */
export function buildView(
  tasks: Task[],
  buckets: Bucket[],
  todayQueue: Task[],
  filter: Filter,
  ownerId: string | null,
  nowMs: number,
  timeZone: string,
): ViewModel {
  const ordered = [...todayQueue].sort((a, b) => (a.commit_order ?? 0) - (b.commit_order ?? 0));
  const openAll = ordered.filter((t) => t.status !== "done" && t.status !== "archived");
  const position = new Map(openAll.map((t, i) => [t.id, i + 1]));
  const isShown = (t: Task) =>
    filter === "anyone" || (ownerId !== null && t.assignee_id === ownerId);
  const queue: QueueCard[] = openAll.filter(isShown).map((t) => ({
    id: t.id,
    pos: position.get(t.id) ?? 0,
    title: clean(t.title),
    minutes: t.duration_minutes ?? null,
  }));
  const timed = queue.filter((c) => c.minutes != null);
  const plannedMinutes = timed.length ? timed.reduce((sum, c) => sum + (c.minutes ?? 0), 0) : null;
  const doneToday = ordered
    .filter((t) => t.status === "done" && isShown(t))
    .map((t) => ({ id: t.id, title: clean(t.title) }));

  const byBucket = new Map<string, Row[]>();
  let drifting = 0;
  for (const t of tasks) {
    const { meta, tone } = metaOf(t, nowMs, timeZone);
    if (t.drifted) drifting += 1;
    const key = t.bucket_id ?? "";
    const rows = byBucket.get(key) ?? [];
    rows.push({
      id: t.id,
      title: clean(t.title),
      meta,
      tone,
      subtasks: t.subtask_count ?? 0,
      queuePos: position.get(t.id) ?? null,
    });
    byBucket.set(key, rows);
  }
  const groups: Group[] = [];
  for (const b of buckets) {
    const rows = byBucket.get(b.id);
    if (rows?.length) groups.push({ id: b.id, name: clean(b.name), rows });
    byBucket.delete(b.id);
  }
  const rest = [...byBucket.values()].flat();
  if (rest.length) groups.push({ id: "other", name: "Other", rows: rest });

  return { groups, queue, doneToday, plannedMinutes, drifting, total: tasks.length };
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")} min` : `${h} h`;
}
