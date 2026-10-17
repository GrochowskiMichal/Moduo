/**
 * Global "create a new item in the current feature" plumbing.
 *
 * Both the bottom bar's + button and the Cmd-N shortcut dispatch
 * `moduo:create:new`. Each feature listens for this event from inside its
 * page / workspace component and decides what creating a new item means in
 * that context — a new note, a new mindmap, a new scene, a list when more
 * than one thing can be added, etc.
 */

export const CREATE_NEW_EVENT = "moduo:create:new";

export function dispatchCreateNew(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CREATE_NEW_EVENT));
}

export function onCreateNew(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CREATE_NEW_EVENT, handler);
  return () => window.removeEventListener(CREATE_NEW_EVENT, handler);
}
