// Pure helpers for the Tasks module Plan-mode UI: a task factory, fractional
// position generation (Lexorank-lite), label maps, datetime formatting, and the
// grouping logic for the List view. No React, no IO — easy to unit-test.

import type { Bucket, EnergyLevel, PriorityLevel, Task, TaskRelation, TaskStatus } from "./model";

// ── Position (fractional indexing) ───────────────────────────────────────────
// Order keys are base-36 digit strings compared lexicographically (see
// `byPosition` in the data hook and the DB's text sort), so each key reads as
// the fraction 0.<digits>. Fresh keys are fixed-width and STEP-spaced to leave
// integer room between neighbours; when that room runs out (adjacent neighbours)
// we subdivide by extending precision — appending base-36 digits — so the gap
// can always be split again. The scheme never exhausts and needs no re-indexing.
//
// Lexicographic order matches fraction order for every key minted here: a
// midpoint is strictly between its bounds, so two keys never share a value, and
// distinct fraction values always agree with string comparison. (Equal values —
// the only case lexicographic order could disagree, via trailing zeros — never
// arise.) `midpointFraction` therefore never emits a trailing zero.

const POS_WIDTH = 10;
const POS_STEP = 1 << 20;
const POS_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"; // base 36 (Number#toString(36))
const POS_MID_DIGIT = POS_ALPHABET[POS_ALPHABET.length >> 1]!; // "i" — a non-zero middle digit

