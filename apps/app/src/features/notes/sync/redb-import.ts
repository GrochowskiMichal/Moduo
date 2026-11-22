/**
 * One-time desktop import of legacy redb notes into Supabase (Wave-3 NO-2,
 * AC14). Runs on module load, desktop only, guarded by a per-workspace flag;
 * idempotent end to end (the server skips existing ids, a re-run after a
 * partial failure resumes cleanly, and the flag is only set on success).
 * A note whose content couldn't be read waits, with its sub-pages (a child
 * can't be imported without its parent), and the import stays open: imported
 * without it, the note would land empty and the server would skip its id on
 * every later run. After `MAX_FAILED_READS` loads that couldn't read it (a
 * corrupt row fails every time), it imports title-only so it can't block the
 * rest for good.
 *
 * Reads through the LEGACY tauri runtime.notes surface (redb) — those Rust
 * read commands stay until this import has shipped a release; the JS write
 * paths die with NO-3.
 */

import * as Y from "yjs";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { tryDeriveNoteBody } from "../editor/doc-markdown";
import type { NotesImportRow } from "../model";
import { decodeBase64ToUint8, encodeUint8ToBase64 } from "../utils/base64";

const FLAG_PREFIX = "moduo:notes:redb-imported:v1:";
const FAILS_PREFIX = "moduo:notes:redb-import-fails:v1:";
/** Loads that couldn't read a note's content before it imports title-only. */
const MAX_FAILED_READS = 3;
/** Notes whose failed read this page load already counted (`<workspace>:<note>`). */
const countedThisLife = new Set<string>();

export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function flagKey(workspaceId: string): string {
  return `${FLAG_PREFIX}${workspaceId}`;
}

export function redbImportDone(workspaceId: string): boolean {
  try {
    return window.localStorage.getItem(flagKey(workspaceId)) === "done";
  } catch {
    return true; // can't track → don't loop imports
  }
}

/** Legacy redb meta row (Rust NoteMeta, camelCase over IPC). */
type LegacyNote = {
  id: string;
  parentId?: string | null;
  parent_id?: string | null;
  title?: string;
  icon?: string | null;
  kind?: string;
  position?: string | number;
  isArchived?: boolean;
  deletedAt?: string | null;
  deleted_at?: string | null;
};

/** Pure: legacy meta + merged snapshot → an import row. Exported for tests. */
export function legacyNoteToImportRow(
  meta: LegacyNote,
  snapshotB64: string | null,
  body: { text: string; md: string },
): NotesImportRow {
  return {
    id: meta.id,
    parentId: meta.parentId ?? meta.parent_id ?? null,
    title: meta.title ?? "",
    icon: meta.icon ?? null,
    position: String(meta.position ?? ""),
    docStateB64: snapshotB64,
    bodyText: body.text,
    bodyMd: body.md,
  };
}

/** Merge a legacy doc_state snapshot + pending redb updates into one clean
 * snapshot (the same root-v2 pre-registration the legacy engine needed). */
export function mergeLegacyDoc(
  snapshotB64: string | null | undefined,
  updateB64s: string[],
): { snapshotB64: string | null; body: { text: string; md: string } } {
  const doc = new Y.Doc();
  doc.get("root-v2", Y.XmlElement);
  let applied = false;
  const apply = (b64: string | null | undefined) => {
    if (!b64) return;
    try {
      Y.applyUpdate(doc, decodeBase64ToUint8(b64));
      applied = true;
    } catch {
      // one corrupt update must not sink the note — import what merges
    }
  };
  apply(snapshotB64);
  for (const u of updateB64s) apply(u);
  if (!applied) return { snapshotB64: null, body: { text: "", md: "" } };
  return {
    snapshotB64: encodeUint8ToBase64(Y.encodeStateAsUpdate(doc)),
    body: tryDeriveNoteBody(doc) ?? { text: "", md: "" },
  };
}

export type RedbImportResult = { imported: number; skipped: number; total: number };

/** Run the import once per workspace per device. Returns null when it didn't
 * run (web, already done, nothing to import). Never throws. */
