/**
 * The editor ↔ notes-module bridge (Wave-3 NO-4). Decorator nodes and plugins
 * inside the Lexical tree need live module data (note titles for page-rows)
 * and module actions (open a note, create a child) without threading props
 * through Lexical — this context is provided by NoteEditor from the page.
 */

import { createContext, useContext } from "react";
import type { Note } from "../model";

export type NotesEditorBridge = {
  /** Live meta for a note id (page-row titles/icons follow renames). */
  getNoteMeta: (noteId: string) => Note | null;
  /** Select/open a note (URL-held selection on /notes). */
  openNote: (noteId: string) => void;
  /** Create a child of the CURRENT note; returns the new id (null = can't). */
  createChildNote: () => string | null;
};

export const NotesEditorBridgeContext = createContext<NotesEditorBridge | null>(null);

export function useNotesEditorBridge(): NotesEditorBridge | null {
  return useContext(NotesEditorBridgeContext);
}

/** Window event the sidebar fires when a child is created while its parent is
 * open in the editor — the page-row mirror appends via the canonical Lexical
 * path (never raw Yjs XML). */
export const INSERT_PAGE_ROW_EVENT = "moduo:notes:insert-page-row";

export type InsertPageRowDetail = { parentId: string; childId: string };
