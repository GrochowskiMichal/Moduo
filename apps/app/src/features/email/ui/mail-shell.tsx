// The rebuilt Mail shell (MR-9): rail, split tabs, the virtualized list and a
// reader slot, all on the mail store (decision 11). Keys come from the
// registry (AC42); every removal auto-advances (AC14); multi-select acts as
// one undoable action (AC13); failures sit in the failed-actions bar (AC12).

import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { LABEL_COLORS, type LabelColor } from "@/components/tag-colors";
import { isMacPlatform, useChordPending } from "@/lib/hotkeys/use-app-hotkeys";
import { getRuntime } from "@/lib/runtime";
import { mailViewKey } from "@/lib/runtime.types";
import type {
  MailMailbox,
  MailOpInput,
  MailTab,
  MailThreadRow,
  MailView,
} from "@/lib/runtime.types.mail-engine";
import { undoToast } from "@/lib/undo-toast";

import { dispatchOpenSettings } from "../../settings/settings-events";
import { createBulkCommands, type ZeroAge } from "../commands/bulk";
import { createMailCommands } from "../commands/triage";
import { useSavedSearches } from "../hooks/use-saved-searches";
import { mailKeyHint, type MailKeyId } from "../keys";
import { showMailPanel, toggleMailPanel } from "../panels/side-panel";
import { openMailSearch } from "../search/open";
import {
  advanceAfterRemoval,
  allThreadIds,
  EMPTY_SELECTION,
  type MailSelection,
  pickAll,
  targets,
  togglePick,
} from "../shell/selection";
import type { LinkedKindsRead } from "../shell/use-linked-kinds";
import { useListGroups } from "../shell/use-list-groups";
import { useThreadWindow } from "../shell/use-thread-window";
import { type MailStore, mailStore, type MailUndoEntry } from "../store/mail-store";
import { useMailStore } from "../store/use-mail-store";
import { MailHintLine, restHint, triageToastLabel } from "./hint-line";
import { type MailBulkAction, MailBulkReader } from "./mail-bulk-reader";
import { MailLegendDialog } from "./mail-legend-dialog";
import { MailRail, UNIFIED_FOLDERS } from "./mail-rail";
import type { MailDensity, MailRowActions } from "./mail-row";
import { rowPlace } from "./mail-row-model";
import {
  type MailConnectProvider,
  MailFirstSync,
  mailListState,
  MailListStateView,
  type MailTabUnread,
} from "./mail-states";
import { cycleTab, liveTab, type MailTabDef, MailTabs, mailTabs, sameTab } from "./mail-tabs";
import { decideNewSender, NewSendersPanel } from "./new-senders-panel";
import { useRailViewCounts } from "./rail-counts";
import { humaniseError } from "./system-copy";
import { MailSystemLines } from "./system-lines";
import { MailThreadList } from "./thread-list";
import { useFailedAccounts } from "./use-failed-accounts";
import { useMailShellKeys } from "./use-mail-shell-keys";

/** Ops that take a thread out of the current list (auto-advance after them). */
const REMOVES = new Set<MailOpInput["kind"]>([
  "done",
  "undone",
  "delete",
  "snooze",
  "spam",
  "move",
]);

const selEngine = (s: { engine: unknown }) => s.engine;
const selOutbox = (s: ReturnType<MailStore["getState"]>) => s.counts?.outbox ?? 0;
const selPending = (s: ReturnType<MailStore["getState"]>) => s.counts?.pendingOps ?? 0;

const INBOX: MailView = { kind: "unified", role: "inbox" };

const openMailSettings = () => dispatchOpenSettings({ section: "mail" });

/** The scoped account's inbox, where its tab counts are keyed (`mailbox:<id>|<tab>`). */
function scopedInboxView(
  mailboxes: Record<string, MailMailbox[]>,
  accountId: string | null,
): MailView | undefined {
  const box = accountId ? mailboxes[accountId]?.find((b) => b.role === "inbox") : undefined;
  return box ? { kind: "mailbox", mailboxId: box.id } : undefined;
}

