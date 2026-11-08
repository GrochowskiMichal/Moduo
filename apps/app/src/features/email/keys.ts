// Mail's keyboard map, generated from the hotkey registry (AC42): the `?`
// legend and ⌘K's mail actions both read this, so neither can drift from the
// keys the shell actually binds.

import {
  type HotkeyBinding,
  type HotkeyDef,
  type HotkeyId,
  HOTKEYS,
  isSequenceKey,
  keysFor,
} from "@/lib/hotkeys/registry";

export type MailKeyId = Extract<HotkeyId, `email.${string}`>;

export type MailKeyEntry = { id: MailKeyId; label: string; keys: string[] };

/** A legend row: one or more registry keys under one label ("j k" next · previous).
 *  `all` lists every key of each binding ("m # ⌫"); otherwise each binding's first.
 *  A row with `show` and no ids is a key another surface owns (the composer's). */
type LegendRowDef = {
  label: string;
  ids: MailKeyId[];
  all?: boolean;
  show?: (isMac: boolean) => string[];
  /** The keys are alternatives: they read "z or ⌘Z". */
  or?: boolean;
};

type LegendGroupDef = { title: string; column: 0 | 1 | 2; rows: LegendRowDef[] };

/** The `?` sheet (specs/mail-v3.md §7): three columns Move, Act and Connect, with
 *  Select under Move and Write and More under Connect. */
const LEGEND: LegendGroupDef[] = [
  {
    title: "Move",
    column: 0,
    rows: [
      { label: "Next · previous thread", ids: ["email.next", "email.prev"] },
      { label: "Next · previous tab", ids: ["email.tab-next", "email.tab-prev"] },
      { label: "Into the thread", ids: ["email.open"] },
      { label: "Expand all messages", ids: ["email.expand-all"] },
      {
        label: "Inbox · Follow-ups · Snoozed",
        ids: ["email.go-inbox", "email.go-followups", "email.go-snoozed"],
      },
      {
        label: "Archive · Sent · Drafts",
        ids: ["email.go-archive", "email.go-sent", "email.go-drafts"],
      },
      {
        label: "Personal · your tab · Notifications · Newsletters",
        ids: [
          "email.go-personal",
          "email.go-custom",
          "email.go-notifications",
          "email.go-newsletters",
        ],
      },
      { label: "Next · previous pane", ids: ["email.pane-next", "email.pane-prev"] },
    ],
  },
  {
    title: "Select",
    column: 0,
    rows: [
      { label: "Select", ids: ["email.select"] },
      { label: "Extend down · up", ids: ["email.extend-down", "email.extend-up"] },
      { label: "All in tab", ids: ["email.select-all"] },
      { label: "Clear the selection", ids: ["email.clear-selection"] },
    ],
  },
  {
    title: "Act",
    column: 1,
    rows: [
      { label: "Done · not done", ids: ["email.archive", "email.undone"] },
      { label: "Snooze", ids: ["email.snooze"] },
      { label: "Remind me if no reply", ids: ["email.remind"] },
      { label: "Allow · block a new sender", ids: ["email.allow", "email.block"] },
      { label: "Pin · unread", ids: ["email.pin", "email.unread"] },
      { label: "Move · delete", ids: ["email.move", "email.delete"], all: true },
      { label: "Undo", ids: ["email.undo"], all: true, or: true },
    ],
  },
  {
    title: "Connect",
    column: 2,
    rows: [
      {
        label: "Today · Contact · Task",
        ids: ["email.panel-today", "email.panel-contact", "email.panel-task"],
      },
      { label: "Show or hide the panel", ids: ["email.panel-toggle"] },
      // A pointer gesture: no key cap (specs/mail-improve.md §6).
      { label: "Drag a thread onto Today or a task", ids: [], show: () => [] },
      { label: "Make a task", ids: ["email.convert"] },
      { label: "Link to a task, contact or note", ids: ["email.link"] },
      { label: "Private note", ids: ["email.note"] },
    ],
  },
  {
    title: "Write",
    column: 2,
    rows: [
      {
        label: "Reply · reply all · forward",
        ids: ["email.reply", "email.reply-all", "email.forward"],
      },
      { label: "New message", ids: ["email.compose"], all: true },
      { label: "Send", ids: [], show: (isMac) => [isMac ? "⌘↵" : "Ctrl+↵"] },
      { label: "Snippet", ids: [], show: () => [";;"] },
      { label: "Close, keep the draft", ids: [], show: () => ["Esc"] },
    ],
  },
  {
    title: "More",
    column: 2,
    rows: [
      { label: "Search mail", ids: ["email.search"] },
      { label: "Mail keys", ids: ["email.legend"] },
    ],
  },
];

