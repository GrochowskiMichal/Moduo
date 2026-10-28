// The one typed list of the app's keyboard shortcuts (TS-6, specs/tanstack-spine.md).
// Every key the app binds on the document goes here, with the scope it lives in;
// components bind them through `useAppHotkeys` (./use-app-hotkeys.ts). The tests in
// registry.test.ts fail on a duplicate binding inside one scope and on a narrower
// scope that shadows a wider one's key without saying so (`overrides`).
//
// Keys that stay outside this list on purpose: element-local `onKeyDown` handlers
// on a focused widget (the Tasks list's j/k, menus, pickers), Lexical editor
// commands, and transient listeners that live only during a gesture (drags, the
// timeline canvas). They own the focused element, so no scope has to win for them.
import { areHotkeysEqual, type HotkeyChord as Hotkey } from "@tanstack/hotkeys";

/** A route's scope: active while its page is mounted. */
export type RouteScope = "tasks" | "chat" | "notes" | "calendar" | "contacts" | "home" | "email";

/** A surface inside a route (a full-page view that replaces the list). */
export type SurfaceScope = "task-page" | "focus" | "catchup";

/**
 * Where a binding fires. `global` is always on; a route scope while its page is
 * mounted; a surface, `panel` (the right panel) and `modal` (capture, dialogs)
 * while mounted and enabled. When two active scopes bind the same key, the
 * narrower (nested, else the most recently opened) one wins, so a page beats a
 * global key by scope, never by listener order.
 */
export type HotkeyScope = "global" | RouteScope | SurfaceScope | "panel" | "modal";

/** The scopes a surface sits inside, for the shadowing rule. */
export const SCOPE_PARENT: Record<Exclude<HotkeyScope, "global">, HotkeyScope> = {
  tasks: "global",
  chat: "global",
  notes: "global",
  calendar: "global",
  contacts: "global",
  home: "global",
  email: "global",
  "task-page": "tasks",
  focus: "tasks",
  catchup: "chat",
  panel: "global",
  modal: "global",
};

/** A key, or one that exists only on one platform (fullscreen: ⌃⌘F on a Mac, F11 elsewhere). */
export type HotkeyKey = Hotkey | { key: Hotkey; only: "mac" | "other" };

export type HotkeyDef = {
  scope: HotkeyScope;
  label: string;
  keys: readonly HotkeyKey[];
  /** Fires from a text field or a Lexical editor too. Off by default. */
  inInputs?: boolean;
  /** Deliberately shadows the same key in a wider scope (email's `?` over the sheet). */
  overrides?: boolean;
};

const MODULE_DIGITS = ["1", "2", "3", "4", "5", "6", "7"] as const;