/** The other tabs with unread mail, offered from a clear tab (spec §4). */
function otherTabsWithUnread(
  tabs: readonly MailTabDef[],
  current: MailTab,
  counts: ReturnType<MailStore["getState"]>["counts"],
  countView: MailView,
): MailTabUnread[] {
  return tabs
    .filter((t) => !sameTab(t.tab, current))
    .map((t) => ({ ...t, unread: counts?.byViewKey[mailViewKey(countView, t.tab)] ?? 0 }))
    .filter((t) => t.unread > 0);
}

/** The list pane's body: a place the page renders (the Outbox), the rows, or the list state. */
function MailListBody({
  place,
  view,
  state,
  onConnect,
  onTab,
  onBackToInbox,
  children,
}: {
  place?: (view: MailView) => ReactNode | null;
  view: MailView;
  state: ReturnType<typeof mailListState>;
  onConnect: (provider?: MailConnectProvider) => void;
  onTab: (tab: MailTab) => void;
  onBackToInbox: () => void;
  children: ReactNode;
}) {
  const own = place?.(view);
  if (own != null) return own;
  if (state.kind === "rows") return children;
  if (state.kind === "first_sync") return <MailFirstSync />;
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <MailListStateView
        state={state}
        onConnect={onConnect}
        onTab={onTab}
        onBackToInbox={onBackToInbox}
      />
    </div>
  );
}

/** Bulk reader buttons, each the same as its key (spec §6). */
const BULK_INTENTS: Record<Exclude<MailBulkAction, "done" | "delete">, MailKeyId> = {
  snooze: "email.snooze",
  task: "email.convert",
  move: "email.move",
};

/** Moves keyboard focus into the reader (Enter, spec §7): its title, else the slot. */
function focusIn(root: HTMLElement | null): boolean {
  if (!root) return false;
  const target = root.querySelector<HTMLElement>("[data-reader-title], h1, h2") ?? root;
  if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
  target.focus({ preventScroll: true });
  return true;
}

/** The panes F6 cycles (specs/mail-improve.md §6): rail, list, reader, the side panel. */
const PANES = [
  '[data-mail-pane="rail"]',
  '[data-mail-pane="list"]',
  '[data-mail-pane="reader"]',
  "[data-mail-panel], [data-mail-panel-strip]",
] as const;

/** Where focus lands in a pane: its current item, else its first control, else itself. */
function focusPane(pane: HTMLElement, i: number): void {
  const first = (...sels: string[]) =>
    sels.reduce<HTMLElement | null>(
      (hit, sel) => hit ?? pane.querySelector<HTMLElement>(sel),
      null,
    );
  const pick =
    i === 0
      ? first('[data-rail-body] [tabindex="0"]', '[aria-current="page"]', "button:not([disabled])")
      : i === 1
        ? (pane.querySelector<HTMLElement>('[aria-selected="true"][data-thread-id]') ??
          pane.querySelector<HTMLElement>('[role="listbox"]'))
        : i === 2
          ? null
          : pane.querySelector<HTMLElement>('button:not([disabled]), [tabindex="0"]');
  if (i === 2 && focusIn(pane)) return;
  const target = pick ?? pane;
  if (!target.hasAttribute("tabindex") && !target.matches("button, a[href]")) target.tabIndex = -1;
  target.focus({ preventScroll: true });
}

/** F6 / ⇧F6: the next or previous pane that is on screen. */
function cyclePane(delta: 1 | -1): void {
  const panes = PANES.map((sel) => document.querySelector<HTMLElement>(sel));
  const at = document.activeElement;
  const here = panes.findIndex((p) => p && at && p.contains(at));
  const n = panes.length;
  let i = here < 0 ? (delta === 1 ? -1 : 0) : here;
  for (let step = 0; step < n; step++) {
    i = (i + delta + n) % n;
    const pane = panes[i];
    if (pane) {
      focusPane(pane, i);
      return;
    }
  }
}

/** The reader slot: the bulk summary while two or more threads are picked (spec §6). */
function ReaderSlot({
  bulk,
  reader,
}: {
  bulk: ComponentProps<typeof MailBulkReader> | null;
  reader: () => ReactNode;
}) {
  if (bulk) return <MailBulkReader {...bulk} />;
  return reader() ?? null;
}

/** Mail's triage toasts share one id: the latest action's replaces the last. */
export const MAIL_TRIAGE_TOAST = "mail-triage";

