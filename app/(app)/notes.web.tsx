import { useMemo } from "react";
import { useAuth } from "../../src/providers/auth-provider";
import { useNotes } from "../../src/features/notes/hooks/use-notes";
import { NotesSplitView } from "../../src/features/notes/ui/NotesSplitView";

export default function NotesWebScreen() {
  const { supabase, userId, configError } = useAuth();

  const notesState = useNotes(supabase, userId);

  const canRender = useMemo(() => !!supabase && !!userId && !configError, [configError, supabase, userId]);

  if (!canRender) {
    return (
      <div className="grid h-full place-content-center gap-2 text-center text-[#d4d8e1]">
        <h2>Notes unavailable</h2>
        <p>{configError ?? "Authentication or Supabase connection is missing."}</p>
      </div>
    );
  }

  if (notesState.loading || !notesState.syncEngine) {
    return (
      <div className="grid h-full place-content-center gap-2 text-center text-[#d4d8e1]">
        <h2>Loading notes...</h2>
      </div>
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
      onDeleteNote={notesState.deleteNote}
      onDuplicateNote={notesState.duplicateNote}
      onTogglePin={notesState.togglePin}
      syncStatus={notesState.syncStatus}
      syncEngine={notesState.syncEngine}
    />
  );
}
