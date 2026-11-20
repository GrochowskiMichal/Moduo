import { useEffect } from "react";

import { type AppHotkeyHandlers, type HotkeyId, isMacPlatform, useAppHotkeys } from "./hotkeys";

export { isMacPlatform };

/**
 * Global keyboard shortcuts. The keys themselves live in the hotkey registry
 * (lib/hotkeys/registry.ts, scope "global"); the hook installed in
 * app-chrome.tsx fires custom DOM events, and each feature listens for the
 * events it cares about (palette, notifications, workspace switcher, etc.).
 * This list is what the shortcut sheet and hints display.
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
  | "module-6"
  | "module-7";

export type ShortcutEntry = {
  id: ShortcutId;
  label: string;
  /** Mac key combo for display (e.g. "⌘K"). */
  mac: string;
  /** Non-mac key combo for display (e.g. "Ctrl K"). */
  other: string;
  /** What to show in a browser when it keeps the desktop key for itself (⌘N). */
  web?: { mac: string; other: string };
};

export const SHORTCUTS: ReadonlyArray<ShortcutEntry> = [
  {
    id: "palette",
    label: "Command palette",
    mac: "⌘K",
    other: "Ctrl K",
  },
  {
    // The app's capture (components/app/capture-shell.tsx, SH-1): opens as a
    // Task; inside it ⌘1–7 switch the type (tasks-v3 call 90b). Sits next to
    // the ⌘K palette as its write-instead-of-search sibling. Like the palette it
    // fires even from inputs/editors (capture must reach you mid-typing).
    id: "capture",
    label: "Quick capture",
    mac: "⌘⇧K",
    other: "Ctrl Shift K",
  },
  {
    id: "new-item",
    label: "New item",
    mac: "⌘N",
    other: "Ctrl N",
    web: { mac: "⌥N", other: "Alt N" },
  },
  {
    // Global capture (Wave-3 Notes AC1): a fresh note from anywhere.
    id: "new-note",
    label: "New note",
    mac: "⌘⇧N",
    other: "Ctrl Shift N",
    web: { mac: "⌥⇧N", other: "Alt Shift N" },
  },
  {
    id: "settings",
    label: "Settings",
    mac: "⌘,",
    other: "Ctrl ,",
  },
  {
    id: "workspace-switcher",
    label: "Workspace switcher",
    mac: "⌘⇧W",
    other: "Ctrl Shift W",
  },
  {
    id: "notifications",
    label: "Notifications",
    mac: "⌘/",
    other: "Ctrl /",
  },
  {
    // App-wide keyboard-shortcuts help sheet. On most layouts Shift+/ resolves to
    // `event.key === "?"`, but some layouts / synthetic key events deliver
    // `key === "/"` with shiftKey set — the registry's Shift+/ accepts both. A
    // page that wants its own `?` (email's triage legend) binds it in its route
    // scope with `overrides: true`, and the narrower scope wins (TS-6).
    id: "help",
    label: "Keyboard shortcuts",
    mac: "?",
    other: "?",
  },
  // Module shortcuts ⌘1..⌘7 navigate to the Nth visible module tab in the
  // top bar. The count matches the max number of visible tabs (7 with Chat;
  // Mindmap hidden in DF-4 — keep this in sync with baseModulesNavItems so no tab
  // loses its ⌘N and no shortcut points past the list). On the dev:web build
  // these collide with the browser's built-in tab-switching shortcuts (most
  // browsers reserve Cmd/Ctrl+1..9 for tabs). moduo is Tauri-first, so we accept
  // the collision and do NOT preventDefault at a level that would fight the
  // browser. In Tauri there is no browser chrome to compete with.
  ...(["1", "2", "3", "4", "5", "6", "7"] as const).map((digit): ShortcutEntry => ({
    id: `module-${digit}` as ShortcutId,
    label: `Module ${digit}`,
    mac: `⌘${digit}`,
    other: `Ctrl ${digit}`,
  })),
];

const SHORTCUT_EVENT_PREFIX = "moduo:shortcut:";

export function shortcutEvent(id: ShortcutId): string {
  return `${SHORTCUT_EVENT_PREFIX}${id}`;
}

/** The desktop app's own window: no browser takes keys before the page. */
function inDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function formatShortcut(
  entry: ShortcutEntry,
  isMac = isMacPlatform(),
  web = !inDesktopShell(),
): string {
  const keys = web && entry.web ? entry.web : entry;
  return isMac ? keys.mac : keys.other;
}

/**
 * Mount on AppChrome to dispatch shortcut events globally. Each registry
 * binding in the "global" scope fires its `moduo:shortcut:<id>` event; a page
 * that binds the same key in its own scope wins it (email's `?`), and a key a
 * nearer handler already claimed (`defaultPrevented`) never reaches here.
 */
export function useGlobalShortcuts(): void {
  const handlers: AppHotkeyHandlers = {};
  for (const entry of SHORTCUTS) {
    handlers[entry.id satisfies HotkeyId] = () => {
      window.dispatchEvent(new CustomEvent(shortcutEvent(entry.id)));
    };
  }
  useAppHotkeys(handlers);
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

// ── Chat's key map, as the shortcut sheet lists it (chat v2 §16, CV-22) ──────
// Chat binds these itself, each in its scope (the conversation page, the
// composer, a selected message, Catch up, the chain panel); this list only
// says them. Keep it in step with specs/chat-v2.md §16.

export type ChatKeyScope =
  "Anywhere in Chat" | "The composer" | "A message" | "Catch up" | "The chain panel";

export type ChatKeyRow = { scope: ChatKeyScope; keys: string[]; desc: string };

export function chatKeyRows(isMac = isMacPlatform()): ChatKeyRow[] {
  const opt = isMac ? "⌥" : "Alt ";
  const mod = isMac ? "⌘" : "Ctrl ";
  const shift = isMac ? "⇧" : "Shift ";
  return [
    {
      scope: "Anywhere in Chat",
      keys: [`${opt}↑`, `${opt}↓`],
      desc: "Previous / next conversation",
    },
    { scope: "Anywhere in Chat", keys: [`${opt}${shift}↓`], desc: "Next unread conversation" },
    { scope: "Anywhere in Chat", keys: [`${mod}N`], desc: "New conversation here" },
    {
      scope: "Anywhere in Chat",
      keys: [`${opt}1`, `${opt}2`, `${opt}3`],
      desc: "Details · Reply chains · Files",
    },
    {
      scope: "Anywhere in Chat",
      keys: ["Esc"],
      desc: "Step back: menu, quote, selection, panel, Catch up",
    },
    { scope: "The composer", keys: ["⏎", `${mod}⏎`], desc: "Send" },
    { scope: "The composer", keys: [`${shift}⏎`], desc: "New line" },
    { scope: "The composer", keys: ["↑"], desc: "Edit your last message (empty box)" },
    { scope: "A message", keys: ["R", "E", "+"], desc: "Reply · edit · react" },
    {
      scope: "A message",
      keys: ["P", "T", "M", "H"],
      desc: "Pin · make a task · move · remind me",
    },
    { scope: "A message", keys: [`${mod}⌫`], desc: "Delete your message" },
    { scope: "A message", keys: [`${shift}↑`, `${shift}↓`], desc: "Select several" },
    {
      scope: "Catch up",
      keys: ["R", "Space", "T", "H", "⏎"],
      desc: "Reply · Done · task · Later · open",
    },
    { scope: "The chain panel", keys: ["⏎", "Esc"], desc: "Reply in the chain · back" },
  ];
}
