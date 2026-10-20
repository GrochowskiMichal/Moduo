// The workspace's structure around projects: areas (TV-D10's ops; the
// sidebar's area headers, TV-U6), sections (the List's "+ Add section",
// TV-U10) and the old per-person time blocks.

import { toast } from "sonner";
import type { LabelColor } from "../../../components/tag-colors";
import type { OverlayChange } from "../../../lib/sync/store";
import { undoToast } from "../../../lib/undo-toast";
import { setBucketTimeBlock } from "../default-view";
import type { Area, Section, TimeBlockSlot } from "../model";
import { areaMoveAfter, storedBucketColor } from "../sidebar";
import type { TaskCommandsContext } from "./context";
import { patchOf, type Shared } from "./shared";

export function createStructureOps(ctx: TaskCommandsContext, shared: Shared) {
  const { store, runtime, workspaceId, data, env, setTimeBlocks } = ctx;
  const { editBlocked, failed, refused } = shared;

  // ── areas ─────────────────────────────────────────────────────────────────
  /**
   * Run an area op: `changes` show at once, the areas it answers become the
   * copy. `sync` reads what else changed first (a delete or restore re-files
   * projects on the server). Errors show and put back only these changes.
   */
  const runAreaOp = (
    op: () => Promise<Area[]>,
    changes: OverlayChange[] = [],
    opts?: { sync?: boolean },
  ): Promise<Area[] | null> => {
    if (editBlocked() || !store) return Promise.resolve(null);
    const write = store.begin(changes);
    return op().then(
      async (next) => {
        if (opts?.sync) await store.syncNow().catch(() => undefined);
        write.settle({ areas: next });
        return next;
      },
      (e) => {
        refused(write, e, "Couldn't save the area.");
        return null;
      },
    );
  };

  /** A new workspace area at the end of the sidebar (everyone who reads Tasks
   *  sees it); answers with the new area's id. */
  const createArea = async (name: string): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const known = new Set(data().areas.map((a) => a.id));
    const next = await runAreaOp(() =>
      runtime!.tasks.createArea({ workspaceId: workspaceId!, name: trimmed }),
    );
    return next?.find((a) => !known.has(a.id))?.id ?? null;
  };

  const renameArea = (areaId: string, name: string) => {
    const trimmed = name.trim();
    const existing = data().areas.find((a) => a.id === areaId);
    if (!existing || !trimmed || trimmed === existing.name) return;
    void runAreaOp(
      () =>
        runtime!.tasks.updateArea({
          workspaceId: workspaceId!,
          areaId,
          patch: { name: trimmed },
        }),
      [{ table: "areas", patch: { id: areaId, fields: { name: trimmed } } }],
    );
  };

  const setAreaColor = (areaId: string, color: LabelColor) => {
    const existing = data().areas.find((a) => a.id === areaId);
    const next = storedBucketColor(color);
    if (!existing || existing.color === next) return;
    void runAreaOp(
      () =>
        runtime!.tasks.updateArea({ workspaceId: workspaceId!, areaId, patch: { color: next } }),
      [{ table: "areas", patch: { id: areaId, fields: { color: next } } }],
    );
  };

  /** Move an area one place up or down in the sidebar. */
  const moveArea = (areaId: string, direction: "up" | "down") => {
    const after = areaMoveAfter(data().areas, areaId, direction);
    if (after === undefined) return;
    void runAreaOp(() =>
      runtime!.tasks.moveArea({ workspaceId: workspaceId!, areaId, afterAreaId: after }),
    );
  };

  /** Delete an area: its projects become area-less, nothing else changes
   *  (Edge cases "Structure moves"). Undo restores it and re-files them. */
  const deleteArea = (areaId: string) => {
    const d = data();
    const existing = d.areas.find((a) => a.id === areaId);
    if (!existing) return;
    const filed = d.allBuckets.filter((b) => b.areaId === areaId);
    void runAreaOp(
      () =>
        runtime!.tasks.updateArea({
          workspaceId: workspaceId!,
          areaId,
          patch: { deleted: true },
        }),
      [
        { table: "areas", remove: areaId },
        ...filed.map(
          (b) =>
            ({
              table: "buckets",
              patch: { id: b.id, fields: { areaId: null } },
            }) as OverlayChange,
        ),
      ],
      { sync: true },
    ).then((next) => {
      if (!next) return;
      undoToast(`“${existing.name}” deleted`, {
        description: "Its projects stay, without an area.",
        onUndo: () => {
          void runAreaOp(
            () =>
              runtime!.tasks.updateArea({
                workspaceId: workspaceId!,
                areaId,
                patch: { deleted: false },
              }),
            [],
            { sync: true },
          );
        },
      });
    });
  };

  // ── sections ──────────────────────────────────────────────────────────────
  /** Run a section op and take the project's sections it answers. */
  const runSectionOp = (
    op: () => Promise<Section[]>,
    changes: OverlayChange[] = [],
    opts?: { sync?: boolean },
  ): Promise<Section[] | null> => {
    if (editBlocked() || !store) return Promise.resolve(null);
    const write = store.begin(changes);
    return op().then(
      async (next) => {
        if (opts?.sync) await store.syncNow().catch(() => undefined);
        write.settle({ sections: next });
        return next;
      },
      (e) => {
        refused(write, e, "Couldn't save the section.");
        return null;
      },
    );
  };

  /** A new section at the end of a project; answers with its id. */
  const createSection = async (projectId: string, name: string): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed || !runtime || !workspaceId) return null;
    const id = crypto.randomUUID();
    const next = await runSectionOp(() =>
      runtime.tasks.createSection({
        workspaceId,
        projectId,
        id,
        fields: { name: trimmed },
      }),
    );
    return next ? id : null;
  };

  const renameSection = (sectionId: string, name: string) => {
    const trimmed = name.trim();
    const existing = data().sections.find((s) => s.id === sectionId);
    if (!existing || !trimmed || trimmed === existing.name || !runtime || !workspaceId) return;
    void runSectionOp(
      () => runtime.tasks.updateSection({ workspaceId, sectionId, patch: { name: trimmed } }),
      [{ table: "sections", patch: { id: sectionId, fields: { name: trimmed } } }],
    );
  };

  /**
   * A section's dates (the Timeline's diamond and band, TV-TL2): an end date,
   * or a start and an end (YYYY-MM-DD; null clears). Shown at once, one write;
   * with `label`, a toast whose Undo puts the old dates back unless they
   * changed again since (Undo never overwrites a newer change).
   */
  const setSectionDates = (
    sectionId: string,
    dates: { startsOn: string | null; endsOn: string | null },
    label?: string,
  ): Promise<boolean> => {
    const existing = data().sections.find((s) => s.id === sectionId);
    if (!existing || !runtime || !workspaceId) return Promise.resolve(false);
    if (existing.startsOn === dates.startsOn && existing.endsOn === dates.endsOn) {
      return Promise.resolve(false);
    }
    const before = { startsOn: existing.startsOn, endsOn: existing.endsOn };
    const save = (to: typeof dates) =>
      runSectionOp(
        () => runtime.tasks.updateSection({ workspaceId, sectionId, patch: to }),
        [{ table: "sections", patch: { id: sectionId, fields: to } }],
      );
    return save(dates).then((next) => {
      if (!next) return false;
      if (label) {
        undoToast(label, {
          onUndo: () => {
            const now = store?.getSnapshot().bundle.sections?.find((s) => s.id === sectionId);
            if (!now) return;
            if (now.startsOn !== dates.startsOn || now.endsOn !== dates.endsOn) {
              toast("Undo kept a newer change.");
              return;
            }
            void save(before);
          },
        });
      }
      return true;
    });
  };

  /**
   * Delete a section: its tasks stay in the project, under No section (the
   * op clears their section). Undo restores the section and puts back the
   * tasks that are still under No section in the same project (one changed
   * since keeps its newer place).
   */
  const deleteSection = (sectionId: string) => {
    const d = data();
    const existing = d.sections.find((s) => s.id === sectionId);
    if (!existing || !runtime || !workspaceId || !store) return;
    const members = d.allTasks
      .filter((t) => t.sectionId === sectionId && !t.deletedAt)
      .map((t) => ({ id: t.id, bucketId: t.bucketId }));
    void runSectionOp(
      () => runtime.tasks.updateSection({ workspaceId, sectionId, patch: { deleted: true } }),
      [
        { table: "sections", remove: sectionId },
        ...members.map((m) => patchOf(m.id, { sectionId: null })),
      ],
      { sync: true },
    ).then((next) => {
      if (!next) return;
      const count = members.length;
      undoToast(`“${existing.name}” deleted`, {
        description:
          count === 0
            ? undefined
            : `${count === 1 ? "Its task stays" : `Its ${count} tasks stay`} in the project, under No section.`,
        onUndo: () => {
          void runSectionOp(
            () =>
              runtime.tasks.updateSection({ workspaceId, sectionId, patch: { deleted: false } }),
            [],
            { sync: true },
          ).then(async (restored) => {
            if (!restored) return;
            // Only the ones still where the delete left them.
            const tasks = data().allTasks;
            const back = members.filter((m) => {
              const now = tasks.find((t) => t.id === m.id);
              return !!now && !now.deletedAt && !now.sectionId && now.bucketId === m.bucketId;
            });
            if (back.length === 0) return;
            const write = store.begin(back.map((m) => patchOf(m.id, { sectionId })));
            // Each task goes back on its own: one refused never undoes the others.
            const results = await Promise.allSettled(
              back.map((m) =>
                runtime.tasks.updateTask({ workspaceId, taskId: m.id, patch: { sectionId } }),
              ),
            );
            const rows = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
            // The saved rows become the copy; a refused one's overlay goes with the op.
            write.settle({ tasks: rows });
            const refusal = results.find((r) => r.status === "rejected");
            if (refusal) {
              const left = results.length - rows.length;
              failed(
                refusal.reason,
                `Couldn't put ${left === 1 ? "a task" : `${left} tasks`} back in the section.`,
              );
            }
          });
        },
      });
    });
  };

  // ── time blocks ───────────────────────────────────────────────────────────
  /**
   * Assign a bucket to a time-of-day slot (or clear it with `slot = null`).
   * Optimistic; persisted per person via the runtime (spec §9). The sidebar no
   * longer offers it ("Open at" retired, REPLAN 30); TV-D7 drops the table.
   */
  const setTimeBlock = (bucketId: string, slot: TimeBlockSlot | null) => {
    if (editBlocked()) return;
    const before = env().timeBlocks;
    const next = setBucketTimeBlock(before, bucketId, slot);
    setTimeBlocks(next);
    void runtime!.tasks.setTimeBlocks({ workspaceId: workspaceId!, blocks: next }).catch((e) => {
      setTimeBlocks((now) => (now === next ? before : now));
      failed(e, "Something went wrong.");
    });
  };

  return {
    createArea,
    renameArea,
    setAreaColor,
    moveArea,
    deleteArea,
    createSection,
    renameSection,
    setSectionDates,
    deleteSection,
    setTimeBlock,
  };
}
