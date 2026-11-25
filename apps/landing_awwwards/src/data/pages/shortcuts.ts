// The shortcuts page (/shortcuts): every key Moduo answers to, read from the app on 27 October
// 2026 (apps/app/src/lib/shortcuts.ts, lib/hotkeys/registry.ts, the email legend and the notes
// editor's task line). A shortcut is a list of chords; a chord is a set of keys pressed together.
// Keys are named by the physical key (KeyboardEvent.code without its prefix): "Mod" is ⌘ on a Mac
// and Ctrl on Windows, "Ctrl" is the Mac's ⌃. The module jumps follow the order of your tabs, so
// the page never pins a number to a module.

export type Key =
  | "Mod"
  | "Shift"
  | "Alt"
  | "Ctrl"
  | "Escape"
  | "Enter"
  | "Space"
  | "Backspace"
  | "Up"
  | "Down"
  | "Left"
  | "Right"
  | "Slash"
  | "Comma"
  | "BracketLeft"
  | "Equal"
  | "F11"
  | `Digit${number}`
  | `Key${string}`;

export type Shortcut = {
  /** One or more chords that do the same thing ("J or ↓"). */
  keys: Key[][];
  does: string;
  /** Mac only or Windows only (full screen). */
  only?: "mac" | "win";
  /** The chords are the ends of a run (⌘1 to ⌘7), not a list. */
  range?: true;
  /** The chords are two ways to do one thing (J or ↓). */
  or?: true;
};

export type ShortcutGroup = { id: string; name: string; where: string; items: Shortcut[] };

const k = (...chords: string[]) => chords.map((c) => c.split("+") as Key[]);

