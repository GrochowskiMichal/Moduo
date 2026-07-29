/**
 * Blank-note repair (NOTE-FIX-1) — the backfill for notes that were imported
 * (or written by the MCP connector) before the importer materialized
 * `doc_state`. Those notes carry a real `body_md` but an EMPTY CRDT, so the
 * editor opens them blank.
 *
 * Repair = build the doc the editor would have built (`editor/materialize.ts`)
 * and hand it to `notes_op_seed_doc`, which stores it ONLY if the note is still
 * un-materialized. Everything about this path is designed to be safe when it
 * runs twice, on two devices, at the same time:
 *
 *   - the SERVER decides (once-only write under the note's row lock), not us;
 *   - the build is deterministic, so even a simultaneous double-write stores
 *     identical bytes;
 *   - a refusal is a normal outcome, never an error — the note already has a
 *     doc and the caller just pulls it.
 *
 * It is also strictly opportunistic: every failure mode leaves the note exactly
 * as it was, with `body_md` still the durable source of truth.
 */

import type { ModuoRuntime } from "@/lib/runtime.types";
import { buildDocStateFromMarkdown } from "./editor/materialize";

export type RepairOutcome =
  /** We built the doc and the server stored it. */
  | "seeded"
  /** Someone else materialized it first — pull, don't seed. */
  | "already"
  /** The note's content lives in the update log, so it must NEVER be seeded.
   * Kept distinct from "already": this one means our emptiness read was
   * wrong, which is worth being able to see. */
  | "has-updates"
  /** Nothing to do (no body, or nothing to build from it). */
  | "skipped"
  /** Build or write failed; the note is untouched and stays repairable. */
  | "failed";

export type RepairSummary = Record<RepairOutcome, number>;

export function emptyRepairSummary(): RepairSummary {
  return { seeded: 0, already: 0, "has-updates": 0, skipped: 0, failed: 0 };
}

export function tallyRepair(summary: RepairSummary, outcome: RepairOutcome): RepairSummary {
  return { ...summary, [outcome]: summary[outcome] + 1 };
}

/** Repair ONE note from its markdown. Never throws — the caller is usually a
 * background sweep and a blank note is not worth breaking the module over. */
export async function repairNote(
  runtime: ModuoRuntime,
  workspaceId: string,
  noteId: string,
  bodyMd: string,
): Promise<RepairOutcome> {
  let built: ReturnType<typeof buildDocStateFromMarkdown>;
  try {
    built = buildDocStateFromMarkdown(noteId, bodyMd);
  } catch (e) {
    // Lexical refused this markdown. `body_md` is untouched and still
    // searchable/exportable, so leave the note alone rather than half-seed it.
    // Logged because such a note stays in the work list and will be retried
    // (and re-fail) on every module load — silence would hide that loop.
    console.warn("[notes-repair] could not build doc", noteId, e);
    return "failed";
  }
  if (!built) return "skipped";

  try {
    const res = await runtime.notesV2.seedDoc({
      workspaceId,
      noteId,
      docStateB64: built.docStateB64,
      // DELIBERATELY null. The stored `body_md` is the FAITHFUL source (the
      // raw imported file, or what the connector wrote); `deriveBody` is a
      // lossy walker — it drops link URLs, inline bold/italic markers, line
      // breaks within a block, and flattens tables. Writing the derivation
      // back would silently degrade the only good copy, and `body_md` feeds
      // search (`search_tsv`), the published page, `.md` export and the MCP
      // connector. The op's `coalesce(p_body_md, body_md)` keeps it intact.
      bodyText: null,
      bodyMd: null,
    });
    if (res.seeded) return "seeded";
    return res.reason === "has_updates" ? "has-updates" : "already";
  } catch (e) {
    console.warn("[notes-repair] seed failed", noteId, e);
    return "failed";
  }
}

/**
 * Sweep a workspace's un-materialized notes.
 *
 * Runs on notes-module load so the designer's already-imported tree repairs
 * itself without having to open every note one by one. Bounded per pass
 * (`limit`) so a huge legacy import can't stall the module; the next load
 * picks up where this one left off, because a repaired note stops matching.
 *
 * `onRepaired` lets the caller refresh a note that is open right now.
 */
export async function repairUnmaterializedNotes(
  runtime: ModuoRuntime,
  workspaceId: string,
  options: {
    limit?: number;
    onRepaired?: (noteId: string) => void;
    /** Drain THIS device's queued CRDT updates before reading the work list.
     * Without it, a note the old in-editor seeder materialized locally but
     * never managed to push still looks empty server-side — we would seed it,
     * and the queued local seed would then merge in as a SECOND copy. Draining
     * first turns that note into a `has_updates` refusal instead. */
    drainLocalFirst?: () => Promise<void>;
    /** Stop between notes (unmount / workspace switch). */
    shouldStop?: () => boolean;
  } = {},
): Promise<RepairSummary> {
  let summary = emptyRepairSummary();

  if (options.drainLocalFirst) {
    try {
      await options.drainLocalFirst();
    } catch {
      // A drain failure means we can't rule out an unpushed local doc, so
      // seeding now could duplicate content. Skipping is the safe direction —
      // the note stays blank and repairs on a later load.
      return summary;
    }
  }

  let pending: { id: string; bodyMd: string }[];
  try {
    pending = await runtime.notesV2.listUnmaterialized({
      workspaceId,
      limit: options.limit ?? 200,
    });
  } catch {
    return summary;
  }

  for (const note of pending) {
    if (options.shouldStop?.()) break;
    const outcome = await repairNote(runtime, workspaceId, note.id, note.bodyMd);
    summary = tallyRepair(summary, outcome);
    if (outcome === "seeded") options.onRepaired?.(note.id);
  }
  return summary;
}
