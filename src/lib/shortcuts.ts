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
  | "new-item"
  | "settings"
  | "workspace-switcher"
  | "notifications"
  | "module-1"
  | "module-2"
  | "module-3"
  | "module-4"
  | "module-5"
  | "module-6"
  | "module-7";

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
      (isMac ? event.metaKey : event.ctrlKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === "w",
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
  // Module shortcuts ⌘1..⌘7 navigate to the Nth visible module tab in the
  // top bar. On the dev:web build these collide with the browser's built-in
  // tab-switching shortcuts (most browsers reserve Cmd/Ctrl+1..9 for tabs).
  // moduo is Tauri-first, so we accept the collision and do NOT preventDefault
  // at a level that would fight the browser. In Tauri there is no browser
  // chrome to compete with.
  ...(["1", "2", "3", "4", "5", "6", "7"] as const).map(
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
      // The palette shortcut should fire even from inputs so search works
      // anywhere. New-note doesn't fire from editable targets — otherwise the
      // user typing "n" in a Lexical editor would create a new note.
      const targetEditable = isEditableTarget(event.target);

      for (const entry of SHORTCUTS) {
        if (!entry.match(event, isMac)) continue;
        if (targetEditable && entry.id !== "palette") continue;
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
