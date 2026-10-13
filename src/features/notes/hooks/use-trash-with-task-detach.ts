/**
 * Trash a note whose subtree holds task lines (NO-5, AC4), lifted from the
 * classic page for the refreshed shell (classic imports it too): the tasks soft-detach and survive,
 * folded into the ONE trash toast. The note↔task links are dropped (a real
 * detach, not a copy) and the toast's Undo restores the note AND the links.
 * The docs are read via the sync engine so unopened notes work too (the
 * gesture note + descendants, capped). Best-effort: a slow boot falls back to
 * the plain trash toast and never blocks the gesture.
 */

import { useCallback } from "react";
import type { EntityLink } from "../../../lib/entity-links";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { extractTaskLineIds } from "../sync/doc-text";
import { taskLinksForNote } from "../tasks/detach";
import { descendantIds } from "../tree";
import type { NotesModuleApi } from "./use-notes-module";

export function useTrashWithTaskDetach(input: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  module: Pick<NotesModuleApi, "notes" | "engine" | "trashNote">;
  deleteTask: (taskId: string) => unknown;
}) {
  const { runtime, workspaceId, module, deleteTask } = input;
  const { notes, engine, trashNote } = module;
  return useCallback(
    async (id: string) => {
      const noteIds = [id, ...descendantIds(notes, id)].slice(0, 20);
      const taskIdsByNote = new Map<string, string[]>();
      if (engine) {
        for (const noteId of noteIds) {
          try {
            const session = engine.getOrCreateSession(noteId);
            await Promise.race([
              session.booted,
              new Promise((resolve) => setTimeout(resolve, 800)),
            ]);
            const ids = extractTaskLineIds(session.doc);
            if (ids.length > 0) taskIdsByNote.set(noteId, ids);
          } catch {
            // skip this doc — honest undercount beats blocking the gesture
          }
        }
      }
      const allTaskIds = [...new Set([...taskIdsByNote.values()].flat())];

      // Drop the note↔task links (the actual detach); remember them so the
      // toast's Undo can put them back (links_op_create is idempotent).
      const dropped: {
        source: { type: string; id: string };
        target: { type: string; id: string };
        relationKind: EntityLink["relationKind"];
        origin: EntityLink["origin"];
      }[] = [];
      if (runtime && workspaceId && taskIdsByNote.size > 0) {
        try {
          for (const [noteId, ids] of taskIdsByNote) {
            const links = await runtime.spine.listLinks({
              workspaceId,
              entityType: "note",
              entityId: noteId,
            });
            const toDrop = taskLinksForNote(links, noteId, new Set(ids));
            for (const l of toDrop) {
              await runtime.spine.deleteLink({ workspaceId, linkId: l.id });
              dropped.push({
                source: { type: l.sourceType, id: l.sourceId },
                target: { type: l.targetType, id: l.targetId },
                relationKind: l.relationKind,
                origin: l.origin,
              });
            }
          }
        } catch {
          // link drop is best-effort; trash itself must never fail on it
        }
      }

      trashNote(
        id,
        allTaskIds.length > 0
          ? {
              detachedTaskIds: allTaskIds,
              onDeleteTasks: (ids) => {
                for (const taskId of ids) void deleteTask(taskId);
              },
              onUndo: () => {
                if (!runtime || !workspaceId) return;
                for (const l of dropped) {
                  void runtime.spine.createLink({ workspaceId, ...l });
                }
              },
            }
          : undefined,
      );
    },
    [engine, trashNote, deleteTask, notes, runtime, workspaceId],
  );
}