export const shortcuts = {
  title: "Keyboard shortcuts",
  description:
    "Every keyboard shortcut in Moduo for Mac and Windows: search, capture, email triage, tasks, focus, notes, calendar and chat, with a live keyboard to try them on.",
  name: "Shortcuts",
  line: "Every key Moduo answers to, in one place.",
  lead: "Press ? anywhere in the app and this list opens. Here it is with a keyboard to try it on, so your hands learn it before your first invite.",
  platforms: { mac: "Mac", win: "Windows" },
  board: {
    label: "Try a shortcut",
    idle: "Press a shortcut on your keyboard. Its keys light up here, with what it does.",
    idleTouch: "Tap a shortcut in the list to light its keys and read what it does.",
    none: "Nothing in Moduo on this one.",
    caption: {
      mac: "A Mac keyboard. On Windows, Ctrl does what ⌘ does and Alt what ⌥ does.",
      win: "A Windows keyboard. On a Mac, ⌘ does what Ctrl does and ⌥ what Alt does.",
    },
  },
  more: "Some keys mean something else on another page: T makes a task in Email and opens today in Calendar. The page you are on decides.",
  groups: [
    {
      id: "everywhere",
      name: "Everywhere",
      where: "Anywhere in the app, from any module.",
      items: [
        { keys: k("Mod+KeyK"), does: "Search and jump to anything" },
        { keys: k("Mod+Shift+KeyK"), does: "Quick capture, even mid-sentence" },
        { keys: k("Mod+KeyN"), does: "New item in the module you are in" },
        { keys: k("Mod+Shift+KeyN"), does: "New note, from anywhere" },
        { keys: k("Mod+Comma"), does: "Open settings" },
        { keys: k("Mod+Shift+KeyW"), does: "Switch workspace" },
        { keys: k("Mod+Slash"), does: "Open notifications" },
        { keys: k("Shift+Slash"), does: "Show every shortcut" },
        {
          keys: k("Mod+Digit1", "Mod+Digit7"),
          range: true,
          does: "Jump to a module, in the order of your tabs",
        },
        { keys: k("Ctrl+Mod+KeyF"), does: "Full screen", only: "mac" },
        { keys: k("F11"), does: "Full screen", only: "win" },
      ],
    },
    {
      id: "panel",
      name: "The side panel",
      where: "When something is open in the panel on the right.",
      items: [
        { keys: k("Escape"), does: "Back out of the open item" },
        { keys: k("Alt+Digit1", "Alt+Digit9"), range: true, does: "Switch the panel’s view" },
      ],
    },
    {
      id: "email",
      name: "Email",
      where: "In the desktop app’s inbox. Press ? there for this list.",
      items: [
        { keys: k("KeyJ", "KeyK"), does: "Next or previous conversation" },
        { keys: k("Enter"), does: "Open the conversation" },
        { keys: k("KeyR"), does: "Reply" },
        { keys: k("KeyE"), does: "Archive" },
        { keys: k("KeyT"), does: "Turn the email into a task" },
        { keys: k("KeyS"), does: "Snooze" },
        { keys: k("KeyM"), does: "Move to a folder" },
        { keys: k("KeyP"), does: "Pin or unpin" },
        { keys: k("Shift+Digit3"), does: "Delete" },
        { keys: k("Slash"), does: "Search mail" },
      ],
    },
    {
      id: "tasks",
      name: "Tasks",
      where: "In Tasks, on a task’s own page, and in Focus.",
      items: [
        { keys: k("Slash"), does: "Search tasks" },
        { keys: k("KeyF"), does: "Filter tasks" },
        { keys: k("KeyJ", "Down"), or: true, does: "Next task, on a task’s page" },
        { keys: k("KeyK", "Up"), or: true, does: "Previous task, on a task’s page" },
        { keys: k("Escape", "Mod+BracketLeft"), or: true, does: "Close the task" },
        { keys: k("Enter"), does: "Focus: done, or take the offer" },
        { keys: k("KeyC"), does: "Focus: capture a thought" },
        { keys: k("KeyS"), does: "Focus: skip" },
        { keys: k("KeyW"), does: "Focus: hand off" },
        { keys: k("Shift+KeyF"), does: "Focus: make it the Now card" },
      ],
    },
    {
      id: "notes",
      name: "Notes",
      where: "While you write.",
      items: [
        { keys: k("Mod+Shift+KeyT"), does: "Make the checkbox line a task" },
        { keys: k("Slash"), does: "Link a task, a note or a contact" },
        { keys: k("Shift+Digit2"), does: "Mention a person" },
      ],
    },
    {
      id: "calendar",
      name: "Calendar",
      where: "In the calendar, nothing selected.",
      items: [
        { keys: k("KeyT"), does: "Go to today" },
        { keys: k("KeyD"), does: "Day view" },
        { keys: k("KeyW"), does: "Week view" },
        { keys: k("Left", "Right"), does: "Previous or next day or week" },
        { keys: k("Backspace"), does: "Delete the selected event" },
      ],
    },
    {
      id: "chat",
      name: "Chat",
      where: "On Duo and Team, anywhere in Chat.",
      items: [
        { keys: k("Alt+Up", "Alt+Down"), does: "Previous or next conversation" },
        { keys: k("Alt+Shift+Down"), does: "Next unread conversation" },
        { keys: k("Mod+KeyN"), does: "New conversation here" },
        { keys: k("Alt+Digit1", "Alt+Digit2", "Alt+Digit3"), does: "Details, reply chains, files" },
        { keys: k("Enter", "Mod+Enter"), or: true, does: "Send" },
        { keys: k("Shift+Enter"), does: "New line" },
        { keys: k("Up"), does: "Edit your last message, from an empty box" },
        { keys: k("KeyR", "KeyE", "Shift+Equal"), does: "On a message: reply, edit, react" },
        {
          keys: k("KeyP", "KeyT", "KeyM", "KeyH"),
          does: "On a message: pin, make a task, move, remind me",
        },
        { keys: k("Mod+Backspace"), does: "Delete your message" },
        { keys: k("Shift+Up", "Shift+Down"), does: "Select several messages" },
        { keys: k("Escape"), does: "Step back: a menu, a quote, a selection, a panel" },
        {
          keys: k("KeyR", "Space", "KeyT", "KeyH", "Enter"),
          does: "Catch up: reply, done, task, later, open",
        },
      ],
    },
    {
      id: "home",
      name: "Home",
      where: "On your dashboard.",
      items: [
        { keys: k("Left", "Right"), does: "Previous or next page" },
        { keys: k("Escape"), does: "Leave edit mode" },
      ],
    },
  ] satisfies ShortcutGroup[],
} as const;
