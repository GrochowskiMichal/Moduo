/**
 * Notes v2 (Wave 3 rebuild) — the meta model, row mappers, and trash-window
 * helpers. Pure: no runtime imports, unit-testable (specs/notes.md NO-1).
 *
 * `Note` is the v2 meta shape (no body — body_text/body_md/doc_state are
 * heavy and fetched per note, never in the list). The legacy `NoteMeta` in
 * ./types.ts stays until the old surfaces retire with NO-2/NO-3.
 */

export type Note = {
  id: string;
  workspaceId: string;
  createdBy: string | null;
  parentId: string | null;
  title: string;
  icon: string | null;
  isPinned: boolean;
  position: string;
  isArchived: boolean;
  publishedAt: string | null;
  publishToken: string | null;
  docVersion: number;
  createdAt: string;
  updatedAt: string;
  /** Set = the note is in the trash (30-day window). */
  deletedAt: string | null;
};

export type NotesV2Bundle = {
  notes: Note[];
  /**
   * True when the NO-1 migration isn't applied yet (new columns/RPCs missing)
   * — reads fall back to the legacy column set and mutations will fail with
   * honest errors (the deploy-gap posture).
   */
  degraded: boolean;
};

/** One row of the append-only CRDT update log (pull-since-cursor reads). */
export type NoteUpdateRow = {
  id: number;
  clientId: string;
  clientSeq: number;
  updateB64: string;
};

export type NoteDocPull = {
  snapshotB64: string | null;
  docVersion: number;
  updates: NoteUpdateRow[];
};

export type NotesImportRow = {
  id?: string;
  parentId?: string | null;
  title: string;
  icon?: string | null;
  position?: string;
  docStateB64?: string | null;
  bodyText?: string;
  bodyMd?: string;
};

/** snake_case row (any legacy or v2 shape) → `Note`, with v2-column defaults
 * so a pre-migration row maps cleanly (deploy-gap reads). */
export function noteRowToModel(r: any): Note {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    createdBy: r.created_by ?? null,
    parentId: r.parent_id ?? null,
    title: r.title ?? "",
    icon: r.icon ?? null,
    isPinned: Boolean(r.is_pinned),
    position: r.position ?? "",
    isArchived: Boolean(r.is_archived),
    publishedAt: r.published_at ?? null,
    publishToken: r.publish_token ?? null,
    docVersion: typeof r.doc_version === "number" ? r.doc_version : 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

export function noteUpdateRowToModel(r: any): NoteUpdateRow {
  return {
    id: Number(r.id),
    clientId: r.client_id ?? "",
    clientSeq: Number(r.client_seq ?? 0),
    updateB64: r.update_b64 ?? "",
  };
}

// ── Trash window ──────────────────────────────────────────────────────────────

export const TRASH_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left before a trashed note purges (0 = purge-eligible now). */
export function trashDaysLeft(deletedAt: string, now: Date): number {
  const expiry = new Date(deletedAt).getTime() + TRASH_RETENTION_DAYS * DAY_MS;
  return Math.max(0, Math.ceil((expiry - now.getTime()) / DAY_MS));
}

export function isTrashExpired(deletedAt: string, now: Date): boolean {
  return now.getTime() - new Date(deletedAt).getTime() > TRASH_RETENTION_DAYS * DAY_MS;
}

/** ISO cutoff for the list read: trashed rows older than this are invisible
 * (the server sweep may not have purged them yet). */
export function trashWindowCutoffIso(now: Date): string {
  return new Date(now.getTime() - TRASH_RETENTION_DAYS * DAY_MS).toISOString();
}