/** `quiet`: no result toast (Send & Done: the undo-send toast speaks for it).
 *  `teach`: the key a pointer action could have used, said in the toast. */
export type MailActOptions = { quiet?: boolean; teach?: string };

/** What the page drives from outside the shell: pickers that finish an action
 * (snooze, move) go through `act` so they auto-advance like Done (AC14). */
export type MailShellApi = {
  /** Applies an op as one undoable action; answers with its undo entry (null if refused). */
  act(
    kind: MailOpInput["kind"],
    threadIds: string[],
    args?: MailOpInput["args"],
    opts?: MailActOptions,
  ): Promise<MailUndoEntry | null>;
  /** Undoes that entry and selects and opens the first thread it restored. */
  undo(entry: MailUndoEntry): Promise<void>;
  /** The loaded row for a thread, when it is in the current window. */
  row(threadId: string): MailThreadRow | null;
  /** Selects and opens a thread. */
  open(threadId: string): void;
};

export type MailShellProps = {
  store?: MailStore;
  now?: () => number;
  density?: MailDensity;
  previewLines?: 1 | 2;
  /** Shortcut hints after a click (X21, on by default). */
  showHints?: boolean;
  screenerOn?: boolean;
  customTabs?: readonly { id: string; label: string }[];
  /** The reader slot; `listEmpty` asks it to stay blank (spec §4). */
  renderReader?: (threadId: string | null, ctx: { listEmpty: boolean }) => ReactNode;
  /** Runs before the undo key undoes triage: true when it undid something (a send). */
  onUndoFirst?: () => boolean;
  /** Actions beside "N selected" (multi-select), e.g. Labels. */
  renderSelectionActions?: (threadIds: string[]) => ReactNode;
  /** Connect an account; the first-run card names the provider it picked. */
  onConnect?: (provider?: MailConnectProvider) => void;
  /** Reconnect: the connect dialog in reconnect mode for that account (AC5). */
  onReconnect?: (accountId: string) => void;
  /** Retry now: Sync now for that account (AC5). */
  onRetryAccount?: (accountId: string) => void;
  /** A place the page renders itself instead of the thread list (the Outbox); null = the list. */
  renderPlace?: (view: MailView) => ReactNode | null;
  /** Above the list for a place (failed sends at the top of Drafts). */
  renderListTop?: (view: MailView) => ReactNode;
  /** Keys handed to sibling surfaces (snooze picker, move, compose, spine). */
  onIntent?: (intent: MailKeyId, threadIds: string[]) => void;
  initialView?: MailView;
  /** Opens with this thread selected (the `?thread=` deep link). */
  initialThreadId?: string | null;
  /** Filled with the shell's imperative API (see `MailShellApi`). */
  apiRef?: { current: MailShellApi | null };
  /** Shows Subscriptions in the rail; the page renders it in the reader slot. */
  onOpenSubscriptions?: () => void;
  subscriptionsActive?: boolean;
  /** Shows Attachments in the rail; the page renders it in the reader slot. */
  onOpenAttachments?: () => void;
  attachmentsActive?: boolean;
  /** The rail's Sync button: Sync now across accounts. */
  onSyncNow?: () => void;
  /** The rail's settings button; defaults to Settings → Mail. */
  onOpenSettings?: () => void;
  /** Called when a rail folder is picked (the page leaves Subscriptions). */
  onViewChange?: (view: MailView) => void;
  /** The open thread changed (the page's Today panel acts on it). */
  onCursorChange?: (threadId: string | null) => void;
  /** The row flags' batched spine read (`MailSpinePort.linkedKindsFor`, decision 7). */
  linkedKindsFor?: LinkedKindsRead;
  /** Threads with a draft whose send failed: their rows say "Not sent". */
  notSentThreadIds?: ReadonlySet<string>;
};

const SMART_VIEW_NAMES: Partial<Record<MailView["kind"], string>> = {
  snoozed: "Snoozed",
  followups: "Follow-ups",
  new_senders: "New senders",
  outbox: "Outbox",
};

