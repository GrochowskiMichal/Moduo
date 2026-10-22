/**
 * The open note's spine links, shaped for its header meta line and its
 * "Linked from" footer (specs/notes-refresh.md NR-3, AC6). One hub read per
 * open note, re-pulled when a link lands (the same refresh event the Detail
 * panel listens to) and when the note's own content changes its links.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { useEntityHub } from "../../spine/hooks/use-entity-hub";
import { NOTE_DETAIL_REFRESH_EVENT } from "../editor/notes-editor-bridge";
import type { Note } from "../model";
import {
  type AgentEditMark,
  type BacklinkGroup,
  type NoteMetaLine,
  shapeBacklinks,
  shapeNoteMetaLine,
} from "../note-meta";

const EMPTY_LINE: NoteMetaLine = { chips: [], edited: null, undoable: false };

export function useNoteLinks({
  runtime,
  workspaceId,
  note,
  editedBy = null,
  agentEdit = null,
  canUndoAgent = false,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  /** The open note, or null for a draft (a draft has no links yet). */
  note: Note | null;
  /** Display name of the note's last human editor (NR-6). */
  editedBy?: string | null;
  /** The latest agent write and whether this session can undo it (NR-6). */
  agentEdit?: AgentEditMark | null;
  canUndoAgent?: boolean;
}): { line: NoteMetaLine; backlinks: BacklinkGroup[] } {
  const noteId = note?.id ?? null;
  const focus = useMemo(() => (noteId ? { type: "note", id: noteId } : null), [noteId]);
  const { status, sections, reload } = useEntityHub(runtime, workspaceId, focus);

  useEffect(() => {
    const onRefresh = () => reload();
    window.addEventListener(NOTE_DETAIL_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(NOTE_DETAIL_REFRESH_EVENT, onRefresh);
  }, [reload]);

  // Typing a mention or a chip writes a link server-side; re-pull whenever the
  // note's meta moves (a retitle, a refresh), so the line catches up quietly.
  // Only a CHANGE counts: the hub already reads once when the note opens.
  const updatedAt = note?.updatedAt ?? null;
  const lastSeen = useRef({ noteId, updatedAt });
  useEffect(() => {
    const prev = lastSeen.current;
    lastSeen.current = { noteId, updatedAt };
    if (prev.noteId === noteId && prev.updatedAt !== updatedAt && updatedAt) reload();
  }, [noteId, updatedAt, reload]);

  // The hub keeps its last sections while a reload runs (no flicker), but they
  // belong to whichever note loaded them: never show one note's links on
  // another while the new read is in flight.
  // `sections` only changes identity when a read for the CURRENT focus lands
  // (the hub drops stale responses), so that is when it starts to count.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const latestNoteId = useRef(noteId);
  latestNoteId.current = noteId;
  // Keyed on the sections' identity.
  useEffect(() => {
    setLoadedFor(latestNoteId.current);
  }, [sections]);
  const ready = noteId !== null && loadedFor === noteId && status !== "error";
  const line = useMemo(
    () =>
      note
        ? shapeNoteMetaLine({
            sections: ready ? sections : [],
            updatedAt: note.updatedAt,
            editedAt: note.editedAt ?? null,
            editedBy,
            agentEdit,
            canUndoAgent,
            now: new Date(),
          })
        : EMPTY_LINE,
    [note, ready, sections, editedBy, agentEdit, canUndoAgent],
  );
  const backlinks = useMemo(
    () => (ready && noteId ? shapeBacklinks(noteId, sections) : []),
    [ready, noteId, sections],
  );
  return { line, backlinks };
}