function encodePos(n: number): string {
  return Math.max(0, Math.floor(n)).toString(36).padStart(POS_WIDTH, "0");
}
function decodePos(s: string): number {
  const n = parseInt(s, 36);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A digit string strictly between the base-36 fractions `lo` and `hi`, extending
 * precision when no existing digit fits. `lo` is "" (= 0) at the bottom; `hi` is
 * `null` (= 1) for an open top. Caller guarantees `lo < hi`. Never returns a
 * trailing zero, so lexicographic order matches fraction order for the result.
 * This is the unbounded path that backs {@link betweenPositions} once the
 * integer gap between two fixed-width neighbours is gone.
 */
function midpointFraction(lo: string, hi: string | null): string {
  // Carry any shared leading digits onto the result and recurse on the rest —
  // the split happens at the first place the bounds diverge. Bounded by `hi`'s
  // length so a degenerate equal/zero bound can't spin forever. (Skipped for an
  // open top, which shares no prefix with a real lower bound.)
  if (hi !== null) {
    let n = 0;
    while (n < hi.length && (lo[n] ?? "0") === hi[n]) n += 1;
    if (n > 0) {
      const tail = hi.slice(n);
      return hi.slice(0, n) + midpointFraction(lo.slice(n), tail.length > 0 ? tail : null);
    }
  }
  const digitLo = lo.length > 0 ? POS_ALPHABET.indexOf(lo[0]!) : 0;
  const digitHi = hi !== null && hi.length > 0 ? POS_ALPHABET.indexOf(hi[0]!) : POS_ALPHABET.length;
  if (digitHi - digitLo > 1) {
    // Room for a whole digit between the bounds — take the middle one.
    return POS_ALPHABET[Math.round((digitLo + digitHi) / 2)]!;
  }
  // Bounds are consecutive digits: borrow `hi`'s leading digit if it has more
  // precision to spare, else descend into `lo` against an open top.
  if (hi !== null && hi.length > 1) return hi.slice(0, 1);
  return POS_ALPHABET[digitLo]! + midpointFraction(lo.slice(1), null);
}

/** A position string that sorts after every existing position.
 *
 * "After" means LEXICOGRAPHICALLY after (that's the sort everywhere). Only a
 * clean POS_WIDTH key takes the integer fast path — a longer key (a legacy
 * 16-digit numeric position, or a subdivided variable-width key) decodes past
 * float precision, where `+ POS_STEP` is absorbed and the round-trip returns
 * the IDENTICAL string (verified: `"5000000000000000"` came back unchanged —
 * duplicate keys forever). Those fall back to appending a mid digit, which
 * always sorts strictly after its prefix. */
export function endPosition(existing: Array<{ position: string }>): string {
  let maxStr = "";
  for (const item of existing) {
    if (item.position > maxStr) maxStr = item.position;
  }
  if (maxStr === "") return encodePos(POS_STEP);
  if (maxStr.length === POS_WIDTH) {
    return encodePos(decodePos(maxStr) + POS_STEP);
  }
  return maxStr + POS_MID_DIGIT;
}

/**
 * A position string strictly between `a` and `b` (either bound may be null).
 * Uses a fixed-width integer midpoint while neighbours still have room between
 * them (lexicographic order == integer order only at equal width, so this is
 * gated on two clean POS_WIDTH keys). Once they're adjacent — or a neighbour is
 * already a subdivided, variable-width key — it falls through to
 * {@link midpointFraction}, which extends precision instead of colliding, so
 * repeated inserts into one shrinking gap never exhaust it (the board-reorder
 * bug). Open ends step by STEP so the column's min/max stay clean keys.
 */
export function betweenPositions(a: string | null, b: string | null): string {
  if (a === null) {
    if (b === null) return encodePos(POS_STEP); // lone item
    // Insert below `b`: halve the integer room when `b` is a clean key that has
    // some, otherwise subdivide beneath it.
    if (b.length === POS_WIDTH) {
      const hi = decodePos(b);
      if (hi > 1) return encodePos(Math.floor(hi / 2));
    }
    return midpointFraction("", b);
  }
  if (b === null) {
    // Open top — step past `a`. Only a clean key takes the integer step (a
    // legacy over-width key decodes past float precision and the step gets
    // absorbed — see endPosition); anything else appends a mid digit, which
    // sorts strictly after `a`.
    if (a.length === POS_WIDTH) return encodePos(decodePos(a) + POS_STEP);
    return a + POS_MID_DIGIT;
  }
  // Degenerate bounds from a legacy collision (equal, or out of order) can't be
  // split — nudge deterministically past `a` rather than loop or tie.
  if (a >= b) return a + POS_MID_DIGIT;
  // Interior with room: integer midpoint between two clean, equal-width keys.
  if (a.length === POS_WIDTH && b.length === POS_WIDTH) {
    const lo = decodePos(a);
    const hi = decodePos(b);
    if (hi - lo > 1) return encodePos(Math.floor((lo + hi) / 2));
  }
  return midpointFraction(a, b);
}

/** Local calendar date as YYYY-MM-DD (the value stored in `committedFor`). */
export function todayStr(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// ── Task factory ─────────────────────────────────────────────────────────────

export type NewTaskFields = {
  workspaceId: string;
  bucketId: string;
  title: string;
  position: string;
  /** Parent task id — makes the new task a subtask (one level, spec §11). */
  parentId?: string | null;
  description?: string;
  dueDate?: string | null;
  scheduledAt?: string | null;
  recurrence?: Task["recurrence"];
  energyLevel?: EnergyLevel | null;
  priority?: PriorityLevel | null;
  durationMinutes?: number | null;
};

/**
 * Build a client-side Task. `id`/`ownerId` are left empty for the backend to
 * fill (both runtimes mint them on upsert), and timestamps are stamped now so
 * optimistic rendering has a stable value.
 */
export function makeTask(fields: NewTaskFields): Task {
  const now = new Date().toISOString();
  return {
    id: "",
    workspaceId: fields.workspaceId,
    ownerId: "",
    bucketId: fields.bucketId,
    parentId: fields.parentId ?? null,
    title: fields.title,
    description: fields.description ?? "",
    dueDate: fields.dueDate ?? null,
    scheduledAt: fields.scheduledAt ?? null,
    durationMinutes: fields.durationMinutes ?? null,
    timeSpentSeconds: 0,
    recurrence: fields.recurrence ?? null,
    energyLevel: fields.energyLevel ?? null,
    priority: fields.priority ?? null,
    status: "todo",
    committedFor: null,
    commitOrder: null,
    rescheduleCount: 0,
    position: fields.position,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

// ── Labels ───────────────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
  archived: "Archived",
};

/** Status order for grouping (open work first, terminal states last). */
export const STATUS_ORDER: TaskStatus[] = ["in_progress", "todo", "done", "archived"];

export const ENERGY_LABELS: Record<EnergyLevel, string> = {
  low: "Low energy",
  medium: "Medium energy",
  high: "High energy",
};

export const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  low: "Low priority",
  medium: "Medium priority",
  high: "High priority",
};

export const LEVEL_ORDER = ["high", "medium", "low"] as const;

/** Ascending level options for pickers (context menus, detail panel selects). */
export const LEVEL_OPTIONS: Array<{ value: EnergyLevel | PriorityLevel; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

// ── Datetime formatting ──────────────────────────────────────────────────────

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DATE_FMT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const DATE_TIME_FMT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const TIMESTAMP_FMT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Absolute timestamp with year — created/updated metadata, activity trails. */
export function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : TIMESTAMP_FMT.format(d);
}

/** Scheduled clock time — just the time if today, else short date + time. */
export function formatScheduled(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return sameDay(d, now) ? TIME_FMT.format(d) : DATE_TIME_FMT.format(d);
}

/** Due marker — relative ("Today"/"Tomorrow") near now, else a short date. */
export function formatDue(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, tomorrow)) return "Tomorrow";
  return DATE_FMT.format(d);
}