/** The folder name the empty state names. */
function viewFolderName(view: MailView, mailboxes: Record<string, MailMailbox[]>): string {
  if (view.kind === "unified") {
    return UNIFIED_FOLDERS.find((f) => f.role === view.role)?.label ?? "this folder";
  }
  if (view.kind === "mailbox") {
    return (
      Object.values(mailboxes)
        .flat()
        .find((b) => b.id === view.mailboxId)?.name ?? "this folder"
    );
  }
  return "this view";
}

/** Outside Inbox, the place's name sits where the tabs would be (spec §3). */
function PlaceHeading({
  view,
  mailboxes,
  hidden,
  accountCount,
}: {
  view: MailView;
  mailboxes: Record<string, MailMailbox[]>;
  hidden: boolean;
  accountCount: number;
}) {
  if (hidden || accountCount === 0) return null;
  return (
    <h2 className="truncate px-4 pt-3 text-sm font-semibold text-foreground">
      {SMART_VIEW_NAMES[view.kind] ?? viewFolderName(view, mailboxes)}
    </h2>
  );
}

/** Each account's mailboxes, refetched when the engine's threads change. */
function useAccountMailboxes(
  engine: ReturnType<MailStore["getState"]>["engine"],
  accounts: readonly { id: string }[],
  version: unknown,
): Record<string, MailMailbox[]> {
  const [mailboxes, setMailboxes] = useState<Record<string, MailMailbox[]>>({});
  useEffect(() => {
    if (!engine) return;
    let gone = false;
    void Promise.all(
      accounts.map(async (a) => [a.id, await engine.listMailboxes(a.id)] as const),
    ).then(
      (pairs) => {
        if (!gone) setMailboxes(Object.fromEntries(pairs));
      },
      () => {},
    );
    return () => {
      gone = true;
    };
  }, [engine, accounts, version]);
  return mailboxes;
}