export const HOTKEYS = {
  // ── global (app-chrome) ─────────────────────────────────────────────────────
  // ⌘K and ⌘⇧K fire even from fields and editors: search and capture must reach
  // you mid-typing, and neither is a text-editing key.
  palette: { scope: "global", label: "Command palette", keys: ["Mod+K"], inInputs: true },
  capture: { scope: "global", label: "Quick capture", keys: ["Mod+Shift+K"], inInputs: true },
  "new-item": { scope: "global", label: "New item", keys: ["Mod+N"] },
  "new-note": { scope: "global", label: "New note", keys: ["Mod+Shift+N"] },
  settings: { scope: "global", label: "Settings", keys: ["Mod+,"] },
  "workspace-switcher": { scope: "global", label: "Workspace switcher", keys: ["Mod+Shift+W"] },
  notifications: { scope: "global", label: "Notifications", keys: ["Mod+/"] },
  // Shift+/ matches both `key === "?"` and `key === "/"` with Shift (some layouts
  // and synthetic events deliver the latter; docs/gotchas/ui.md).
  help: { scope: "global", label: "Keyboard shortcuts", keys: ["Shift+/"] },
  // ⌘1–7: the Nth visible module tab (7 = the most tabs the top bar shows).
  "module-1": { scope: "global", label: "Module 1", keys: ["Mod+1"] },
  "module-2": { scope: "global", label: "Module 2", keys: ["Mod+2"] },
  "module-3": { scope: "global", label: "Module 3", keys: ["Mod+3"] },
  "module-4": { scope: "global", label: "Module 4", keys: ["Mod+4"] },
  "module-5": { scope: "global", label: "Module 5", keys: ["Mod+5"] },
  "module-6": { scope: "global", label: "Module 6", keys: ["Mod+6"] },
  "module-7": { scope: "global", label: "Module 7", keys: ["Mod+7"] },
  fullscreen: {
    scope: "global",
    label: "Toggle full screen",
    keys: [
      { key: "Control+Meta+F", only: "mac" },
      { key: "F11", only: "other" },
    ],
  },

  // ── modal: the capture shell, while open ────────────────────────────────────
  "capture.type": {
    scope: "modal",
    label: "Switch the capture's type",
    keys: MODULE_DIGITS.map((d) => `Mod+${d}` as Hotkey),
    inInputs: true,
    overrides: true,
  },

  // ── panel: the right panel ─────────────────────────────────────────────────
  "panel.back": { scope: "panel", label: "Back out of the open item", keys: ["Escape"] },
  "panel.view": {
    scope: "panel",
    label: "Switch the panel's view",
    keys: ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => `Alt+${d}` as Hotkey),
  },

  // ── tasks ──────────────────────────────────────────────────────────────────
  "tasks.search": { scope: "tasks", label: "Search tasks", keys: ["/"] },
  "tasks.filter": { scope: "tasks", label: "Filter tasks", keys: ["F"] },
  "task-page.close": { scope: "task-page", label: "Close the task", keys: ["Escape", "Mod+["] },
  "task-page.prev": { scope: "task-page", label: "Previous task", keys: ["ArrowUp", "K"] },
  "task-page.next": { scope: "task-page", label: "Next task", keys: ["ArrowDown", "J"] },
  "focus.enter": { scope: "focus", label: "Done · take the offer", keys: ["Enter"] },
  "focus.decline": { scope: "focus", label: "Decline the offer", keys: ["Escape"] },
  "focus.capture": { scope: "focus", label: "Capture", keys: ["C"] },
  "focus.skip": { scope: "focus", label: "Skip", keys: ["S"] },
  "focus.hand-off": { scope: "focus", label: "Hand off", keys: ["W"] },
  "focus.promote": { scope: "focus", label: "Make it the Now card", keys: ["Shift+F"] },

  // ── chat ───────────────────────────────────────────────────────────────────
  // ⌥↑/⌥↓ walk conversations from the composer too (chat-keys.spec.ts).
  "chat.prev": {
    scope: "chat",
    label: "Previous conversation",
    keys: ["Alt+ArrowUp"],
    inInputs: true,
  },
  "chat.next": {
    scope: "chat",
    label: "Next conversation",
    keys: ["Alt+ArrowDown"],
    inInputs: true,
  },
  "chat.prev-unread": {
    scope: "chat",
    label: "Previous unread",
    keys: ["Alt+Shift+ArrowUp"],
    inInputs: true,
  },
  "chat.next-unread": {
    scope: "chat",
    label: "Next unread",
    keys: ["Alt+Shift+ArrowDown"],
    inInputs: true,
  },
  "catchup.down": { scope: "catchup", label: "Next item", keys: ["ArrowDown"] },
  "catchup.up": { scope: "catchup", label: "Previous item", keys: ["ArrowUp"] },
  "catchup.leave": { scope: "catchup", label: "Leave Catch up", keys: ["Escape"] },
  "catchup.done": { scope: "catchup", label: "Done", keys: ["Space"] },
  "catchup.open": { scope: "catchup", label: "Open", keys: ["Enter"] },
  "catchup.reply": { scope: "catchup", label: "Reply", keys: ["R"] },
  "catchup.task": { scope: "catchup", label: "Make a task", keys: ["T"] },
  "catchup.later": { scope: "catchup", label: "Later", keys: ["H"] },

  // ── calendar ───────────────────────────────────────────────────────────────
  "calendar.today": { scope: "calendar", label: "Today", keys: ["T", "Shift+T"] },
  "calendar.day": { scope: "calendar", label: "Day view", keys: ["D", "Shift+D"] },
  "calendar.week": { scope: "calendar", label: "Week view", keys: ["W", "Shift+W"] },
  "calendar.month": { scope: "calendar", label: "Month view", keys: ["M", "Shift+M"] },
  "calendar.prev": { scope: "calendar", label: "Previous period", keys: ["ArrowLeft"] },
  "calendar.next": { scope: "calendar", label: "Next period", keys: ["ArrowRight"] },
  "calendar.delete": {
    scope: "calendar",
    label: "Delete the event",
    keys: ["Delete", "Backspace"],
  },
  "calendar.add-meet": { scope: "calendar", label: "Add a Meet link", keys: ["V"] },
  "calendar.link": { scope: "calendar", label: "Link a person, note or task", keys: ["L"] },
  "calendar.private": { scope: "calendar", label: "Make private or public", keys: ["P"] },
  "calendar.join": { scope: "calendar", label: "Join the meeting on now", keys: ["Mod+Shift+J"] },
  "calendar.all-day": {
    scope: "calendar",
    label: "Show every all-day row",
    keys: ["Shift+A"],
  },

  // ── home (dashboard) ───────────────────────────────────────────────────────
  "home.prev-page": { scope: "home", label: "Previous page", keys: ["ArrowLeft"] },
  "home.next-page": { scope: "home", label: "Next page", keys: ["ArrowRight"] },
  "home.exit-edit": { scope: "home", label: "Leave edit mode", keys: ["Escape"] },

  // ── email ──────────────────────────────────────────────────────────────────
  "email.next": { scope: "email", label: "Next thread", keys: ["J"] },
  "email.prev": { scope: "email", label: "Previous thread", keys: ["K"] },
  "email.open": { scope: "email", label: "Open the thread", keys: ["Enter"] },
  "email.archive": { scope: "email", label: "Archive", keys: ["E"] },
  "email.pin": { scope: "email", label: "Pin", keys: ["P"] },
  "email.delete": { scope: "email", label: "Delete", keys: ["Shift+3"] },
  "email.move": { scope: "email", label: "Move", keys: ["M"] },
  "email.snooze": { scope: "email", label: "Snooze", keys: ["S"] },
  "email.convert": { scope: "email", label: "Make a task", keys: ["T"] },
  "email.reply": { scope: "email", label: "Reply", keys: ["R"] },
  // Email's own `?` (the triage legend) beats the app-wide sheet on /email.
  "email.legend": {
    scope: "email",
    label: "Triage keys",
    keys: ["Shift+/"],
    overrides: true,
  },
  "email.search": { scope: "email", label: "Search mail", keys: ["/"] },
} as const satisfies Record<string, HotkeyDef>;

