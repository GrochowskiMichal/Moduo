/**
 * Notes right panel — Detail variant (NO-7, AC8): the spine payoff surface for
 * a note. Tags + auto-suggested links + the grouped links hub + the activity
 * trail, all reusing the shared spine components with `entityType: "note"`
 * (mirrors the ContactHub composition). Read-only for view-only members.
 */

import { useEffect, useState } from "react";
import { ActivityTrail } from "@/features/contacts/ui/activity-trail";
import { EntityTagRow } from "@/features/contacts/ui/entity-tag-row";
import { useEntityHub } from "@/features/spine/hooks/use-entity-hub";
import { EntityHub } from "@/features/spine/ui/entity-hub";
import { EntityLinkSuggestions } from "@/features/spine/ui/link-suggestion-strip";
import type { ActivityEntry } from "@/features/tasks/model";
import type { EntityLink, EntityRef, RelationKind } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { NOTE_DETAIL_REFRESH_EVENT } from "../editor/notes-editor-bridge";

type Props = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  noteId: string;
  canEdit: boolean;
  currentUserId: string | null;
  onOpenEntity?: (ref: EntityRef) => void;
};

export function NoteDetailPanel({
  runtime,
  workspaceId,
  noteId,
  canEdit,
  currentUserId,
  onOpenEntity,
}: Props) {
  const focus: EntityRef = { type: "note", id: noteId };
  const { status, sections, reload } = useEntityHub(runtime, workspaceId, focus);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  // A drag-onto-hub link (NO-7b) is written by the page; re-pull so the new edge
  // appears without a re-select.
  useEffect(() => {
    const onRefresh = () => reload();
    window.addEventListener(NOTE_DETAIL_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(NOTE_DETAIL_REFRESH_EVENT, onRefresh);
  }, [reload]);

  useEffect(() => {
    if (!runtime || !workspaceId) {
      setActivity([]);
      return;
    }
    let active = true;
    void runtime.tasks
      // No `module` filter — a note's trail spans every module that linked/
      // commented on it (CO-2 made the filter optional for spine entities).
      .listActivity({ workspaceId, entityType: "note", entityId: noteId, limit: 12 })
      .then((rows) => {
        if (active) setActivity(rows);
      })
      .catch(() => {
        if (active) setActivity([]);
      });
    return () => {
      active = false;
    };
  }, [runtime, workspaceId, noteId]);

  const onChangeKind =
    canEdit && runtime && workspaceId
      ? (link: EntityLink, kind: RelationKind) =>
          void runtime.spine
            .setLinkKind({ workspaceId, linkId: link.id, relationKind: kind })
            .then(reload)
      : undefined;
  const onUnlink =
    canEdit && runtime && workspaceId
      ? (link: EntityLink) =>
          void runtime.spine.deleteLink({ workspaceId, linkId: link.id }).then(reload)
      : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto scrollbar-thin pb-6">
      {/* key: remount per note so tag state never leaks across a focus switch. */}
      <EntityTagRow
        key={`note:${noteId}`}
        runtime={runtime}
        workspaceId={workspaceId}
        focus={focus}
        canEdit={canEdit}
      />
      {canEdit ? (
        <EntityLinkSuggestions
          runtime={runtime}
          workspaceId={workspaceId}
          focus={focus}
          onLinked={reload}
        />
      ) : null}
      <EntityHub
        variant="rail"
        status={status}
        sections={sections}
        canEdit={canEdit}
        onOpen={onOpenEntity}
        onChangeKind={onChangeKind}
        onUnlink={onUnlink}
        onRetry={reload}
      />
      <ActivityTrail
        activity={activity}
        currentUserId={currentUserId}
        now={new Date()}
        entityId={noteId}
      />
    </div>
  );
}
