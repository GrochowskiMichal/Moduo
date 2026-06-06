import type { NoteKind } from "../types";

export const NOTES_TOGGLE_SIDEBAR_EVENT = "moduo:notes:toggle-sidebar";
export const NOTES_FOCUS_SEARCH_EVENT = "moduo:notes:focus-search";
export const NOTES_CREATE_KIND_EVENT = "moduo:notes:create-kind";
export const NOTES_INSERT_CHILD_LINK_EVENT = "moduo:notes:insert-child-link";

export type NotesCreateKindEventDetail = {
  kind: NoteKind;
};

export type NotesInsertChildLinkEventDetail = {
  parentId: string;
  childId: string;
  childTitle: string;
};

const PENDING_CHILD_LINKS_KEY = "moduo:notes:pending-child-links";

function readPendingChildLinks(): NotesInsertChildLinkEventDetail[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PENDING_CHILD_LINKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingChildLinks(links: NotesInsertChildLinkEventDetail[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PENDING_CHILD_LINKS_KEY, JSON.stringify(links));
  } catch {
    // ignore storage failures; the live event path still works.
  }
}

export function queueNotesChildLink(detail: NotesInsertChildLinkEventDetail): void {
  const links = readPendingChildLinks();
  const exists = links.some((link) => link.parentId === detail.parentId && link.childId === detail.childId);
  if (!exists) writePendingChildLinks([...links, detail]);
}

export function consumeNotesChildLinks(parentId: string): NotesInsertChildLinkEventDetail[] {
  const links = readPendingChildLinks();
  const matching = links.filter((link) => link.parentId === parentId);
  if (matching.length > 0) {
    writePendingChildLinks(links.filter((link) => link.parentId !== parentId));
  }
  return matching;
}

export function clearQueuedNotesChildLink(parentId: string, childId: string): void {
  const links = readPendingChildLinks();
  writePendingChildLinks(links.filter((link) => link.parentId !== parentId || link.childId !== childId));
}

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

export function dispatchNotesInsertChildLink(detail: NotesInsertChildLinkEventDetail) {
  if (typeof window === "undefined") return;
  queueNotesChildLink(detail);
  window.dispatchEvent(
    new CustomEvent<NotesInsertChildLinkEventDetail>(NOTES_INSERT_CHILD_LINK_EVENT, {
      detail,
    })
  );
}
