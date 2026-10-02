import { useEffect } from "react";

/**
 * Global keyboard shortcuts. The hook installed in app-chrome.tsx fires
 * custom DOM events; each feature listens for the events it cares about
 * (palette, notifications, workspace switcher, etc.) and toggles its own
 * state. This keeps shortcut wiring out of every component's hot path.
 *
 * Esc-to-close is delegated to Radix primitives (Dialog, Sheet, Popover,
 * DropdownMenu) and is not handled here.
 */

export type ShortcutId =
  | "palette"
  | "capture"
  | "new-item"
  | "new-note"
  | "settings"
  | "workspace-switcher"
  | "notifications"
  | "help"
  | "module-1"
  | "module-2"
  | "module-3"
  | "module-4"
  | "module-5"
  | "module-6";

export type ShortcutEntry = {
  id: ShortcutId;
  label: string;
  /** Mac key combo for display + matching (e.g. "⌘K"). */
  mac: string;
  /** Non-mac key combo for display + matching (e.g. "Ctrl K"). */
  other: string;
  /** Predicate that returns true when a keydown matches this shortcut. */
  match: (event: KeyboardEvent, isMac: boolean) => boolean;
};

export const SHORTCUTS: ReadonlyArray<ShortcutEntry> = [
  {
    id: "palette",
    label: "Command palette",
    mac: "⌘K",
    other: "Ctrl K",
    match: (event, isMac) =>
      (isMac ? event.metaKey : event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "k",
  },
  {
    // Global capture bar (DF-20): a capture-anywhere line that creates a task by
    // default and routes to notes/events/contacts via `/`-prefixes. Sits next to
    // the ⌘K palette as its write-instead-of-search sibling. Like the palette it
    // fires even from inputs/editors (capture must reach you mid-typing).
    id: "capture",
    label: "Quick capture",
    mac: "⌘⇧K",
    other: "Ctrl Shift K",
    match: (event, isMac) =>
      (isMac ? event.metaKey : event.ctrlKey) &&
      event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "k",
  },
  {
    id: "new-item",
    label: "New item",
    mac: "⌘N",
    other: "Ctrl N",
    match: (event, isMac) =>
      (isMac ? event.metaKey : event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "n",
  },
  {
    // Global capture (Wave-3 Notes AC1): a fresh note from anywhere.
    id: "new-note",
    label: "New note",
    mac: "⌘⇧N",
    other: "Ctrl Shift N",
    match: (event, isMac) =>
      (isMac ? event.metaKey : event.ctrlKey) &&
      event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "n",
  },
  {
    id: "settings",
    label: "Settings",
    mac: "⌘,",
    other: "Ctrl ,",
    match: (event, isMac) =>
      (isMac ? event.metaKey : event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key === ",",
  },
  {
    id: "workspace-switcher",
    label: "Workspace switcher",
    mac: "⌘⇧W",
    other: "Ctrl Shift W",
    match: (event, isMac) =>
      (isMac ? event.metaKey : event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "w",
  },
  {
    id: "notifications",
    label: "Notifications",
    mac: "⌘/",
    other: "Ctrl /",
    match: (event, isMac) =>
      (isMac ? event.metaKey : event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key === "/",
  },
  {
    // App-wide keyboard-shortcuts help sheet. On most layouts Shift+/ resolves to
    // `event.key === "?"`, but some layouts / synthetic key events deliver
    // `key === "/"` with shiftKey set — accept both. No modifier gate beyond
    // ruling out ⌘/Ctrl/Alt (nothing else claims a bare Shift+/). A page that
    // wants its own `?` (email's triage legend) claims it in the CAPTURE phase so
    // it beats this bubble-phase global handler — see gotchas.
    id: "help",
    label: "Keyboard shortcuts",
    mac: "?",
    other: "?",
    match: (event) =>
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      (event.key === "?" || (event.shiftKey && event.key === "/")),
  },
  // Module shortcuts ⌘1..⌘6 navigate to the Nth visible module tab in the
  // top bar. The count matches the max number of visible tabs (6 after Mindmap
  // was hidden in DF-4 — keep this in sync with baseModulesNavItems so no tab
  // loses its ⌘N and no shortcut points past the list). On the dev:web build
  // these collide with the browser's built-in tab-switching shortcuts (most
  // browsers reserve Cmd/Ctrl+1..9 for tabs). moduo is Tauri-first, so we accept
  // the collision and do NOT preventDefault at a level that would fight the
  // browser. In Tauri there is no browser chrome to compete with.
  ...(["1", "2", "3", "4", "5", "6"] as const).map(
    (digit): ShortcutEntry => ({
      id: `module-${digit}` as ShortcutId,
      label: `Module ${digit}`,
      mac: `⌘${digit}`,
      other: `Ctrl ${digit}`,
      match: (event, isMac) =>
        (isMac ? event.metaKey : event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key === digit,
    }),
  ),
];

const SHORTCUT_EVENT_PREFIX = "moduo:shortcut:";

export function shortcutEvent(id: ShortcutId): string {
  return `${SHORTCUT_EVENT_PREFIX}${id}`;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.platform?.toLowerCase().includes("mac") ?? false;
}

export function formatShortcut(entry: ShortcutEntry, isMac = isMacPlatform()): string {
  return isMac ? entry.mac : entry.other;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if ((el as HTMLElement & { isContentEditable?: boolean }).isContentEditable) return true;
  const tag = el.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

/** Mount on AppChrome to dispatch shortcut events globally. */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isMac = isMacPlatform();

    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // The palette + capture shortcuts fire even from inputs so search and
      // quick-capture work anywhere (both are explicit ⌘ combos, never a
      // text-editing key). New-note doesn't fire from editable targets —
      // otherwise the user typing "n" in a Lexical editor would create a note.
      const targetEditable = isEditableTarget(event.target);
      const firesFromEditable = (id: ShortcutId) => id === "palette" || id === "capture";

      for (const entry of SHORTCUTS) {
        if (!entry.match(event, isMac)) continue;
        if (targetEditable && !firesFromEditable(entry.id)) continue;
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(shortcutEvent(entry.id)));
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Listen for a single shortcut event. Returns the cleanup function. */
export function onShortcut(id: ShortcutId, handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const name = shortcutEvent(id);
  window.addEventListener(name, handler);
  return () => window.removeEventListener(name, handler);
}

/** React-friendly variant of onShortcut for components. */
export function useShortcut(id: ShortcutId, handler: () => void): void {
  useEffect(() => onShortcut(id, handler), [id, handler]);
}
