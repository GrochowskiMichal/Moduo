// The app-wide keyboard-shortcuts help sheet (DF-16 / critique CC-10: there was
// no shortcuts legend anywhere in the shell). Opened by `?` from anywhere and by
// Help → Keyboard shortcuts in the top bar (call 96). Keys stay in lockstep with the canonical
// `SHORTCUTS` list so they can never drift from what actually fires; the
// descriptions are hand-written for clarity (the raw labels read "Module 1"…).
//
// A module can keep its own `?` legend (email's triage keys) by claiming `?` in
// the CAPTURE phase — it then beats the bubble-phase global handler and this
// sheet stays closed on that route. Mirrors the tasks/email Kbd + dialog pattern.

import { Fragment, type ReactNode, useEffect, useState } from "react";
import { formatShortcut, onShortcut, SHORTCUTS, type ShortcutId } from "../../lib/shortcuts";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Kbd } from "../ui/kbd";

const OPEN_EVENT = "moduo:shortcuts:open";

export function dispatchOpenShortcuts(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

/** Human-readable description per shortcut id (the raw labels are terse). */
const DESCRIPTIONS: Array<{ id: ShortcutId; desc: string }> = [
  { id: "palette", desc: "Search & jump to anything" },
  { id: "capture", desc: "Quick capture (task by default; /note /event /contact)" },
  { id: "new-item", desc: "New item in the current module" },
  { id: "new-note", desc: "New note from anywhere" },
  { id: "settings", desc: "Open settings" },
  { id: "workspace-switcher", desc: "Switch workspace" },
  { id: "notifications", desc: "Open notifications" },
  { id: "help", desc: "Show this help" },
];

function keyFor(id: ShortcutId): string {
  const entry = SHORTCUTS.find((s) => s.id === id);
  return entry ? formatShortcut(entry) : "";
}

// The ⌘1…⌘N module jumps collapse into one row. Both ends come from SHORTCUTS,
// so the row can't fall behind the tabs again (it read ⌘1–⌘6 after Chat
// became the 7th tab).
const MODULE_SHORTCUTS = SHORTCUTS.filter((s) => s.id.startsWith("module-"));

export function GlobalShortcutsDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => onShortcut("help", () => setOpen(true)), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const rows: Array<{ keys: ReactNode; desc: string }> = DESCRIPTIONS.map(({ id, desc }) => ({
    keys: <Kbd>{keyFor(id)}</Kbd>,
    desc,
  }));
  const firstModule = MODULE_SHORTCUTS.at(0);
  const lastModule = MODULE_SHORTCUTS.at(-1);
  if (firstModule && lastModule) {
    rows.push({
      keys: (
        <span className="flex items-center gap-1">
          <Kbd>{formatShortcut(firstModule)}</Kbd>
          <span className="text-muted-foreground">–</span>
          <Kbd>{formatShortcut(lastModule)}</Kbd>
        </span>
      ),
      desc: "Jump to a module",
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Move around Moduo without the mouse.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5">
          {rows.map(({ keys, desc }) => (
            <Fragment key={desc}>
              <dt>{keys}</dt>
              <dd className="text-sm text-muted-foreground">{desc}</dd>
            </Fragment>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