/** For datetime-local inputs (YYYY-MM-DDTHH:mm in local time). */
export function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** For date inputs (YYYY-MM-DD in local time). */
export function toDateInputValue(iso: string | null): string {
  return toLocalInputValue(iso).slice(0, 10);
}

// ── Grouping ─────────────────────────────────────────────────────────────────

export type GroupBy = "none" | "status" | "bucket" | "energy" | "priority";

export type TaskGroup = {
  key: string;
  label: string;
  tasks: Task[];
};

export type GroupContext = {
  bucketName: (bucketId: string) => string;
};

const UNSET_LABEL = "Unset";

/**
 * Partition tasks into ordered, labeled groups for the List view. "bucket"
 * grouping is the implicit mode used in the cross-bucket "All" selection.
 */
export function groupTasks(tasks: Task[], by: GroupBy, ctx: GroupContext): TaskGroup[] {
  if (by === "none") {
    return [{ key: "all", label: "", tasks }];
  }

  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = groupKeyFor(task, by);
    const list = map.get(key);
    if (list) list.push(task);
    else map.set(key, [task]);
  }

  const orderedKeys = orderedGroupKeys(by, map);
  return orderedKeys.map((key) => ({
    key,
    label: groupLabel(by, key, ctx),
    tasks: map.get(key) ?? [],
  }));
}

function groupKeyFor(task: Task, by: GroupBy): string {
  switch (by) {
    case "status":
      return task.status;
    case "bucket":
      return task.bucketId;
    case "energy":
      return task.energyLevel ?? "unset";
    case "priority":
      return task.priority ?? "unset";
    default:
      return "all";
  }
}

function orderedGroupKeys(by: GroupBy, map: Map<string, Task[]>): string[] {
  const present = new Set(map.keys());
  if (by === "status") {
    return STATUS_ORDER.filter((s) => present.has(s));
  }
  if (by === "energy" || by === "priority") {
    const ranked: string[] = LEVEL_ORDER.filter((l) => present.has(l));
    if (present.has("unset")) ranked.push("unset");
    return ranked;
  }
  // bucket: keep map insertion order (already position-sorted upstream)
  return [...map.keys()];
}

function groupLabel(by: GroupBy, key: string, ctx: GroupContext): string {
  if (by === "status") return STATUS_LABELS[key as TaskStatus] ?? key;
  if (by === "bucket") return ctx.bucketName(key);
  if (by === "energy") return key === "unset" ? UNSET_LABEL : ENERGY_LABELS[key as EnergyLevel];
  if (by === "priority")
    return key === "unset" ? UNSET_LABEL : PRIORITY_LABELS[key as PriorityLevel];
  return key;
}

