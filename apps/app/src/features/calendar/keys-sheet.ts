// Calendar's part of the keys sheet (CALR-4, AC22): read from the hotkey
// registry, so a key the sheet shows is the key that fires.

import { type HotkeyId, HOTKEYS, keysFor } from "../../lib/hotkeys/registry";

export type CalendarKeyGroup = "Anywhere in Calendar" | "The grid" | "An event";

export type CalendarKeyRow = {
  group: CalendarKeyGroup;
  /** The registry bindings the row speaks for (HotkeyIds). */
  ids: string[];
  keys: string[];
  desc: string;
};

type RowSpec = {
  group: CalendarKeyGroup;
  ids: HotkeyId[];
  desc: string;
  /** A chord to show instead of each binding's first key (⌫ over Delete). */
  show?: string[];
};

const ROWS: RowSpec[] = [
  { group: "Anywhere in Calendar", ids: ["calendar.today"], desc: "Today" },
  {
    group: "Anywhere in Calendar",
    ids: ["calendar.day", "calendar.week", "calendar.month"],
    desc: "Day · Week · Month",
  },
  {
    group: "Anywhere in Calendar",
    ids: ["calendar.prev", "calendar.next"],
    desc: "Previous / next period",
  },
  { group: "Anywhere in Calendar", ids: ["calendar.all-day"], desc: "Show every all-day row" },
  { group: "Anywhere in Calendar", ids: ["calendar.join"], desc: "Join the meeting on now" },
  { group: "Anywhere in Calendar", ids: ["calendar.undo"], desc: "Undo the last change" },
  {
    group: "Anywhere in Calendar",
    ids: ["calendar.zone"],
    desc: "Show or hide a second time zone",
  },
  { group: "Anywhere in Calendar", ids: ["calendar.plan"], desc: "Open Plan when it's folded" },
  {
    group: "Anywhere in Calendar",
    ids: ["calendar.place-task"],
    desc: "Place the Plan task you picked: ⇥ next free time, arrows adjust, F focus time, ↵ places, esc lets go",
  },
  { group: "Anywhere in Calendar", ids: ["calendar.find-task"], desc: "Find a task in Plan" },
  {
    group: "The grid",
    ids: [
      "calendar.cursor-up",
      "calendar.cursor-down",
      "calendar.cursor-left",
      "calendar.cursor-right",
    ],
    desc: "Move the cursor (a busy slot picks its event)",
  },
  {
    group: "The grid",
    ids: ["calendar.next-event", "calendar.prev-event"],
    desc: "Next / previous event",
  },
  {
    group: "The grid",
    ids: ["calendar.card"],
    desc: "Open the card, or go into the Event panel",
  },
  {
    group: "The grid",
    ids: ["calendar.open"],
    desc: "Open the event, or a new event at the cursor",
  },
  {
    group: "The grid",
    ids: ["calendar.paste"],
    desc: "Paste a copied event at the cursor (else the next free time)",
  },
  {
    group: "An event",
    ids: ["calendar.earlier", "calendar.later"],
    desc: "15 minutes earlier / later",
  },
  {
    group: "An event",
    ids: ["calendar.prev-day", "calendar.next-day"],
    desc: "A day earlier / later",
  },
  { group: "An event", ids: ["calendar.shorter", "calendar.longer"], desc: "Shorter / longer" },
  { group: "An event", ids: ["calendar.copy"], desc: "Copy" },
  { group: "An event", ids: ["calendar.duplicate"], desc: "Duplicate, right after it" },
  {
    group: "An event",
    ids: ["calendar.delete"],
    desc: "Delete (Undo brings it back)",
    show: ["Backspace"],
  },
  { group: "An event", ids: ["calendar.add-meet"], desc: "Add a Meet link" },
  { group: "An event", ids: ["calendar.private"], desc: "Make private or public" },
  { group: "An event", ids: ["calendar.link"], desc: "Link a person, note or task" },
];

const KEY_NAMES: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "↵",
  Backspace: "⌫",
  Delete: "Del",
  Space: "Space",
};

const MAC_MODS: Record<string, string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", Mod: "⌘" };
const OTHER_MODS: Record<string, string> = {
  Control: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
  Mod: "Ctrl",
};
const MOD_ORDER = ["Control", "Alt", "Shift", "Mod"];

/** "Mod+Shift+J" → "⇧⌘J" on a Mac, "Ctrl Shift J" elsewhere. */
export function formatChord(chord: string, isMac: boolean): string {
  const parts = chord.split("+");
  const key = parts.pop() ?? "";
  const mods = MOD_ORDER.filter((m) => parts.includes(m));
  const names = isMac ? MAC_MODS : OTHER_MODS;
  const keyName = KEY_NAMES[key] ?? key.toUpperCase();
  return isMac
    ? `${mods.map((m) => names[m]).join("")}${keyName}`
    : [...mods.map((m) => names[m]), keyName].join(" ");
}

export function calendarKeyRows(isMac: boolean): CalendarKeyRow[] {
  return ROWS.map((row) => {
    const chords =
      row.show ?? row.ids.map((id) => String(keysFor(HOTKEYS[id], isMac)[0] ?? "")).filter(Boolean);
    return {
      group: row.group,
      ids: row.ids,
      keys: chords.map((c) => formatChord(c, isMac)),
      desc: row.desc,
    };
  });
}
