import type { NoteKind } from "../types";

export const NOTES_TOGGLE_SIDEBAR_EVENT = "moduo:notes:toggle-sidebar";
export const NOTES_FOCUS_SEARCH_EVENT = "moduo:notes:focus-search";
export const NOTES_CREATE_KIND_EVENT = "moduo:notes:create-kind";

export type NotesCreateKindEventDetail = {
  kind: NoteKind;
};

export function dispatchNotesToggleSidebar() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NOTES_TOGGLE_SIDEBAR_EVENT));
}

export function dispatchNotesFocusSearch() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NOTES_FOCUS_SEARCH_EVENT));
}

export function dispatchNotesCreateKind(kind: NoteKind) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<NotesCreateKindEventDetail>(NOTES_CREATE_KIND_EVENT, {
      detail: { kind },
    })
  );
}