// ── Organization: rail sections + tag filter (Session 4) ─────────────────────

export type BucketSection = { name: string; buckets: Bucket[] };

export type BucketLayout = {
  /** Buckets with no section — rendered flat, first (presentational). */
  ungrouped: Bucket[];
  /** Sections in first-appearance order; buckets keep their incoming order. */
  sections: BucketSection[];
};

/**
 * Partition position-sorted buckets into the flat (ungrouped) set and the
 * collapsible sections, by their optional `group` label. Two levels max:
 * section → bucket, never nested. Pure / presentational — capture and task
 * assignment never touch this. A blank/whitespace group counts as ungrouped.
 */
export function bucketSections(buckets: Bucket[]): BucketLayout {
  const ungrouped: Bucket[] = [];
  const order: string[] = [];
  const byName = new Map<string, Bucket[]>();
  for (const bucket of buckets) {
    const name = bucket.group?.trim();
    if (!name) {
      ungrouped.push(bucket);
      continue;
    }
    const list = byName.get(name);
    if (list) {
      list.push(bucket);
    } else {
      byName.set(name, [bucket]);
      order.push(name);
    }
  }
  return { ungrouped, sections: order.map((name) => ({ name, buckets: byName.get(name) ?? [] })) };
}

/** Existing section names (first-appearance order) — for the "move to section" menu. */
export function bucketGroupNames(buckets: Bucket[]): string[] {
  return bucketSections(buckets).sections.map((s) => s.name);
}

// ── Subtasks, one level (Session 5) ──────────────────────────────────────────

/**
 * Children keyed by parent id, resolved among `tasks` (pass the *live* task
 * set). A `parentId` that doesn't resolve to a task in the set is ignored —
 * that task is treated as top-level (children of a deleted parent are never
 * lost). Children keep the incoming order (position-sorted upstream).
 */
export function subtasksByParent(tasks: Task[]): Map<string, Task[]> {
  const ids = new Set(tasks.map((t) => t.id));
  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.parentId || !ids.has(task.parentId) || task.parentId === task.id) continue;
    const list = map.get(task.parentId);
    if (list) list.push(task);
    else map.set(task.parentId, [task]);
  }
  return map;
}

/** Quiet n/m progress for a parent (mirror, never a wall). Archived subtasks
 * are out of open lists, so they count toward neither side. */
export function subtaskProgress(children: Task[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const child of children) {
    if (child.status === "archived") continue;
    total += 1;
    if (child.status === "done") done += 1;
  }
  return { done, total };
}

/**
 * The ids hidden from a scope's top level: subtasks whose parent is in the
 * same rendered set. A subtask whose parent is *not* in the scope (other
 * bucket, filtered out, deleted) renders as a normal top-level row instead —
 * nothing is ever invisible. Today's queue passes `nest = false` (it is an
 * ordered flat queue, and subtasks are individually committable).
 */
export function nestedSubtaskIds(scopeTasks: Task[], nest = true): Set<string> {
  if (!nest) return new Set();
  const scopeIds = new Set(scopeTasks.map((t) => t.id));
  const nested = new Set<string>();
  for (const task of scopeTasks) {
    if (task.parentId && task.parentId !== task.id && scopeIds.has(task.parentId)) {
      nested.add(task.id);
    }
  }
  return nested;
}

/**
 * Whether `active` may be dropped onto `target` to become its subtask — the
 * eligibility test the List uses to highlight valid drop targets during a
 * drag-to-nest. Mirrors the one-level rule that `setTaskParent` (and the DB
 * trigger) enforce on write; this is the read-side affordance, not the
 * guarantee. A nest is allowed when:
 *   • the active task is childless (a parent can't become a subtask — one level);
 *   • the target is neither the active task nor its current parent (no-op);
 *   • the target is top-level (a subtask can't gain children — one level).
 */
