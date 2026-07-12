// Hub row enrichment (DF-7). Turns the set of linked entity refs into the live
// `snippetMeta` bag the roll-up projectors read (a task's status/due, a note's
// touched-at, an event's when) — plus the open-task keys the contact rollup
// already needed. ONE batched read per module, gated on the presence of that
// module's links (never an N-per-row fan-out — AC6). Each read degrades on its
// own: a failing/absent module drops its meta, the hub still renders its links.
//
// Email is intentionally omitted — it is desktop-only (no cheap cloud batch
// read), and its registry label is already the subject; a desktop follow-up can
// register email meta the same way.

import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { entityRefKey } from "../../spine/rollup";
import type { HubSnippetMeta } from "../../spine/snippet-projectors";

export type HubEnrichment = {
  /** Live per-entity meta for row snippets, keyed by `entityRefKey`. */
  snippetMeta: Map<string, HubSnippetMeta>;
  /** `entityRefKey`s of linked tasks still open (status ≠ done/archived). */
  openTaskKeys: Set<string>;
};

const EMPTY: HubEnrichment = { snippetMeta: new Map(), openTaskKeys: new Set() };

/**
 * Build the snippet meta + open-task keys for a hub's linked refs. Reads tasks /
 * notes / calendar bundles once each (only for the modules actually linked), in
 * parallel. Safe to call with any ref set; returns empty meta if none match.
 */
export async function enrichHubRows(
  runtime: ModuoRuntime,
  workspaceId: string,
  refs: EntityRef[],
): Promise<HubEnrichment> {
  if (!refs.length) return EMPTY;

  const wantTask = new Set(refs.filter((r) => r.type === "task").map((r) => r.id));
  const wantNote = new Set(refs.filter((r) => r.type === "note").map((r) => r.id));
  const wantEvent = new Set(refs.filter((r) => r.type === "event").map((r) => r.id));

  const snippetMeta = new Map<string, HubSnippetMeta>();
  const openTaskKeys = new Set<string>();

  // Each read is deferred into its own promise chain (`Promise.resolve().then`)
  // so that even a synchronous throw — e.g. a partial runtime whose `notesV2` /
  // `calendar` slice is absent — becomes a caught rejection that drops only that
  // module's meta, never the whole hub.
  await Promise.all([
    wantTask.size
      ? Promise.resolve()
          .then(() => runtime.tasks.list(workspaceId))
          .then((bundle) => {
            for (const t of bundle.tasks) {
              const open = t.status !== "done" && t.status !== "archived";
              const key = entityRefKey({ type: "task", id: t.id });
              if (open) openTaskKeys.add(key);
              if (!wantTask.has(t.id)) continue;
              snippetMeta.set(key, { kind: "task", status: t.status, dueDate: t.dueDate });
            }
          })
          .catch(() => {})
      : null,
    wantNote.size
      ? Promise.resolve()
          .then(() => runtime.notesV2.listMeta(workspaceId))
          .then((bundle) => {
            for (const n of bundle.notes) {
              if (!wantNote.has(n.id)) continue;
              snippetMeta.set(entityRefKey({ type: "note", id: n.id }), {
                kind: "note",
                updatedAt: n.updatedAt,
                isPinned: n.isPinned,
                isArchived: n.isArchived,
              });
            }
          })
          .catch(() => {})
      : null,
    wantEvent.size
      ? Promise.resolve()
          .then(() => runtime.calendar.listModule(workspaceId))
          .then((bundle) => {
            for (const e of bundle.events) {
              if (!wantEvent.has(e.id)) continue;
              // `startsAt` is the series anchor for a recurring event, so a
              // repeating meeting's snippet reflects its FIRST occurrence, not the
              // next one (the cheap batch read carries no expansion). One-off
              // events — the common contact link — are exact.
              snippetMeta.set(entityRefKey({ type: "event", id: e.id }), {
                kind: "event",
                startsAt: e.startsAt,
                endsAt: e.endsAt,
                allDay: e.allDay,
              });
            }
          })
          .catch(() => {})
      : null,
  ]);

  return { snippetMeta, openTaskKeys };
}