export async function runRedbImportOnce(
  runtime: ModuoRuntime | null,
  workspaceId: string,
): Promise<RedbImportResult | null> {
  if (!runtime || !isDesktop() || redbImportDone(workspaceId)) return null;
  try {
    const legacy = ((await runtime.notes.list(workspaceId)) ?? []) as LegacyNote[];
    const live = legacy.filter((n) => !(n.deletedAt ?? n.deleted_at));
    if (live.length === 0) {
      window.localStorage.setItem(flagKey(workspaceId), "done");
      return null;
    }

    // An unreadable counter starts again from zero: the note only waits longer,
    // it is never imported empty sooner.
    const counted = readFails(workspaceId);
    const fails = counted === "unreadable" ? {} : counted;
    const { read, unread } = await readLegacyDocs(runtime, workspaceId, live, fails);
    writeFails(workspaceId, fails);

    const waiting = withDescendants(live, unread);
    const rows = live.filter((n) => !waiting.has(n.id)).map((n) => read.get(n.id)!);
    const res =
      rows.length > 0
        ? await runtime.notesV2.importNotes({
            workspaceId,
            // Filed by the whole legacy tree: a root whose sub-pages all wait is still a page.
            rows: fileLegacyRows(rows, live.map(legacyParentId)),
          })
        : { imported: 0, skipped: 0 };
    if (waiting.size === 0) {
      window.localStorage.setItem(flagKey(workspaceId), "done");
      writeFails(workspaceId, {});
    } else {
      console.warn(`[notes] redb import: ${waiting.size} note(s) wait for the next load`);
    }
    return { ...res, total: rows.length };
  } catch (e) {
    console.warn("[notes] redb import deferred (will retry next load)", e);
    return null;
  }
}

/** Each note's import row, from its legacy doc; a note whose read failed is
 * left unread (counted in `fails`) until it failed `MAX_FAILED_READS` loads. */
async function readLegacyDocs(
  runtime: ModuoRuntime,
  workspaceId: string,
  live: LegacyNote[],
  fails: Record<string, number>,
): Promise<{ read: Map<string, NotesImportRow>; unread: Set<string> }> {
  const read = new Map<string, NotesImportRow>();
  const unread = new Set<string>();
  for (const meta of live) {
    // No stored state (null) is a note without content: it imports meta-only.
    try {
      const state = await runtime.notes.getDocState(workspaceId, meta.id);
      const merged = mergeLegacyDoc(
        state?.snapshotB64 ?? state?.snapshot_b64 ?? null,
        ((state?.updates ?? []) as any[]).map((u) => u.updateB64 ?? u.update_b64).filter(Boolean),
      );
      read.set(meta.id, legacyNoteToImportRow(meta, merged.snapshotB64, merged.body));
      delete fails[meta.id];
    } catch (e) {
      // A failed read is never "no content" (644-1): the note waits for a later load…
      // (counted once per page load, however often Notes mounts in it)
      const key = `${workspaceId}:${meta.id}`;
      if (!countedThisLife.has(key)) {
        countedThisLife.add(key);
        fails[meta.id] = (fails[meta.id] ?? 0) + 1;
      }
      if ((fails[meta.id] ?? 0) < MAX_FAILED_READS) {
        unread.add(meta.id);
        continue;
      }
      // …until it failed on every one of them: title-only beats blocking the rest.
      console.warn(`[notes] redb import: note ${meta.id} imported without its content`, e);
      read.set(meta.id, legacyNoteToImportRow(meta, null, { text: "", md: "" }));
    }
  }
  return { read, unread };
}

function legacyParentId(n: LegacyNote): string | null {
  return n.parentId ?? n.parent_id ?? null;
}

/** These notes and every note under them. */
function withDescendants(notes: LegacyNote[], roots: Set<string>): Set<string> {
  const out = new Set(roots);
  for (let grew = roots.size > 0; grew;) {
    grew = false;
    for (const n of notes) {
      const parent = legacyParentId(n);
      if (parent && out.has(parent) && !out.has(n.id)) {
        out.add(n.id);
        grew = true;
      }
    }
  }
  return out;
}

/** How many loads couldn't read each note's content (by note id), or
 * "unreadable" when the counter itself can't be read. */
function readFails(workspaceId: string): Record<string, number> | "unreadable" {
  try {
    const raw = window.localStorage.getItem(`${FAILS_PREFIX}${workspaceId}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return "unreadable";
  }
}

function writeFails(workspaceId: string, fails: Record<string, number>): void {
  try {
    const key = `${FAILS_PREFIX}${workspaceId}`;
    if (Object.keys(fails).length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(fails));
  } catch {
    // can't count: the note keeps waiting (never imported empty)
  }
}

/** NR-1: legacy notes keep the section they showed in classic Notes. A root
 * with children was an organized page (→ Pages); a childless root was a loose
 * capture and is left to the server's default (→ Inbox). Same rule as the
 * migration's backfill. */
export function fileLegacyRows(
  rows: NotesImportRow[],
  parentIds: (string | null)[] = rows.map((r) => r.parentId ?? null),
): NotesImportRow[] {
  const parents = new Set(parentIds.filter(Boolean));
  return rows.map((r) => (!r.parentId && r.id && parents.has(r.id) ? { ...r, inInbox: false } : r));
}
