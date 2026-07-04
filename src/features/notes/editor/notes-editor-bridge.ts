/**
 * The editor ↔ notes-module bridge (Wave-3 NO-4). Decorator nodes and plugins
 * inside the Lexical tree need live module data (note titles for page-rows)
 * and module actions (open a note, create a child) without threading props
 * through Lexical — this context is provided by NoteEditor from the page.
 */

import { createContext, useContext } from "react";
import type { Note } from "../model";
import type { Task } from "../../tasks/model";
import type { TaskLineSnapshot } from "../tasks/detach";

/**
 * Task-line surface (NO-5) — the page owns the tasks module + all server
 * writes; the editor plugin calls through this. Every method is a no-op-safe
 * stub when Tasks aren't available (no workspace edit access).
 */
export type NotesTaskBridge = {
  canEditTasks: boolean;
  /** Live task row (bundle + just-minted overlay); null = unknown/deleted. */
  getTask: (taskId: string) => Task | null;
  /** The linkable candidates for the `/task` picker (open work, fuzzy). */
  listLinkableTasks: () => Task[];
  /** Check/uncheck — recurrence-aware toggleDone. */
  toggleTask: (taskId: string) => void;
  /** Debounced line-text → task title (renames, never clobbers). */
  renameTask: (taskId: string, lineText: string) => void;
  /** Absolute schedule (the line menu's Schedule… popover). */
  scheduleTaskAt: (taskId: string, iso: string | null) => void;
  /** Mint a note-born task (Inbox, no due) + `spawned-from` back-link.
   * Resolves with the real task — never a `tmp-` id. */
  mintTask: (title: string) => Promise<Task | null>;
  /** Link an existing task to this note (`references`). */
  linkExistingTask: (task: Task) => void;
  /** Lines left the document (delete/convert-away) — soft-detach: drop the
   * note↔task links + ONE undoable toast. `restoreLines` re-inserts them.
   * `noteId` pins the batch to the editor that produced it (an unmount
   * flush must not bill the newly selected note). */
  detachTaskLines: (input: {
    noteId: string;
    lines: TaskLineSnapshot[];
    restoreLines: () => void;
    /** "keep" (menu Detach-keep) = quiet, no toast. */
    mode: "toast" | "keep";
  }) => void;
  /** Menu "Detach and delete task": detach + soft-delete, one undo toast. */
  detachAndDeleteTask: (input: {
    noteId: string;
    line: TaskLineSnapshot;
    restoreLine: () => void;
  }) => void;
  /** ⌘Z right after minting — deletes the just-minted task + link (AC4).
   * Returns false when the task wasn't a this-session mint. */
  revertMintIfJustMinted: (taskId: string) => boolean;
  /** Redo/⌘Z re-created lines — re-link any pending detaches (idempotent). */
  restoreDetachedTasks: (taskIds: string[]) => void;
  /** Open the Task-detail rail variant for this task. */
  openTaskDetail: (taskId: string) => void;
};

export type NotesEditorBridge = {
  /** Live meta for a note id (page-row titles/icons follow renames). */
  getNoteMeta: (noteId: string) => Note | null;
  /** Select/open a note (URL-held selection on /notes). */
  openNote: (noteId: string) => void;
  /** Create a child of the CURRENT note; returns the new id (null = can't). */
  createChildNote: () => string | null;
  /** Task lines (NO-5). */
  tasks: NotesTaskBridge;
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