export function canNestUnder(
  active: Pick<Task, "id" | "parentId">,
  target: Pick<Task, "id" | "parentId">,
  hasChildren: (id: string) => boolean,
): boolean {
  return (
    !hasChildren(active.id) &&
    target.id !== active.id &&
    target.id !== (active.parentId ?? null) &&
    !target.parentId
  );
}

// ── Blocked-by dependencies (Session 6 — spec §5c) ───────────────────────────

/** An open task can be worked on; done/archived can't block anything. */
export function isOpen(task: Pick<Task, "status">): boolean {
  return task.status !== "done" && task.status !== "archived";
}

/**
 * Computed blocked state (the drift pattern — derived on read, never stored):
 * a task is blocked when at least one edge points at it from a *live, open*
 * blocker in `tasks`. Edges whose blocker doesn't resolve in the set (deleted
 * task) are inert — work is never invisibly stuck behind a ghost.
 */
export function blockedTaskIds(tasks: Task[], relations: TaskRelation[]): Set<string> {
  const openIds = new Set(tasks.filter(isOpen).map((t) => t.id));
  const blocked = new Set<string>();
  for (const rel of relations) {
    if (rel.blockerTaskId !== rel.blockedTaskId && openIds.has(rel.blockerTaskId)) {
      blocked.add(rel.blockedTaskId);
    }
  }
  return blocked;
}

/**
 * The frontier walk (spec §5c): from `taskId`, "what's actually next" — walk
 * up the blocker chain and collect the live, open blockers that aren't
 * themselves blocked. Non-empty for any blocked task on a DAG; the visited
 * set keeps the walk safe even if a cycle sneaks past the guards. Results in
 * first-encountered order (nearest blockers first).
 */
export function frontierTasks(taskId: string, tasks: Task[], relations: TaskRelation[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const blockersOf = new Map<string, string[]>();
  for (const rel of relations) {
    if (rel.blockerTaskId === rel.blockedTaskId) continue;
    const list = blockersOf.get(rel.blockedTaskId);
    if (list) list.push(rel.blockerTaskId);
    else blockersOf.set(rel.blockedTaskId, [rel.blockerTaskId]);
  }
  const frontier: Task[] = [];
  const visited = new Set<string>([taskId]);
  const queue = [...(blockersOf.get(taskId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const task = byId.get(id);
    if (!task || !isOpen(task)) continue; // inert edge / already done
    const ownBlockers = (blockersOf.get(id) ?? []).filter((b) => {
      const blocker = byId.get(b);
      return blocker ? isOpen(blocker) : false;
    });
    if (ownBlockers.length === 0) frontier.push(task);
    else queue.push(...ownBlockers);
  }
  return frontier;
}

/**
 * Would adding blocker → blocked close a cycle? True when `blocked` already
 * reaches `blocker` through existing edges (or they are the same task). The
 * UI guard before creating an edge; the DB trigger is the backstop.
 */
export function wouldCreateCycle(
  blockerId: string,
  blockedId: string,
  relations: TaskRelation[],
): boolean {
  if (blockerId === blockedId) return true;
  const downstreamOf = new Map<string, string[]>();
  for (const rel of relations) {
    const list = downstreamOf.get(rel.blockerTaskId);
    if (list) list.push(rel.blockedTaskId);
    else downstreamOf.set(rel.blockerTaskId, [rel.blockedTaskId]);
  }
  const visited = new Set<string>();
  const queue = [...(downstreamOf.get(blockedId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === blockerId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    queue.push(...(downstreamOf.get(id) ?? []));
  }
  return false;
}

/**
 * Tag filter predicate (OR / union): a task matches when no tags are selected,
 * or it carries at least one of them. Union is the intuitive "show me #x or #y";
 * the dominant single-tag case is identical under either rule.
 */
export function taskMatchesTagFilter(
  taskTagIds: Iterable<string>,
  filterTagIds: string[],
): boolean {
  if (filterTagIds.length === 0) return true;
  const wanted = new Set(filterTagIds);
  for (const id of taskTagIds) {
    if (wanted.has(id)) return true;
  }
  return false;
}
