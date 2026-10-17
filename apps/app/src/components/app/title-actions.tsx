// The open view's own actions in its host's title row (MOD-118 follow-up,
// round-2b frame 5: "Details ▾ ……… ↗ ⋯"). A host (the right panel's title row,
// the task full page's header) keeps an empty slot at its row's right end and
// wraps its body in `TitleActionsScope`; anything the body puts in
// `TitleActions` shows in that slot. The actions stay in the body's React tree,
// so they keep its state and handlers (the task's ⋯ opens the files picker of
// its own attachments strip), and they go with the body when the view or item
// changes. With no host around them (a story, a test, a body shown on its own)
// they render in place, so nothing drops them silently.
//
// Being the body's React children, their events bubble through the body's
// handlers, not the title row's: a file dragged or pasted over the task's ⋯
// reaches the task's drop zone, so its drop tint shows while over ⋯ and a
// drop there attaches the file. Harmless.

import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

/** `undefined`: no host; `null`: a host whose slot isn't mounted yet. */
const TitleActionsSlot = createContext<HTMLElement | null | undefined>(undefined);

/** A host's body: its `TitleActions` show in `slot`, the title row's right end. */
export function TitleActionsScope({
  slot,
  children,
}: {
  slot: HTMLElement | null;
  children: ReactNode;
}) {
  return <TitleActionsSlot.Provider value={slot}>{children}</TitleActionsSlot.Provider>;
}

/** The view's own actions, shown on the right of its host's title row. */
export function TitleActions({ children }: { children: ReactNode }) {
  const slot = useContext(TitleActionsSlot);
  if (slot === undefined) return <>{children}</>;
  return slot ? createPortal(children, slot) : null;
}
