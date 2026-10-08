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

function driftDays(t: Task, nowMs: number): number {
  if (!t.scheduled_at) return 1;
  return Math.max(1, Math.floor((nowMs - new Date(t.scheduled_at).getTime()) / DAY_MS));
}

function metaOf(t: Task, nowMs: number): { meta: string; tone: Row["tone"] } {
  const bits: string[] = [];
  let tone: Row["tone"] = "plain";
  if (t.drifted) {
    const d = driftDays(t, nowMs);
    bits.push(`drifting ${d} ${d === 1 ? "day" : "days"}`);
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
 * (open items, by queue order) and "Done today" (today's queue items already done).
 * `ownerId` narrows the queue to the person's own tasks when the filter is "me".
 */
export function buildView(
  tasks: Task[],
  buckets: Bucket[],
  todayQueue: Task[],
  filter: Filter,
  ownerId: string | null,
  nowMs: number,
): ViewModel {
  const queueSource =
    filter === "me" && ownerId ? todayQueue.filter((t) => t.assignee_id === ownerId) : todayQueue;
  const ordered = [...queueSource].sort((a, b) => (a.commit_order ?? 0) - (b.commit_order ?? 0));
  const openQueued = ordered.filter((t) => t.status !== "done" && t.status !== "archived");
  const queue: QueueCard[] = openQueued.map((t, i) => ({
    id: t.id,
    pos: i + 1,
    title: t.title,
    minutes: t.duration_minutes ?? null,
  }));
  const queuePos = new Map(queue.map((c) => [c.id, c.pos]));
  const timed = queue.filter((c) => c.minutes != null);
  const plannedMinutes = timed.length ? timed.reduce((sum, c) => sum + (c.minutes ?? 0), 0) : null;
  const doneToday = ordered
    .filter((t) => t.status === "done")
    .map((t) => ({ id: t.id, title: t.title }));

  const byBucket = new Map<string, Row[]>();
  let drifting = 0;
  for (const t of tasks) {
    const { meta, tone } = metaOf(t, nowMs);
    if (t.drifted) drifting += 1;
    const key = t.bucket_id ?? "";
    const rows = byBucket.get(key) ?? [];
    rows.push({
      id: t.id,
      title: t.title,
      meta,
      tone,
      subtasks: t.subtask_count ?? 0,
      queuePos: queuePos.get(t.id) ?? null,
    });
    byBucket.set(key, rows);
  }
  const groups: Group[] = [];
  for (const b of buckets) {
    const rows = byBucket.get(b.id);
    if (rows?.length) groups.push({ id: b.id, name: b.name, rows });
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
