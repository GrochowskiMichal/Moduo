// Connective-tissue spine — the universal drag-payload contract (block CT-3).
//
// One vocabulary for "any entity can be dragged onto any drop target that
// declares what it consumes" (DESIGN_BRIEF flow 1). This is the PURE half —
// types, factories, type guards, and the deterministic `resolveKind` matrix —
// kept free of React/dnd-kit so it unit-tests cleanly (drag-payload.test.ts,
// AC7). The dnd-kit hooks + the drop-to-link toast live in src/features/spine.
//
// It also generalizes the existing Tasks DnD: `asDragPayload` recognizes a
// legacy `TaskDragData` ({type:"task", taskId}) and adapts it, so every existing
// task drag is automatically a valid link source without touching task-dnd.tsx.

import {
  coerceRelationKind,
  DEFAULT_RELATION_KIND,
  type EntityRef,
  type RelationKind,
} from "./entity-links";

/** What a draggable entity carries on its dnd-kit node. */
export type DragPayload = {
  /** Discriminant for a universal entity drag. */
  kind: "entity-drag";
  entityType: string;
  entityId: string;
  /** Best-effort label/icon to seed the registry + the link toast. */
  label?: string;
  icon?: string | null;
  /** Originating surface (analytics / target reactions); e.g. "board", "hub". */
  from?: string;
};

/** A droppable that links what's dropped on it into its own entity. */
export type DropLinkTarget = {
  kind: "link-target";
  entityType: string;
  entityId: string;
  /** Types this target consumes; omit/empty = accepts any entity. */
  accepts?: string[];
};

/** Build a drag payload for an entity. */
export function entityDrag(
  ref: EntityRef,
  opts: { label?: string; icon?: string | null; from?: string } = {},
): DragPayload {
  return { kind: "entity-drag", entityType: ref.type, entityId: ref.id, ...opts };
}

/** Build a link drop-target for an entity. */
export function linkTarget(ref: EntityRef, accepts?: string[]): DropLinkTarget {
  return { kind: "link-target", entityType: ref.type, entityId: ref.id, accepts };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

/**
 * Narrow `active.data.current` to a {@link DragPayload}. Accepts the universal
 * shape AND a legacy Tasks `TaskDragData` ({type:"task", taskId}), adapting the
 * latter — so existing task drags are link sources for free. Returns null for
 * anything else.
 */
export function asDragPayload(data: unknown): DragPayload | null {
  if (!isRecord(data)) return null;
  if (data.kind === "entity-drag" && typeof data.entityType === "string" && typeof data.entityId === "string") {
    return data as DragPayload;
  }
  // Legacy Tasks payload adapter.
  if (data.type === "task" && typeof data.taskId === "string") {
    return {
      kind: "entity-drag",
      entityType: "task",
      entityId: data.taskId,
      from: typeof data.from === "string" ? data.from : undefined,
    };
  }
  return null;
}

/** Narrow a droppable's `data` to a {@link DropLinkTarget}. */
export function asDropLinkTarget(data: unknown): DropLinkTarget | null {
  if (!isRecord(data)) return null;
  if (data.kind === "link-target" && typeof data.entityType === "string" && typeof data.entityId === "string") {
    return data as DropLinkTarget;
  }
  return null;
}

/** The ref form of a payload / target endpoint. */
export function payloadRef(payload: DragPayload): EntityRef {
  return { type: payload.entityType, id: payload.entityId };
}
export function targetRef(target: DropLinkTarget): EntityRef {
  return { type: target.entityType, id: target.entityId };
}

/** A drop onto the same entity it came from — never a valid link. */
export function isSelfDrop(payload: DragPayload, target: DropLinkTarget): boolean {
  return payload.entityType === target.entityType && payload.entityId === target.entityId;
}

/**
 * Whether `target` accepts `payload`: the types must match the target's
 * `accepts` allow-list (omitted = any), and a self-drop is always rejected.
 */
export function targetAccepts(target: DropLinkTarget, payload: DragPayload): boolean {
  if (isSelfDrop(payload, target)) return false;
  if (!target.accepts || target.accepts.length === 0) return true;
  return target.accepts.includes(payload.entityType);
}

// ── resolveKind: deterministic source→target relation kind ───────────────────
// The kind a drop implies, by the (source type → target type) pair. Explicit
// pairs win; then source/target-type defaults; else `references`. Closed set
// only (entity-links). The user can always override via the drop toast or the
// hub row's "Change relation" menu, so this only needs sensible defaults.
const EXPLICIT_KINDS: Record<string, RelationKind> = {
  "email>task": "spawned-from",
  "email>project": "spawned-from",
  "email>note": "spawned-from",
  "payment>contact": "paid-by",
  "payment>company": "paid-by",
  "invoice>contact": "paid-by",
  "invoice>company": "paid-by",
  "contact>company": "works-at",
  "company>contact": "works-at",
};

export function resolveKind(sourceType: string, targetType: string): RelationKind {
  const explicit = EXPLICIT_KINDS[`${sourceType}>${targetType}`];
  if (explicit) return explicit;
  // A file dropped onto (or receiving) anything is an attachment.
  if (sourceType === "file" || targetType === "file") return "attachment";
  return DEFAULT_RELATION_KIND;
}

/** Coerce an arbitrary kind to the closed set (for a user kind-override). */
export { coerceRelationKind };
