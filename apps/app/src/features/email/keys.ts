// Mail's keyboard map, generated from the hotkey registry (AC42): the `?`
// legend and ⌘K's mail actions both read this, so neither can drift from the
// keys the shell actually binds.

import { type HotkeyDef, type HotkeyId, HOTKEYS, keysFor } from "@/lib/hotkeys/registry";

export type MailKeyId = Extract<HotkeyId, `email.${string}`>;

export type MailKeyEntry = { id: MailKeyId; label: string; keys: string[] };

/** Groups for the legend, in reading order. Ids not listed fall into "More". */
const GROUPS: { title: string; ids: MailKeyId[] }[] = [
  {
    title: "Move around",
    ids: ["email.next", "email.prev", "email.open", "email.tab-prev", "email.tab-next"],
  },
  {
    title: "Triage",
    ids: [
      "email.archive",
      "email.snooze",
      "email.pin",
      "email.delete",
      "email.unread",
      "email.move",
      "email.undo",
    ],
  },
  {
    title: "Select",
    ids: [
      "email.select",
      "email.extend-down",
      "email.extend-up",
      "email.select-all",
      "email.clear-selection",
    ],
  },
  { title: "Write", ids: ["email.reply", "email.reply-all", "email.forward", "email.compose"] },
  { title: "Connect", ids: ["email.convert", "email.link", "email.note"] },
];

/** Keys that open surfaces rather than act on mail: not ⌘K actions. */
const NOT_ACTIONS = new Set<MailKeyId>(["email.legend", "email.search", "email.clear-selection"]);

const PRETTY: Record<string, string> = {
  "Shift+3": "#",
  "Shift+/": "?",
  Escape: "Esc",
  Enter: "Enter",
};

/** How a chord reads in the legend: ⌘A, ⇧J, #, ?. */
export function formatMailKey(chord: string, isMac = true): string {
  if (PRETTY[chord]) return PRETTY[chord];
  return chord
    .split("+")
    .map((part) => {
      if (part === "Mod") return isMac ? "⌘" : "Ctrl+";
      if (part === "Shift") return "⇧";
      if (part === "Alt") return isMac ? "⌥" : "Alt+";
      return part.length === 1 ? part.toLowerCase() : part;
    })
    .join("")
    .replace(/^⇧([a-z])$/, (_, c: string) => `⇧${c.toUpperCase()}`);
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

export type MailLegendGroup = { title: string; entries: MailKeyEntry[] };

/** The `?` legend: every mail key exactly once, grouped. */
export function mailLegend(isMac = true): MailLegendGroup[] {
  const all = mailKeys(isMac);
  const byId = new Map(all.map((e) => [e.id, e]));
  const used = new Set<MailKeyId>();
  const groups: MailLegendGroup[] = [];
  for (const g of GROUPS) {
    const entries = g.ids.flatMap((id) => {
      const e = byId.get(id);
      if (!e) return [];
      used.add(id);
      return [e];
    });
    if (entries.length > 0) groups.push({ title: g.title, entries });
  }
  const rest = all.filter((e) => !used.has(e.id));
  if (rest.length > 0) groups.push({ title: "More", entries: rest });
  return groups;
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
