// Right-clicking a task of a selection acts on the selection (TV-U12; 82a:
// "the same menu as right-clicking a selection"). The page publishes its
// selection's actions here; the one context menu (`task-context-menu.tsx`)
// reads them only while it's open, so no row redraws when the selection
// changes (TV-D11b).

import { useSyncExternalStore } from "react";

import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "../../../components/ui/context-menu";
import { tasksWord } from "../bulk";
import type { BulkPickerKind } from "./use-bulk-actions";

export type SelectionMenu = {
  ids: ReadonlySet<string>;
  /** Every selected task is closed: Complete reads Reopen. */
  allClosed: boolean;
  /** Section and Team have something to offer. */
  sections: boolean;
  teams: boolean;
  complete: () => void;
  focus: () => void;
  remove: () => void;
  open: (kind: BulkPickerKind) => void;
};

let current: SelectionMenu | null = null;
const listeners = new Set<() => void>();

/** The page's selection, or null when one task (or none) is selected. */
export function publishSelectionMenu(menu: SelectionMenu | null): void {
  if (current === menu) return;
  current = menu;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The selection's menu when `taskId` is one of two or more selected, else null. */
export function useSelectionMenuFor(taskId: string): SelectionMenu | null {
  const menu = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  return menu && menu.ids.size >= 2 && menu.ids.has(taskId) ? menu : null;
}

/**
 * The selection's items: the bar's row and its More, with their keys. A
 * picker opens once the menu has closed (`afterClose`), or the menu's focus
 * return would take the keys from it.
 */
export function SelectionMenuItems({
  menu,
  afterClose,
}: {
  menu: SelectionMenu;
  afterClose: (action: () => void) => void;
}) {
  const pick = (kind: BulkPickerKind) => () => afterClose(() => menu.open(kind));
  return (
    <>
      <ContextMenuItem onSelect={menu.complete}>
        {menu.allClosed ? "Reopen" : "Complete"} {tasksWord(menu.ids.size)}
        <ContextMenuShortcut>Space</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={menu.focus}>
        Focus
        <ContextMenuShortcut>Q</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={pick("assign")}>
        Assign…
        <ContextMenuShortcut>@</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={pick("tag")}>
        Tag…
        <ContextMenuShortcut>#</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={pick("date")}>
        Date…
        <ContextMenuShortcut>D</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={pick("move")}>
        Move…
        <ContextMenuShortcut>B</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={pick("status")}>
        Status…
        <ContextMenuShortcut>⇧S</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem disabled={!menu.sections} onSelect={pick("section")}>
        Section…
      </ContextMenuItem>
      <ContextMenuItem onSelect={pick("priority")}>
        Priority…
        <ContextMenuShortcut>P</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={pick("waiting")}>Waiting on…</ContextMenuItem>
      <ContextMenuItem disabled={!menu.teams} onSelect={pick("team")}>
        Team…
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={menu.remove}>
        Delete {tasksWord(menu.ids.size)}
        <ContextMenuShortcut>⌫</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  );
}

/** The menu's items: the selection's, when this task is one of several selected. */
export function SelectionAware({
  taskId,
  afterClose,
  children,
}: {
  taskId: string;
  afterClose: (action: () => void) => void;
  children: React.ReactNode;
}) {
  const menu = useSelectionMenuFor(taskId);
  return menu ? <SelectionMenuItems menu={menu} afterClose={afterClose} /> : children;
}
