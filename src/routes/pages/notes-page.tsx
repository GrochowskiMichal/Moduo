import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { useNotes } from "../../features/notes/hooks/use-notes";
import { NotesSplitView } from "../../features/notes/ui/NotesSplitView";
import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";

export function NotesPage() {
  const { runtime, userId, configError } = useAuth();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();
  const [workspaceMembers, setWorkspaceMembers] = useState<any[]>([]);
  const notesState = useNotes(runtime, {
    userId,
    workspaceId: selectedWorkspaceId,
    modulePermission: modulePermissions.notes,
  });

  const canRender = useMemo(
    () => !!runtime && !!userId && !!selectedWorkspaceId && !configError && modulePermissions.notes !== "none",
    [configError, modulePermissions.notes, runtime, selectedWorkspaceId, userId]
  );

  useEffect(() => {
    if (!runtime || !selectedWorkspaceId || modulePermissions.notes === "none") {
      setWorkspaceMembers([]);
      return;
    }

    let active = true;
    void runtime.workspace.listMembers(selectedWorkspaceId)
      .then((members) => {
        if (active) setWorkspaceMembers(members);
      })
      .catch(() => {
        if (active) setWorkspaceMembers([]);
      });

    return () => {
      active = false;
    };
  }, [modulePermissions.notes, runtime, selectedWorkspaceId]);

  if (!canRender) {
    return (
      <FeaturePanelsShell
        feature="notes"
        center={
          <div className="grid h-full place-content-center gap-2 text-center text-muted-foreground">
            <h2 className="text-foreground font-display text-2xl">Notes unavailable</h2>
            <p className="text-sm">
              {configError ??
                (modulePermissions.notes === "none"
                  ? "You do not have Notes access in this workspace."
                  : "Authentication, workspace, or desktop runtime is missing.")}
            </p>
          </div>
        }
      />
    );
  }

  return (
    <NotesSplitView
      notes={notesState.notes}
      workspaceId={selectedWorkspaceId!}
      selectedNoteId={notesState.selectedNoteId}
      onSelectNote={notesState.setSelectedNoteId}
      onCreateNote={(parentId, kind) => notesState.createNote(parentId ?? null, kind)}
      onMoveNote={(noteId, parentId, beforeId) => notesState.moveNote(noteId, parentId, beforeId ?? null)}
      onUpdateTitle={notesState.updateNoteTitle}
      onUpdateTags={notesState.updateNoteTags}
      onDeleteNote={notesState.deleteNote}
      onDuplicateNote={notesState.duplicateNote}
      onTogglePin={notesState.togglePin}
      onUpdateSharing={notesState.updateNoteSharing}
      workspaceMembers={workspaceMembers}
      currentUserId={userId}
      readOnly={!notesState.canEdit}
      syncEngine={notesState.syncEngine}
    />
  );
}
