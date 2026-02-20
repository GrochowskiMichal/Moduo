import React, { useEffect } from "react";
import { useNotes } from "../../../notes/hooks/use-notes";
import { LexicalNoteEditor } from "../../../notes/editor/LexicalNoteEditor";
import { WidgetConfig } from "../../types";
import { useWorkspace } from "../../../../providers/workspace-provider";
import { useAuth } from "../../../../providers/auth-provider";

interface NotesWidgetProps {
  config: WidgetConfig;
  onUpdateConfig: (config: Partial<WidgetConfig>) => void;
  isLocked: boolean;
}

export function NotesWidget({ config, onUpdateConfig, isLocked }: NotesWidgetProps) {
  const { selectedWorkspace, modulePermissions } = useWorkspace();
  const { userId, supabase } = useAuth();
  
  const { notes, loading, canEdit, createNote, updateNoteTitle, syncEngine, selectedNoteId, setSelectedNoteId } = useNotes(supabase, {
    userId,
    workspaceId: selectedWorkspace?.id ?? null,
    modulePermission: modulePermissions.notes,
  });

  const activeNoteId = config.noteId ?? selectedNoteId ?? undefined;
  const selectedNote = notes.find((note) => note.id === activeNoteId);

  useEffect(() => {
    if (!config.noteId && selectedNoteId) onUpdateConfig({ noteId: selectedNoteId });
  }, [config.noteId, onUpdateConfig, selectedNoteId]);

  useEffect(() => {
    if (activeNoteId && activeNoteId !== selectedNoteId) setSelectedNoteId(activeNoteId);
  }, [activeNoteId, selectedNoteId, setSelectedNoteId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse w-4 h-4 rounded-full bg-[#333]" />
      </div>
    );
  }

  if (!activeNoteId) {
    if (isLocked) {
      return (
        <div className="flex flex-col h-full items-center justify-center p-6 text-center space-y-4 text-[#5f6c87] text-xs">
          <span>No note selected</span>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full items-center justify-center p-6 text-center space-y-4">
        <div className="text-[#94a6cc] text-xs font-medium uppercase tracking-wide">Select Note</div>
        
        <select
          className="bg-[#1a1f2e] text-[#e5ecff] text-xs rounded-lg border border-[#2a3041] p-2.5 w-full outline-none focus:border-[#3a4359] transition-colors appearance-none cursor-pointer"
          onChange={(e) => {
            if (e.target.value) {
              onUpdateConfig({ noteId: e.target.value });
            }
          }}
          defaultValue=""
        >
          <option value="" disabled>Choose a note...</option>
          {notes.map((note) => (
            <option key={note.id} value={note.id}>
              {note.title || "Untitled"}
            </option>
          ))}
        </select>
        
        <div className="relative w-full">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-[#1e2433]"></div>
          </div>
          <div className="relative flex justify-center">
            <span className="bg-[#151a25] px-2 text-[10px] text-[#5f6c87] uppercase">or</span>
          </div>
        </div>

        <button
          className="w-full bg-[#2a3041] hover:bg-[#3a4359] text-[#e5ecff] text-xs font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
          onClick={async () => {
             const newId = await createNote(null, "note");
             if (newId) {
               onUpdateConfig({ noteId: newId });
             }
          }}
        >
          <span>+</span> Create New Note
        </button>
      </div>
    );
  }

  if (!selectedNote) {
    return (
      <div className="p-6 text-[#ef4444] text-xs flex flex-col items-center justify-center h-full text-center space-y-2">
        <span className="font-medium">Note not found</span>
        <span className="text-[#7f8ca7]">It may have been deleted or you lost access.</span>
        {!isLocked && (
          <button 
            className="mt-2 text-[#e5ecff] hover:text-white underline decoration-dashed underline-offset-4"
            onClick={() => onUpdateConfig({ noteId: undefined })}
          >
            Select another note
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#111111]">
      <div className="px-4 py-3 border-b border-[#1e1e1e] flex items-center justify-between bg-[#151515]/50">
        <input
          value={selectedNote.title}
          readOnly={isLocked || !canEdit}
          onChange={(e) => updateNoteTitle(selectedNote.id, e.target.value)}
          className="bg-transparent text-[#e5ecff] font-semibold text-sm outline-none w-full placeholder-[#5f6c87] truncate"
          placeholder="Note Title"
        />
        {!isLocked && (
          <button 
            className="text-[#5f6c87] hover:text-[#e5ecff] text-[10px] ml-2"
            onClick={() => onUpdateConfig({ noteId: undefined })}
            title="Change note"
          >
            Change
          </button>
        )}
      </div>
      <div className="flex-1 overflow-hidden relative">
        <LexicalNoteEditor
          noteId={selectedNote.id}
          title={selectedNote.title}
          editable={!isLocked && canEdit}
          onTitleChange={(value) => updateNoteTitle(selectedNote.id, value)}
          syncEngine={syncEngine!}
        />
        {/* Overlay to prevent interaction if desired, or allow read-only scrolling */}
      </div>
    </div>
  );
}