/** Keys that open surfaces rather than act on mail: not ⌘K actions. */
const NOT_ACTIONS = new Set<MailKeyId>(["email.legend", "email.search", "email.clear-selection"]);

const PRETTY: Record<string, string> = {
  "Shift+3": "#",
  "Shift+/": "?",
  Escape: "Esc",
  Enter: "↵",
  Backspace: "⌫",
  ArrowDown: "↓",
  ArrowUp: "↑",
  "Shift+F6": "⇧F6",
};

/** How a key reads in the legend: ⌘A, ⇧J, #, ?; a `g` chord reads "gi". */
export function formatMailKey(chord: HotkeyBinding, isMac = true): string {
  if (isSequenceKey(chord)) return chord.map((step) => formatMailKey(step, isMac)).join("");
  if (PRETTY[chord]) return PRETTY[chord];
  return (
    chord
      .split("+")
      .map((part) => {
        if (part === "Mod") return isMac ? "⌘" : "Ctrl+";
        if (part === "Shift") return "⇧";
        if (part === "Alt") return isMac ? "⌥" : "Alt+";
        return part.length === 1 ? part.toLowerCase() : part;
      })
      .join("")
      // A letter after a modifier reads upper-case: ⇧E, ⌘Z, ⌥⇧N.
      .replace(
        /^((?:⌘|Ctrl\+|⌥|Alt\+|⇧)+)([a-z])$/,
        (_, mods: string, c: string) => mods + c.toUpperCase(),
      )
  );
}

/** Every mail binding in the registry, in registry order. */
export function mailKeys(isMac = true): MailKeyEntry[] {
  return (Object.entries(HOTKEYS) as [HotkeyId, HotkeyDef][])
    .filter(([, def]) => def.scope === "email")
    .map(([id, def]) => ({
      id: id as MailKeyId,
      label: def.label,
      keys: keysFor(def, isMac).map((k) => formatMailKey(k, isMac)),
    }));
}

export type MailLegendRow = { ids: MailKeyId[]; label: string; keys: string[]; or?: boolean };

export type MailLegendGroup = { title: string; column: 0 | 1 | 2; rows: MailLegendRow[] };

/** The `?` sheet: every mail key exactly once, in rows grouped into three columns. */
export function mailLegend(isMac = true): MailLegendGroup[] {
  const byId = new Map(mailKeys(isMac).map((e) => [e.id, e]));
  const keysOf = (row: LegendRowDef) =>
    row.show?.(isMac) ??
    row.ids.flatMap((id) => {
      const keys = byId.get(id)?.keys ?? [];
      return row.all ? keys : keys.slice(0, 1);
    });
  return LEGEND.map((g) => ({
    title: g.title,
    column: g.column,
    rows: g.rows.map((row) => ({
      ids: row.ids,
      label: row.label,
      keys: keysOf(row),
      ...(row.or ? { or: true } : {}),
    })),
  }));
}

export type MailPaletteAction = { id: MailKeyId; label: string; shortcut: string };

/** ⌘K's mail actions: the registry's acting keys, with their shortcut. */
export function mailPaletteActions(isMac = true): MailPaletteAction[] {
  return mailKeys(isMac)
    .filter((e) => !NOT_ACTIONS.has(e.id))
    .map((e) => ({ id: e.id, label: e.label, shortcut: e.keys[0] ?? "" }));
}

/** The key to teach after a click (shortcut hints, X21). */
export function mailKeyHint(id: MailKeyId, isMac = true): string | null {
  const def = HOTKEYS[id] as HotkeyDef | undefined;
  if (!def) return null;
  const key = keysFor(def, isMac)[0];
  return key ? formatMailKey(key, isMac) : null;
}
