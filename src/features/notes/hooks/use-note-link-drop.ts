/**
 * Drag-onto-hub = link (NO-7b), lifted from the classic page for the
 * refreshed shell (classic imports it too). The page owns one DndContext so a sidebar note can land in the
 * editor (a chip, handled by NotesEditorDropZone), on a sidebar row (reorder,
 * handled by the sidebar's monitor) or on a link target such as the Detail
 * hub; this handles the last: it creates a spine link.
 */

import type { DragEndEvent } from "@dnd-kit/core";
import { useCallback } from "react";
import { toast } from "sonner";
import {
  asDragPayload,
  asDropLinkTarget,
  isSelfDrop,
  targetAccepts,
} from "../../../lib/drag-payload";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { createLinkWithToast } from "../../spine/ui/drop-link-toast";
import { TASK_DETAIL_REFRESH_EVENT } from "../../tasks/ui/task-detail-panel";
import { NOTE_DETAIL_REFRESH_EVENT } from "../editor/notes-editor-bridge";

export function useNoteLinkDrop(input: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  canEdit: boolean;
}) {
  const { runtime, workspaceId, canEdit } = input;
  return useCallback(
    (event: DragEndEvent) => {
      const payload = asDragPayload(event.active.data.current);
      const target = asDropLinkTarget(event.over?.data.current);
      if (!payload || !target) return;
      if (!runtime || !workspaceId || !canEdit) return;
      if (isSelfDrop(payload, target)) {
        toast("You can’t link a note to itself");
        return;
      }
      if (!targetAccepts(target, payload)) return;
      void (async () => {
        // Guard a pre-existing edge: links_op_create is idempotent, but a fresh
        // "Undo" toast on an already-linked pair would delete a link the user
        // didn't make in THIS gesture (mirrors the FX-9 already-linked guard).
        try {
          const links = await runtime.spine.listLinks({
            workspaceId,
            entityType: target.entityType,
            entityId: target.entityId,
          });
          const already = links.some(
            (l) =>
              (l.sourceType === payload.entityType && l.sourceId === payload.entityId) ||
              (l.targetType === payload.entityType && l.targetId === payload.entityId),
          );
          if (already) {
            toast("Already linked");
            return;
          }
        } catch {
          // a failed pre-check must not block a legitimate link
        }
        await createLinkWithToast({
          runtime,
          workspaceId,
          source: payload,
          target,
          origin: "drag",
          onChanged: () => {
            window.dispatchEvent(new CustomEvent(NOTE_DETAIL_REFRESH_EVENT));
            // A note→task drop must also refresh the embedded task hub (DF-8).
            if (target.entityType === "task") {
              window.dispatchEvent(new CustomEvent(TASK_DETAIL_REFRESH_EVENT));
            }
          },
        });
      })();
    },
    [runtime, workspaceId, canEdit],
  );
}
