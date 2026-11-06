// The Mail shell's keys (specs/mail-v3.md §7, AC21): every email binding in
// the registry gets its handler here, so no key the `?` sheet lists is dead.

import type { Dispatch, SetStateAction } from "react";

import { type AppHotkeyHandlers, useAppHotkeys } from "@/lib/hotkeys/use-app-hotkeys";
import type { MailOpInput, MailView } from "@/lib/runtime.types.mail-engine";

import type { MailKeyId } from "../keys";
import { openMailSearch } from "../search/open";
import { extendPick, type MailSelection, moveCursor, togglePick } from "../shell/selection";
import type { MailPanelView } from "../store/mail-store";

/** Where each `g` chord goes (spec §7). */
export const MAIL_GO_VIEWS = {
  "email.go-inbox": { kind: "unified", role: "inbox" },
  "email.go-followups": { kind: "followups" },
  "email.go-snoozed": { kind: "snoozed" },
  "email.go-archive": { kind: "unified", role: "archive" },
  "email.go-sent": { kind: "unified", role: "sent" },
  "email.go-drafts": { kind: "unified", role: "drafts" },
} as const satisfies Partial<Record<MailKeyId, MailView>>;

const PANEL_KEYS = {
  "email.panel-today": "today",
  "email.panel-contact": "contact",
  "email.panel-task": "task",
} as const satisfies Partial<Record<MailKeyId, MailPanelView>>;

/** Keys handed to the page as intents (pickers, compose, the spine). */
const INTENT_KEYS = [
  "email.snooze",
  "email.move",
  "email.convert",
  "email.link",
  "email.note",
  "email.reply",
  "email.reply-all",
  "email.forward",
  "email.compose",
  "email.remind",
  // The reader's keys (MV-8): `o` expands every message, `y`/`b` decide a new sender.
  "email.expand-all",
  "email.allow",
  "email.block",
] as const satisfies readonly MailKeyId[];

export type MailShellKeys = {
  ids: readonly string[];
  sel: MailSelection;
  setSel: Dispatch<SetStateAction<MailSelection>>;
  /** What an action applies to now: the picked set, else the cursor. */
  targets(): string[];
  /** Enter on a folded newsletter sender expands it (spec §3); false otherwise. */
  expandAt(cursor: string | null): false | undefined;
  /** Moves keyboard focus into the reader; false when there is no reader. */
  focusReader(): boolean;
  /** A key's op: acts, then the hint line says what it did. */
  actKey(kind: MailOpInput["kind"], threadIds: string[]): void;
  toggle(on: MailOpInput["kind"], off: MailOpInput["kind"], flag: "unread" | "pinned"): void;
  undo(): void;
  /** `[` / `]`; false outside the tabbed Inbox. */
  cycleTab(delta: 1 | -1): false | undefined;
  openLegend(): void;
  /** Hands a key to the page; false when it has nothing to act on. */
  intent(id: MailKeyId, threadIds: string[]): false | undefined;
  goTo(view: MailView): void;
  /** ⌘A: every thread in the tab (AC20). */
  selectAll(): void;
  setPanel(view: MailPanelView): void;
};

function intentHandlers(k: MailShellKeys): AppHotkeyHandlers {
  const out: AppHotkeyHandlers = {};
  for (const id of INTENT_KEYS) out[id] = () => k.intent(id, k.targets());
  return out;
}

function goHandlers(k: MailShellKeys): AppHotkeyHandlers {
  const out: AppHotkeyHandlers = {};
  for (const [id, view] of Object.entries(MAIL_GO_VIEWS) as [MailKeyId, MailView][])
    out[id] = () => k.goTo(view);
  for (const [id, panel] of Object.entries(PANEL_KEYS) as [MailKeyId, MailPanelView][])
    out[id] = () => k.setPanel(panel);
  return out;
}

/** Controls Enter activates on its own: a focused button or link keeps its Enter. */
const ACTIVATES_ON_ENTER =
  'button, a[href], summary, [role="button"], [role="menuitem"], [role="tab"], [role="link"], [role="checkbox"], [role="switch"]';

/** Enter: expand a folded sender, else open the thread (the first one when none is). */
function openHandler(k: MailShellKeys) {
  return (event: KeyboardEvent) => {
    if (event.target instanceof Element && event.target.closest(ACTIVATES_ON_ENTER)) return false;
    if (k.expandAt(k.sel.cursor) !== false) return;
    if (!k.sel.cursor) {
      if (k.ids.length === 0) return false;
      k.setSel((s) => moveCursor(k.ids, s, 1));
      return;
    }
    if (!k.focusReader()) return false;
  };
}

export function mailShellHandlers(k: MailShellKeys): AppHotkeyHandlers {
  return {
    ...intentHandlers(k),
    ...goHandlers(k),
    "email.open": openHandler(k),
    "email.next": () => k.setSel((s) => moveCursor(k.ids, s, 1)),
    "email.prev": () => k.setSel((s) => moveCursor(k.ids, s, -1)),
    "email.extend-down": () => k.setSel((s) => extendPick(k.ids, s, 1)),
    "email.extend-up": () => k.setSel((s) => extendPick(k.ids, s, -1)),
    "email.select": () => k.setSel((s) => togglePick(s)),
    "email.select-all": () => k.selectAll(),
    "email.clear-selection": () => {
      if (k.sel.picked.length === 0) return false;
      k.setSel((s) => ({ ...s, picked: [] }));
    },
    "email.archive": () => k.actKey("done", k.targets()),
    "email.undone": () => k.actKey("undone", k.targets()),
    "email.delete": () => k.actKey("delete", k.targets()),
    "email.pin": () => k.toggle("pin", "unpin", "pinned"),
    "email.unread": () => k.toggle("mark_unread", "mark_read", "unread"),
    "email.undo": () => k.undo(),
    "email.tab-prev": () => k.cycleTab(-1),
    "email.tab-next": () => k.cycleTab(1),
    "email.legend": () => k.openLegend(),
    // `/` opens ⌘K on the Email chip: Mail has no search bar (MR-13, AC32).
    "email.search": () => openMailSearch(),
  };
}

export function useMailShellKeys(k: MailShellKeys) {
  useAppHotkeys(mailShellHandlers(k));
}
