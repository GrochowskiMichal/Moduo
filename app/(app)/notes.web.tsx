import { useMemo } from "react";
import { useAuth } from "../../src/providers/auth-provider";
import { useWorkspace } from "../../src/providers/workspace-provider";
import { useNotes } from "../../src/features/notes/hooks/use-notes";
import { NotesSplitView } from "../../src/features/notes/ui/NotesSplitView";
import { FeaturePanelsShell } from "../../src/components/app/feature-panels-shell";

export default function NotesWebScreen() {
  const { supabase, userId, configError } = useAuth();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();
  const notesState = useNotes(supabase, {
    userId,
    workspaceId: selectedWorkspaceId,
    modulePermission: modulePermissions.notes,
  });

  const canRender = useMemo(
    () => !!supabase && !!userId && !!selectedWorkspaceId && !configError && modulePermissions.notes !== "none",
    [configError, modulePermissions.notes, selectedWorkspaceId, supabase, userId]
  );

  if (!canRender) {
    return (
      <FeaturePanelsShell
        feature="notes"
        center={
          <div className="grid h-full place-content-center gap-2 text-center text-[#d4d8e1]">
            <h2>Notes unavailable</h2>
            <p>
              {configError ??
                (modulePermissions.notes === "none"
                  ? "You do not have Notes access in this workspace."
                  : "Authentication, workspace, or Supabase connection is missing.")}
            </p>
          </div>
        }
      />
    );
  }

  return (
    <NotesSplitView
      notes={notesState.notes}
      selectedNoteId={notesState.selectedNoteId}
      onSelectNote={notesState.setSelectedNoteId}
      onCreateNote={(parentId, kind) => notesState.createNote(parentId ?? null, kind)}
      onMoveNote={(noteId, parentId, beforeId) => notesState.moveNote(noteId, parentId, beforeId ?? null)}
      onUpdateTitle={notesState.updateNoteTitle}
      onUpdateTags={notesState.updateNoteTags}
      onDeleteNote={notesState.deleteNote}
      onDuplicateNote={notesState.duplicateNote}
      onTogglePin={notesState.togglePin}
      readOnly={!notesState.canEdit}
      syncStatus={notesState.syncStatus}
      syncEngine={notesState.syncEngine}
    />
  );
}