export type HotkeyId = keyof typeof HOTKEYS;

export type HotkeyRegistry = Readonly<Record<string, HotkeyDef>>;

/** The keys a binding has on this platform. */
export function keysFor(def: HotkeyDef, isMac: boolean): Hotkey[] {
  const out: Hotkey[] = [];
  for (const k of def.keys) {
    if (typeof k === "string") out.push(k);
    else if ((k.only === "mac") === isMac) out.push(k.key);
  }
  return out;
}

const PLATFORMS = [
  { isMac: true, platform: "mac" },
  { isMac: false, platform: "windows" },
] as const;

function shareAKey(a: HotkeyDef, b: HotkeyDef): string | null {
  for (const { isMac, platform } of PLATFORMS) {
    for (const ka of keysFor(a, isMac)) {
      for (const kb of keysFor(b, isMac)) {
        if (areHotkeysEqual(ka, kb, platform)) return ka;
      }
    }
  }
  return null;
}

/** Two bindings in one scope on the same key (on either platform). */
export function findDuplicateBindings(registry: HotkeyRegistry): string[] {
  const ids = Object.keys(registry);
  const problems: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = registry[ids[i]];
      const b = registry[ids[j]];
      if (a.scope !== b.scope) continue;
      const key = shareAKey(a, b);
      if (key) problems.push(`${ids[i]} and ${ids[j]} both bind ${key} in "${a.scope}"`);
    }
    // One binding listing the same key twice would fire its handler twice.
    const own = registry[ids[i]];
    for (const { isMac, platform } of PLATFORMS) {
      const keys = keysFor(own, isMac);
      keys.forEach((k, n) => {
        if (keys.slice(n + 1).some((other) => areHotkeysEqual(k, other, platform))) {
          problems.push(`${ids[i]} lists ${k} twice`);
        }
      });
    }
  }
  return [...new Set(problems)];
}

function ancestors(scope: HotkeyScope): HotkeyScope[] {
  const out: HotkeyScope[] = [];
  let current: HotkeyScope = scope;
  while (current !== "global") {
    current = SCOPE_PARENT[current];
    out.push(current);
  }
  return out;
}

/** A binding that hides a wider scope's key without `overrides: true`. */
export function findUndeclaredShadows(registry: HotkeyRegistry): string[] {
  const problems: string[] = [];
  for (const [id, def] of Object.entries(registry)) {
    if (def.scope === "global" || def.overrides) continue;
    const wider = new Set(ancestors(def.scope));
    for (const [otherId, other] of Object.entries(registry)) {
      if (!wider.has(other.scope)) continue;
      const key = shareAKey(def, other);
      if (key) problems.push(`${id} shadows ${otherId} on ${key} without overrides: true`);
    }
  }
  return problems;
}