export function MailShell({
  store = mailStore,
  now = Date.now,
  density = "comfortable",
  previewLines = 2,
  showHints = true,
  screenerOn = false,
  customTabs = [],
  renderReader,
  onUndoFirst,
  renderSelectionActions,
  onConnect,
  onReconnect,
  onRetryAccount,
  renderPlace,
  renderListTop,
  onIntent,
  initialView = { kind: "unified", role: "inbox" },
  initialThreadId = null,
  apiRef,
  onOpenSubscriptions,
  subscriptionsActive = false,
  onOpenAttachments,
  attachmentsActive = false,
  onSyncNow,
  onOpenSettings = openMailSettings,
  onViewChange,
  onCursorChange,
  linkedKindsFor,
  notSentThreadIds,
}: MailShellProps) {
  const engine = useMailStore(selEngine, store) as ReturnType<MailStore["getState"]>["engine"];
  const counts = useMailStore((s) => s.counts, store);
  const accounts = useMailStore((s) => s.accounts, store);
  const failedOps = useMailStore((s) => s.failedOps, store);
  const followupsDue = useMailStore((s) => s.followupsDue, store);
  const awayReturned = useMailStore((s) => s.awayReturned, store);
  const outboxCount = useMailStore(selOutbox, store);
  const pendingOps = useMailStore(selPending, store);
  const version = useMailStore((s) => s.threadsVersion, store);

  const commands = useMemo(() => createMailCommands(store, now), [store, now]);
  const bulk = useMemo(() => createBulkCommands(store, now, commands), [store, now, commands]);

  const [view, setView] = useState<MailView>(initialView);
  const savedSearches = useSavedSearches();
  const tabs = useMemo(() => mailTabs(customTabs), [customTabs]);
  const [picked, setTab] = useState<MailTab>({ kind: "personal" });
  // A custom tab deleted while selected falls back to Personal (spec edge cases).
  const tab = liveTab(tabs, picked);
  const tabbed = view.kind === "unified" && view.role === "inbox";
  const [scope, setScope] = useState<string | null>(null);
  const mailboxes = useAccountMailboxes(engine, accounts, version);
  // A folder belongs to one account already; the scope narrows the unified views.
  const scoped = view.kind === "mailbox" ? null : scope;
  const listTab = tabbed ? tab : null;
  const win = useThreadWindow(engine, view, listTab, version, scoped);
  const scopedInbox = scopedInboxView(mailboxes, scoped);
  const viewCounts = useRailViewCounts(engine, version, {
    screenerOn,
    nowMs: now(),
    dueNow: followupsDue.length,
  });
  const groups = useListGroups({
    store,
    rows: win.rows,
    tab: listTab,
    accounts,
    linkedKindsFor,
    // `act` is declared below; this runs only from a click.
    done: (threadIds) => void act("done", threadIds),
  });
  const { items, ids } = groups;

  const place = rowPlace(view, mailboxes);

  const [sel, setSel] = useState<MailSelection>(() =>
    initialThreadId ? { ...EMPTY_SELECTION, cursor: initialThreadId } : EMPTY_SELECTION,
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const readerRef = useRef<HTMLElement>(null);
  // A ⌘A read in flight; a tab or place change makes it stale (spec edge cases).
  const selectAllSeq = useRef(0);
  const [legend, setLegend] = useState(false);
  const [cleared, setCleared] = useState(0);
  const failedAccount = useFailedAccounts(engine, failedOps, win.rows);

  // An account removed while scoped: the scope clears and the list returns to Inbox.
  useEffect(() => {
    if (scope && !accounts.some((a) => a.id === scope)) {
      selectAllSeq.current++;
      setScope(null);
      setView(INBOX);
      setSel(EMPTY_SELECTION);
    }
  }, [scope, accounts]);

  /** A rail place, a `g` chord or "Back to Inbox": the selection starts over. */
  const selectView = (v: MailView) => {
    selectAllSeq.current++;
    // Inbox unscopes (spec §1).
    if (mailViewKey(v) === mailViewKey(INBOX)) setScope(null);
    setView(v);
    setSel(EMPTY_SELECTION);
    onViewChange?.(v);
    // Opening a folder rounds it now instead of on the next sweep.
    if (v.kind === "mailbox") void engine?.openFolder?.(v.mailboxId).catch(() => {});
  };
  /** The selection keeps only the current tab's threads: switching tabs clears it. */
  const switchTab = (next: MailTab | ((t: MailTab) => MailTab)) => {
    selectAllSeq.current++;
    setTab(next);
    setSel((s) => (s.picked.length > 0 ? { ...s, picked: [] } : s));
  };
  /** ⌘A (AC20): the loaded rows at once, then every id in the tab from the engine. */
  const selectAll = () => {
    setSel((s) => pickAll(ids, s));
    if (!engine) return;
    const my = ++selectAllSeq.current;
    void allThreadIds(engine, { view, tab: listTab, accountId: scoped }).then(
      (all) => {
        if (my === selectAllSeq.current && all.length > 0) setSel((s) => ({ ...s, picked: all }));
      },
      () => {},
    );
  };

  // Latest list, selection and place for stable callbacks.
  const live = useRef({ ids, sel, view, tab: listTab });
  useEffect(() => {
    live.current = { ids, sel, view, tab: listTab };
  });
  // The toast's Undo outlives the render that made it: it calls the latest undo.
  const undoRef = useRef<(entry?: MailUndoEntry) => Promise<void>>(async () => {});
  const boxesRef = useRef(mailboxes);
  useEffect(() => {
    undoRef.current = undoAndOpen;
    boxesRef.current = mailboxes;
  });
  /** Where each undoable action was taken, so Undo can go back there (AC11). */
  const actedFrom = useRef(
    new WeakMap<MailUndoEntry, { view: MailView; tab: MailTab | null; list: readonly string[] }>(),
  );

  const accountNames = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.displayName || a.address])),
    [accounts],
  );
  const hues = useMemo(() => {
    const out: Record<string, LabelColor> = {};
    accounts.forEach((a, i) => (out[a.id] = LABEL_COLORS[i % LABEL_COLORS.length]!));
    return out;
  }, [accounts]);

  const act = useCallback(
    async (
      kind: MailOpInput["kind"],
      threadIds: string[],
      args?: MailOpInput["args"],
      opts: MailActOptions = {},
    ): Promise<MailUndoEntry | null> => {
      if (threadIds.length === 0) return null;
      const before = live.current.sel;
      const from = { view: live.current.view, tab: live.current.tab, list: live.current.ids };
      const clears = REMOVES.has(kind) && (kind === "done" || kind === "delete");
      if (REMOVES.has(kind)) {
        const { ids: list, sel: s } = live.current;
        setSel(
          advanceAfterRemoval(list, { ...s, cursor: s.cursor ?? threadIds[0] ?? null }, threadIds),
        );
        if (clears) setCleared((n) => n + threadIds.length);
      } else {
        setSel((s) => ({ ...s, picked: [] }));
      }
      try {
        const entry = await bulk.apply(kind, threadIds, args);
        if (entry) {
          actedFrom.current.set(entry, from);
          // One toast for every triage action: where the threads went, Undo and its key
          // (specs/mail-improve.md §3, AC10). A click's toast teaches the key.
          if (!opts.quiet) {
            const boxId = (args as { mailboxId?: string } | undefined)?.mailboxId;
            const target = boxId
              ? Object.values(boxesRef.current)
                  .flat()
                  .find((b) => b.id === boxId)?.name
              : null;
            undoToast(triageToastLabel(kind, threadIds.length, args, target), {
              onUndo: () => void undoRef.current(entry),
              undoKey: isMacPlatform() ? "⌘Z" : "Ctrl+Z",
              id: MAIL_TRIAGE_TOAST,
              description: opts.teach ? `Next time press ${opts.teach}` : undefined,
            });
          }
        }
        return entry;
      } catch (error) {
        // The engine refused: nothing moved, so the list and the picks go back.
        setSel(before);
        if (clears) setCleared((n) => Math.max(0, n - threadIds.length));
        const reason = humaniseError(error instanceof Error ? error.message : String(error));
        toast.error(reason ? `That didn't apply: ${reason}.` : "That didn't apply.");
        return null;
      }
    },
    [bulk],
  );

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      act: (kind, threadIds, args, opts) => act(kind, threadIds, args, opts),
      undo: (entry) => undoAndOpen(entry),
      row: (id) => win.rows.find((r) => r.threadId === id) ?? null,
      open: (id) => setSel({ ...EMPTY_SELECTION, cursor: id }),
    };
  });

  /**
   * Undo (`z`, ⌘Z, a toast's Undo): restores the threads, goes back to the place and tab
   * the action was taken in, then selects and opens the first restored thread in list
   * order (specs/mail-improve.md §3, AC11).
   */
  async function undoAndOpen(entry?: MailUndoEntry): Promise<void> {
    const stack = store.getState().undoStack;
    const target = entry ?? stack[stack.length - 1];
    if (!target) return;
    const from = actedFrom.current.get(target);
    const restored = await commands.undo(target);
    if (restored.length === 0) return;
    const order = from?.list ?? [];
    const rank = (id: string) => {
      const i = order.indexOf(id);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    const first = [...restored].sort((a, b) => rank(a) - rank(b))[0]!;
    const now = live.current;
    if (from && mailViewKey(from.view) !== mailViewKey(now.view)) selectView(from.view);
    if (from?.tab && !(now.tab && sameTab(now.tab, from.tab))) switchTab(from.tab);
    setSel({ ...EMPTY_SELECTION, cursor: first });
  }

  useEffect(() => {
    onCursorChange?.(sel.cursor);
  }, [sel.cursor, onCursorChange]);

  // Opening a thread reads it: its unread dot goes at once (specs/mail-improve.md AC8).
  // Not an undoable action: no toast, no undo entry.
  const readOnOpen = useRef<string | null>(null);
  useEffect(() => {
    const id = sel.cursor;
    if (!id || !engine || readOnOpen.current === id) return;
    const row = win.rows.find((r) => r.threadId === id);
    if (!row) return;
    readOnOpen.current = id;
    if (row.unread) void engine.applyOp({ kind: "mark_read", threadIds: [id] }).catch(() => {});
  }, [sel.cursor, engine, win.rows]);

  /** A click's toast names the key that does it (X21 hints, now in the toast). */
  const keyFor = useCallback(
    (id: MailKeyId) => (showHints ? (mailKeyHint(id, isMacPlatform()) ?? undefined) : undefined),
    [showHints],
  );
  /** A key's op. */
  const actKey = (kind: MailOpInput["kind"], threadIds: string[]) => void act(kind, threadIds);

  const rowActions: MailRowActions = useMemo(
    () => ({
      open: (id) => setSel((s) => ({ ...s, cursor: id, picked: [] })),
      togglePick: (id) => setSel((s) => togglePick(s, id)),
      hover: setHovered,
      done: (id) => void act("done", [id], undefined, { teach: keyFor("email.archive") }),
      undone: (id) => void act("undone", [id]),
      snooze: (id) => onIntent?.("email.snooze", [id]),
      more: (id) => onIntent?.("email.move", [id]),
    }),
    [act, keyFor, onIntent],
  );

  const cur = () => targets(live.current.sel);
  const toggleKind = (
    on: MailOpInput["kind"],
    off: MailOpInput["kind"],
    flag: "unread" | "pinned",
  ) => {
    const t = cur();
    const first = win.rows.find((r) => r.threadId === t[0]);
    actKey(first?.[flag] ? off : on, t);
  };
  const intent = (id: MailKeyId, t: string[]) => {
    if (t.length === 0 && id !== "email.compose") return false;
    onIntent?.(id, t);
  };

  useMailShellKeys({
    ids,
    sel,
    setSel,
    targets: cur,
    expandAt: groups.expandAt,
    focusReader: () => focusIn(readerRef.current),
    actKey,
    toggle: toggleKind,
    undo: () => {
      if (onUndoFirst?.()) return;
      void undoAndOpen();
    },
    cycleTab: (delta) => {
      if (!tabbed) return false;
      switchTab((t) => cycleTab(tabs, t, delta));
    },
    openLegend: () => setLegend(true),
    intent,
    goTo: selectView,
    selectAll,
    setPanel: (panel) => showMailPanel(store, panel),
    togglePanel: () => toggleMailPanel(store),
    cyclePane,
    goTab: (kind) => {
      const def =
        kind === "custom"
          ? tabs.find((t) => t.tab.kind === "custom")
          : tabs.find((t) => t.tab.kind === kind);
      if (!def) return false;
      if (!tabbed) selectView(INBOX);
      switchTab(def.tab);
    },
  });
  const chord = useChordPending("email");

  const onBulk = (action: MailBulkAction) => {
    const t = [...sel.picked];
    if (action === "done" || action === "delete") actKey(action, t);
    else intent(BULK_INTENTS[action], t);
  };
  const bulkRows = (() => {
    if (sel.picked.length < 2) return null;
    const pickedSet = new Set(sel.picked);
    return win.rows.filter((r) => pickedSet.has(r.threadId));
  })();

  const folderName = viewFolderName(view, mailboxes);
  const countView = scopedInbox ?? view;
  const state = mailListState({
    accounts,
    loading: win.loading,
    rowCount: win.rows.length,
    view,
    isInbox: tabbed,
    folderName,
    tabLabel: tabs.find((t) => sameTab(t.tab, tab))?.label,
    clearedToday: cleared,
    others: otherTabsWithUnread(tabbed ? tabs : [], tab, counts, countView),
  });
  const goInbox = () => selectView(INBOX);

  const zero = (age: ZeroAge) => {
    void bulk.getMeToZero(view, listTab, age).then((e) => {
      if (e) setCleared((n) => n + e.threadIds.length);
    });
  };

  return (
    <div className="flex h-full min-h-0 w-full">
      <aside data-mail-pane="rail" className="flex w-56 shrink-0 flex-col border-r border-hairline">
        <MailRail
          current={view}
          counts={counts}
          accounts={accounts}
          mailboxes={mailboxes}
          hues={hues}
          outboxCount={outboxCount}
          screenerOn={screenerOn}
          onSelect={selectView}
          onOpenSubscriptions={onOpenSubscriptions}
          subscriptionsActive={subscriptionsActive}
          onOpenAttachments={onOpenAttachments}
          attachmentsActive={attachmentsActive}
          viewCounts={viewCounts}
          onSync={onSyncNow}
          onOpenSettings={onOpenSettings}
          onCompose={() => onIntent?.("email.compose", [])}
          loading={counts === null}
          scope={scope}
          onScope={(id) => {
            selectAllSeq.current++;
            setScope((s) => (s === id ? null : id));
            setSel(EMPTY_SELECTION);
            if (view.kind === "mailbox") setView(INBOX);
          }}
          nowMs={now()}
          onConnect={() => onConnect?.()}
          onCancelBackfill={
            engine?.cancelBackfill
              ? (id) => void commands.cancelBackfill(id).catch(() => {})
              : undefined
          }
          onLoadHistory={
            engine?.backfill ? (id) => void commands.backfill(id).catch(() => {}) : undefined
          }
          savedSearches={savedSearches}
          onOpenSearch={openMailSearch}
        />
      </aside>
      <section
        aria-label="Mail list"
        data-mail-pane="list"
        data-skip-target="mail-list"
        className="flex min-h-0 w-(--mail-list-w) shrink-0 flex-col border-r border-hairline"
      >
        {tabbed && accounts.length > 0 ? (
          <MailTabs
            view={view}
            tabs={tabs}
            current={tab}
            counts={counts}
            countView={scopedInbox}
            onSelect={switchTab}
            onZero={zero}
            onCustomTabs={onOpenSettings}
          />
        ) : null}
        <PlaceHeading
          view={view}
          mailboxes={mailboxes}
          hidden={tabbed}
          accountCount={accounts.length}
        />
        <MailSystemLines
          accounts={accounts}
          outboxCount={outboxCount}
          pendingOps={pendingOps}
          awayCount={awayReturned.length}
          failed={failedOps}
          failedAccount={failedAccount}
          followups={followupsDue}
          nudgeAllowed={tabbed && tab.kind === "personal"}
          selfAddresses={accounts.map((a) => a.address)}
          nowMs={now()}
          onReconnect={onReconnect}
          onRetry={onRetryAccount}
          onDismissAway={() => commands.clearAwayAnnouncement()}
          onRetryOps={(opIds) => void Promise.all(opIds.map((id) => commands.retry(id)))}
          onUndoOps={(opIds) => void Promise.all(opIds.map((id) => commands.discard(id)))}
          onOpenThread={(id) => setSel({ ...EMPTY_SELECTION, cursor: id })}
          onDismissFollowup={(id) => void commands.dismissFollowup(id).catch(() => {})}
        />
        <div className="pt-2">
          {renderListTop?.(view)}
          {view.kind === "new_senders" ? (
            <NewSendersPanel
              rows={win.rows}
              onDecide={(sender, decision) =>
                decideNewSender(sender, decision, {
                  commands,
                  save: async (kind, value) => {
                    const email = getRuntime()?.email;
                    if (!email) throw new Error("Settings aren't available");
                    return email.upsertSetting({ id: crypto.randomUUID(), kind, value });
                  },
                })
              }
            />
          ) : null}
        </div>
        {sel.picked.length > 0 ? (
          <div className="mx-2 mb-1 flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <span role="status">{sel.picked.length} selected</span>
            {renderSelectionActions?.([...sel.picked])}
          </div>
        ) : null}
        <MailListBody
          place={renderPlace}
          view={view}
          state={state}
          onConnect={(p) => onConnect?.(p)}
          onTab={switchTab}
          onBackToInbox={goInbox}
        >
          <MailThreadList
            items={items}
            cursor={sel.cursor}
            picked={sel.picked}
            hovered={hovered ?? sel.cursor}
            hues={hues}
            accountNames={accountNames}
            showHue={accounts.length > 1 && scope === null}
            density={density}
            previewLines={previewLines}
            place={place}
            self={groups.self}
            linkedKinds={groups.linkedKinds}
            notSent={notSentThreadIds}
            offlineAccounts={groups.offlineAccounts}
            nowMs={now()}
            actions={rowActions}
            groupActions={groups.groupActions}
            onNearEnd={win.loadMore}
          />
        </MailListBody>
        <MailHintLine
          enabled={showHints}
          rest={restHint(view, state.kind === "rows")}
          chord={chord}
        />
      </section>
      <section
        ref={readerRef}
        aria-label="Reader"
        data-mail-pane="reader"
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <ReaderSlot
          bulk={bulkRows ? { count: sel.picked.length, rows: bulkRows, onAction: onBulk } : null}
          reader={() => renderReader?.(sel.cursor, { listEmpty: state.kind !== "rows" })}
        />
      </section>
      <MailLegendDialog open={legend} onOpenChange={setLegend} />
    </div>
  );
}
