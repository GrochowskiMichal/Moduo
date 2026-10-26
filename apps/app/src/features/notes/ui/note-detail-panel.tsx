/**
 * Notes right panel: Details. Built from the pieces Tasks' detail panel uses,
 * so the two read as one product: a properties block (Location, Created,
 * Edited, Tags as a property row), the Linked collection with its + picker
 * and cards, then Activity. Read-only for view-only members.
 */

import { useEffect, useState } from "react";

import { CollectionHeader } from "@/components/ui/collection-header";
import { PropertyRow } from "@/components/ui/property-row";
import { Separator } from "@/components/ui/separator";
import { ActivityTrail } from "@/features/contacts/ui/activity-trail";
import { useEntityHub } from "@/features/spine/hooks/use-entity-hub";
import { createLinkWithToast } from "@/features/spine/ui/drop-link-toast";
import { EntityTagRow } from "@/features/tags/ui/entity-tag-row";
import { feedTime } from "@/features/tasks/feed";
import type { ActivityEntry } from "@/features/tasks/model";
import { LinkedSection, sayUnlinkFailed } from "@/features/tasks/ui/task-detail-collections";
import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";

import { onNoteLinksChanged } from "../editor/notes-editor-bridge";
import type { Note } from "../model";

type Props = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  note: Note;
  /** Where the note sits: "Pages › Clients". */
  location: string;
  /** The last human editor's name, when known. */
  editedBy?: string | null;
  canEdit: boolean;
  currentUserId: string | null;
  onOpenEntity?: (ref: EntityRef) => void;
};

export function NoteDetailPanel({
  runtime,
  workspaceId,
  note,
  location,
  editedBy,
  canEdit,
  currentUserId,
}: Props) {
  const noteId = note.id;
  const focus: EntityRef = { type: "note", id: noteId };
  const { status, sections, reload } = useEntityHub(runtime, workspaceId, focus);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  // A link made elsewhere (a drop on the hub, `[[`, a task line) re-pulls.
  useEffect(() => onNoteLinksChanged(() => reload()), [reload]);

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

  const linkEntity = (ref: EntityRef, label: string, icon: string | null) => {
    if (!runtime || !workspaceId) return;
    void createLinkWithToast({
      runtime,
      workspaceId,
      source: { kind: "entity-drag", entityType: ref.type, entityId: ref.id, label, icon },
      target: { kind: "link-target", entityType: "note", entityId: noteId },
      origin: "manual",
      onChanged: reload,
    });
  };

  const now = new Date();
  return (
    <div className="pane-scroll flex h-full min-h-0 flex-col gap-5 overflow-y-auto scrollbar-thin pb-6">
      <div className="flex flex-col">
        <PropertyRow label="Location">
          <span className="min-w-0 break-words font-sans text-sm text-foreground">{location}</span>
        </PropertyRow>
        <PropertyRow label="Created">
          <span className="font-sans text-sm text-foreground">{feedTime(note.createdAt, now)}</span>
        </PropertyRow>
        <PropertyRow label="Edited">
          <span className="min-w-0 break-words font-sans text-sm text-foreground">
            {feedTime(note.updatedAt, now)}
            {editedBy ? ` by ${editedBy}` : ""}
          </span>
        </PropertyRow>
        <PropertyRow label="Tags" align="start">
          {/* key: remount per note so tag state never leaks across notes. */}
          <EntityTagRow
            key={`note:${noteId}`}
            runtime={runtime}
            workspaceId={workspaceId}
            focus={focus}
            canEdit={canEdit}
            variant="property"
            className="min-h-(--ctrl-h-sm) flex-1"
          />
        </PropertyRow>
      </div>
      <LinkedSection
        focus={focus}
        rows={sections.flatMap((s) => s.rows)}
        status={status}
        canEdit={canEdit}
        runtime={runtime}
        workspaceId={workspaceId}
        onLink={linkEntity}
        onUnlink={(row) => {
          if (!runtime || !workspaceId) return;
          void runtime.spine
            .deleteLink({ workspaceId, linkId: row.link.id })
            .then(reload)
            .catch(sayUnlinkFailed);
        }}
        onRetry={reload}
      />
      <Separator />
      <div>
        <CollectionHeader label="Activity" />
        {activity.length === 0 ? (
          <p className="font-sans text-sm text-muted-foreground">Nothing yet.</p>
        ) : null}
        <ActivityTrail
          activity={activity}
          currentUserId={currentUserId}
          now={now}
          entityId={noteId}
          showHeading={false}
        />
      </div>
    </div>
  );
}
