/**
 * One-time desktop import of legacy redb notes into Supabase (Wave-3 NO-2,
 * AC14). Runs on module load, desktop only, guarded by a per-workspace flag;
 * idempotent end to end (the server skips existing ids, a re-run after a
 * partial failure resumes cleanly, and the flag is only set on success).
 *
 * Reads through the LEGACY tauri runtime.notes surface (redb) — those Rust
 * read commands stay until this import has shipped a release; the JS write
 * paths die with NO-3.
 */

import * as Y from "yjs";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { NotesImportRow } from "../model";
import { decodeBase64ToUint8, encodeUint8ToBase64 } from "../utils/base64";
import { deriveBody } from "./doc-text";

const FLAG_PREFIX = "moduo:notes:redb-imported:v1:";

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
    body: deriveBody(doc),
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

    const rows: NotesImportRow[] = [];
    for (const meta of live) {
      let snapshotB64: string | null = null;
      let body = { text: "", md: "" };
      try {
        const state = await runtime.notes.getDocState(workspaceId, meta.id);
        const merged = mergeLegacyDoc(
          state?.snapshotB64 ?? state?.snapshot_b64 ?? null,
          ((state?.updates ?? []) as any[]).map((u) => u.updateB64 ?? u.update_b64).filter(Boolean),
        );
        snapshotB64 = merged.snapshotB64;
        body = merged.body;
      } catch {
        // meta-only import beats no import
      }
      rows.push(legacyNoteToImportRow(meta, snapshotB64, body));
    }

    const res = await runtime.notesV2.importNotes({ workspaceId, rows });
    window.localStorage.setItem(flagKey(workspaceId), "done");
    return { ...res, total: rows.length };
  } catch (e) {
    console.warn("[notes] redb import deferred (will retry next load)", e);
    return null;
  }
}
