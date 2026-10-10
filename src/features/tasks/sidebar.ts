// The Tasks rail's bucket rules (tasks-v2 §11, TV-U6): colour dots, drag to
// reorder, archived buckets, and where each task shows while a bucket change
// is still on its way to every loaded bundle (hidden-buckets.ts). Pure, no
// React or IO.

import {
  DEFAULT_LABEL_COLOR,
  LABEL_COLORS,
  type LabelColor,
  normalizeLabelColor,
} from "../../components/tag-colors";
import { betweenPositions } from "./helpers";
import type { BucketChange } from "./hidden-buckets";
import type { Bucket, Task } from "./model";

// ── colours ──────────────────────────────────────────────────────────────────

/** The rail dot's hue: the bucket's colour, or neutral gray when it has none. */
export function bucketDotColor(bucket: Pick<Bucket, "color">): LabelColor {
  return normalizeLabelColor(bucket.color);
}

/** What a Colour pick stores: neutral is "no colour" (null), so it follows the default. */
export function storedBucketColor(color: LabelColor): string | null {
  return color === DEFAULT_LABEL_COLOR ? null : color;
}

/** The Colour menu: neutral first (the default), then the seven hues. */
export const BUCKET_COLOR_OPTIONS: ReadonlyArray<{ value: LabelColor; label: string }> = [
  { value: DEFAULT_LABEL_COLOR, label: "Neutral" },
  ...LABEL_COLORS.filter((c) => c !== DEFAULT_LABEL_COLOR).map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
  })),
];

// ── reorder ──────────────────────────────────────────────────────────────────

const groupOf = (b: Pick<Bucket, "group">) => b.group?.trim() || null;

/**
 * Where a bucket dropped on another one lands: in the target's section, after
 * it when moving down within the same section and before it otherwise (the
 * order a sortable list shows while dragging). `buckets` are the rail's user
 * buckets in position order. Null when nothing would change.
 */
export function bucketDropPatch(
  buckets: ReadonlyArray<Bucket>,
  activeId: string,
  overId: string,
): { position: string; group: string | null } | null {
  if (activeId === overId) return null;
  const active = buckets.find((b) => b.id === activeId);
  const over = buckets.find((b) => b.id === overId);
  if (!active || !over) return null;
  const group = groupOf(over);
  const list = buckets.filter((b) => groupOf(b) === group);
  const after =
    groupOf(active) === group &&
    list.findIndex((b) => b.id === activeId) < list.findIndex((b) => b.id === overId);
  const rest = list.filter((b) => b.id !== activeId);
  const at = rest.findIndex((b) => b.id === overId);
  const prev = after ? rest[at] : (rest[at - 1] ?? null);
  const next = after ? (rest[at + 1] ?? null) : rest[at];
  return { position: betweenPositions(prev?.position ?? null, next?.position ?? null), group };
}

// ── archive + pending changes ────────────────────────────────────────────────

/**
 * Split a bundle's buckets into the rail's live ones and the archived ones,
 * applying the changes this bundle doesn't show yet. Deleted buckets (in the
 * bundle or pending) are in neither.
 */
export function partitionBuckets(
  buckets: ReadonlyArray<Bucket>,
  changes: ReadonlyMap<string, BucketChange>,
): { live: Bucket[]; archived: Bucket[] } {
  const live: Bucket[] = [];
  const archived: Bucket[] = [];
  for (const b of buckets) {
    if (b.deletedAt) continue;
    const change = changes.get(b.id);
    if (change === "move" || change === "drop") continue;
    if (!b.isSystem && (change === "archived" || b.archivedAt)) archived.push(b);
    else live.push(b);
  }
  return { live, archived };
}

/**
 * Where each live task shows: in its bucket; in Inbox while its bucket's
 * "move" delete is on its way; nowhere while its bucket's delete with tasks
 * is; and in `archived` when its bucket is archived (hidden from every list,
 * count, search and queue).
 */
export function placeTasks(
  tasks: ReadonlyArray<Task>,
  opts: {
    archivedBucketIds: ReadonlySet<string>;
    changes: ReadonlyMap<string, BucketChange>;
    inboxId: string | null;
  },
): { live: Task[]; archived: Task[] } {
  const live: Task[] = [];
  const archived: Task[] = [];
  for (const t of tasks) {
    if (t.deletedAt) continue;
    if (opts.archivedBucketIds.has(t.bucketId)) {
      archived.push(t);
      continue;
    }
    const change = opts.changes.get(t.bucketId);
    if (change === "drop") continue;
    if (change === "move" && opts.inboxId) live.push({ ...t, bucketId: opts.inboxId });
    else live.push(t);
  }
  return { live, archived };
}
