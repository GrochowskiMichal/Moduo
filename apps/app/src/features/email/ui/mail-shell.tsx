// The rebuilt Mail shell (MR-9): rail, split tabs, the virtualized list and a
// reader slot, all on the mail store (decision 11). Keys come from the
// registry (AC42); every removal auto-advances (AC14); multi-select acts as
// one undoable action (AC13); failures sit in the failed-actions bar (AC12).

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LABEL_COLORS, type LabelColor } from "@/components/tag-colors";
import { Kbd } from "@/components/ui/kbd";
import { getRuntime } from "@/lib/runtime";
import {
  type AppHotkeyHandlers,
  isMacPlatform,
  useAppHotkeys,
} from "@/lib/hotkeys/use-app-hotkeys";
import type {
  MailMailbox,
  MailOpInput,
  MailTab,
  MailThreadRow,
  MailView,
} from "@/lib/runtime.types.mail-engine";

import { createBulkCommands, type ZeroAge } from "../commands/bulk";
import { createMailCommands } from "../commands/triage";
import { useSavedSearches } from "../hooks/use-saved-searches";
import { mailKeyHint, type MailKeyId } from "../keys";
import { openMailSearch } from "../search/open";
import {
  advanceAfterRemoval,
  EMPTY_SELECTION,
  extendPick,
  type MailSelection,
  moveCursor,
  pickAll,
  targets,
  togglePick,
} from "../shell/selection";
import { useThreadWindow } from "../shell/use-thread-window";
import { type MailStore, mailStore } from "../store/mail-store";
import { useMailStore } from "../store/use-mail-store";
import { FailedActionsBar } from "./failed-actions-bar";
import { FollowupNudges } from "./followup-nudge";
import { MailLegendDialog } from "./mail-legend-dialog";
import { MailRail, UNIFIED_FOLDERS } from "./mail-rail";
import type { MailDensity, MailRowActions } from "./mail-row";
import { mailListState, MailListStateView, MailStatusLine } from "./mail-states";
import { cycleTab, MailTabs, mailTabs } from "./mail-tabs";
import { decideNewSender, NewSendersPanel } from "./new-senders-panel";
import { MailThreadList } from "./thread-list";

/** Ops that take a thread out of the current list (auto-advance after them). */
const REMOVES = new Set<MailOpInput["kind"]>(["done", "delete", "snooze", "spam", "move"]);

const selEngine = (s: { engine: unknown }) => s.engine;

/** What the page drives from outside the shell: pickers that finish an action
 * (snooze, move) go through `act` so they auto-advance like Done (AC14). */
export type MailShellApi = {
  act(kind: MailOpInput["kind"], threadIds: string[], args?: MailOpInput["args"]): Promise<void>;
  /** The loaded row for a thread, when it is in the current window. */
  row(threadId: string): MailThreadRow | null;
  /** Selects and opens a thread. */
  open(threadId: string): void;
};

export type MailShellProps = {
  store?: MailStore;
  now?: () => number;
  offline?: boolean;
  density?: MailDensity;
  previewLines?: 1 | 2;
  /** Shortcut hints after a click (X21, on by default). */
  showHints?: boolean;
  screenerOn?: boolean;
  customTabs?: readonly { id: string; label: string }[];
  renderReader?: (threadId: string | null) => ReactNode;
  onConnect?: () => void;
  onReconnect?: (accountId: string) => void;
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
  /** Called when a rail folder is picked (the page leaves Subscriptions). */
  onViewChange?: (view: MailView) => void;
  /** The open thread changed (the page's Today panel acts on it). */
  onCursorChange?: (threadId: string | null) => void;
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
  offline = false,
  density = "comfortable",
  previewLines = 2,
  showHints = true,
  screenerOn = false,
  customTabs = [],
  renderReader,
  onConnect,
  onReconnect,
  onIntent,
  initialView = { kind: "unified", role: "inbox" },
  initialThreadId = null,
  apiRef,
  onOpenSubscriptions,
  subscriptionsActive = false,
  onViewChange,
  onCursorChange,
}: MailShellProps) {
  const engine = useMailStore(selEngine, store) as ReturnType<MailStore["getState"]>["engine"];
  const counts = useMailStore((s) => s.counts, store);
  const accounts = useMailStore((s) => s.accounts, store);
  const failedOps = useMailStore((s) => s.failedOps, store);
  const followupsDue = useMailStore((s) => s.followupsDue, store);
  const version = useMailStore((s) => s.threadsVersion, store);

  const commands = useMemo(() => createMailCommands(store, now), [store, now]);
  const bulk = useMemo(() => createBulkCommands(store, now, commands), [store, now, commands]);

  const [view, setView] = useState<MailView>(initialView);
  const savedSearches = useSavedSearches();
  const tabs = useMemo(() => mailTabs(customTabs), [customTabs]);
  const [tab, setTab] = useState<MailTab>({ kind: "personal" });
  const tabbed = view.kind === "unified" && view.role === "inbox";
  const win = useThreadWindow(engine, view, tabbed ? tab : null, version);
  const ids = useMemo(() => win.rows.map((r) => r.threadId), [win.rows]);

  const [sel, setSel] = useState<MailSelection>(() =>
    initialThreadId ? { ...EMPTY_SELECTION, cursor: initialThreadId } : EMPTY_SELECTION,
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const [legend, setLegend] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [cleared, setCleared] = useState(0);
  const mailboxes = useAccountMailboxes(engine, accounts, version);

  // Latest list and selection for stable callbacks.
  const live = useRef({ ids, sel });
  useEffect(() => {
    live.current = { ids, sel };
  });

  const hues = useMemo(() => {
    const out: Record<string, LabelColor> = {};
    accounts.forEach((a, i) => (out[a.id] = LABEL_COLORS[i % LABEL_COLORS.length]!));
    return out;
  }, [accounts]);

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 1500);
    return () => clearTimeout(t);
  }, [hint]);

  const act = useCallback(
    async (kind: MailOpInput["kind"], threadIds: string[], args?: MailOpInput["args"]) => {
      if (threadIds.length === 0) return;
      if (REMOVES.has(kind)) {
        const { ids: list, sel: s } = live.current;
        setSel(
          advanceAfterRemoval(list, { ...s, cursor: s.cursor ?? threadIds[0] ?? null }, threadIds),
        );
        if (kind === "done" || kind === "delete") setCleared((n) => n + threadIds.length);
      } else {
        setSel((s) => ({ ...s, picked: [] }));
      }
      await bulk.apply(kind, threadIds, args);
    },
    [bulk],
  );

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      act,
      row: (id) => win.rows.find((r) => r.threadId === id) ?? null,
      open: (id) => setSel({ ...EMPTY_SELECTION, cursor: id }),
    };
  });

  useEffect(() => {
    onCursorChange?.(sel.cursor);
  }, [sel.cursor, onCursorChange]);

  const teach = useCallback(
    (id: MailKeyId) => {
      if (!showHints) return;
      const k = mailKeyHint(id, isMacPlatform());
      if (k) setHint(k);
    },
    [showHints],
  );

  const rowActions: MailRowActions = useMemo(
    () => ({
      open: (id) => setSel((s) => ({ ...s, cursor: id, picked: [] })),
      togglePick: (id) => setSel((s) => togglePick(s, id)),
      hover: setHovered,
      done: (id) => {
        teach("email.archive");
        void act("done", [id]);
      },
      snooze: (id) => {
        teach("email.snooze");
        onIntent?.("email.snooze", [id]);
      },
      more: (id) => onIntent?.("email.move", [id]),
    }),
    [act, teach, onIntent],
  );

  const cur = () => targets(live.current.sel);
  const toggleKind = (
    on: MailOpInput["kind"],
    off: MailOpInput["kind"],
    flag: "unread" | "pinned",
  ) => {
    const t = cur();
    const first = win.rows.find((r) => r.threadId === t[0]);
    void act(first?.[flag] ? off : on, t);
  };
  const intent = (id: MailKeyId) => () => {
    const t = cur();
    if (t.length === 0 && id !== "email.compose") return false;
    onIntent?.(id, t);
  };

  const handlers: AppHotkeyHandlers = {
    "email.next": () => setSel((s) => moveCursor(ids, s, 1)),
    "email.prev": () => setSel((s) => moveCursor(ids, s, -1)),
    "email.extend-down": () => setSel((s) => extendPick(ids, s, 1)),
    "email.extend-up": () => setSel((s) => extendPick(ids, s, -1)),
    "email.select": () => setSel((s) => togglePick(s)),
    "email.select-all": () => setSel((s) => pickAll(ids, s)),
    "email.clear-selection": () => {
      if (sel.picked.length === 0) return false;
      setSel((s) => ({ ...s, picked: [] }));
    },
    "email.archive": () => void act("done", cur()),
    "email.delete": () => void act("delete", cur()),
    "email.pin": () => toggleKind("pin", "unpin", "pinned"),
    "email.unread": () => toggleKind("mark_unread", "mark_read", "unread"),
    "email.undo": () => void commands.undo(),
    "email.tab-prev": () => (tabbed ? setTab((t) => cycleTab(tabs, t, -1)) : false),
    "email.tab-next": () => (tabbed ? setTab((t) => cycleTab(tabs, t, 1)) : false),
    "email.legend": () => setLegend(true),
    "email.snooze": intent("email.snooze"),
    "email.move": intent("email.move"),
    "email.convert": intent("email.convert"),
    "email.link": intent("email.link"),
    "email.note": intent("email.note"),
    "email.reply": intent("email.reply"),
    "email.reply-all": intent("email.reply-all"),
    "email.forward": intent("email.forward"),
    "email.compose": intent("email.compose"),
    // `/` opens ⌘K on the Email chip: Mail has no search bar (MR-13, AC32).
    "email.search": () => openMailSearch(),
  };
  useAppHotkeys(handlers);

  const folderName = viewFolderName(view, mailboxes);
  const state = mailListState({
    accounts,
    loading: win.loading,
    rowCount: win.rows.length,
    isInbox: tabbed,
    folderName,
    clearedToday: cleared,
  });

  const zero = (age: ZeroAge) => {
    void bulk.getMeToZero(view, tabbed ? tab : null, age).then((e) => {
      if (e) setCleared((n) => n + e.threadIds.length);
    });
  };

  return (
    <div className="flex h-full min-h-0 w-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-hairline">
        <MailRail
          current={view}
          counts={counts}
          accounts={accounts}
          mailboxes={mailboxes}
          hues={hues}
          outboxCount={0}
          screenerOn={screenerOn}
          onSelect={(v) => {
            setView(v);
            setSel(EMPTY_SELECTION);
            onViewChange?.(v);
            // Opening a folder rounds it now instead of on the next sweep.
            if (v.kind === "mailbox") void engine?.openFolder?.(v.mailboxId).catch(() => {});
          }}
          onOpenSubscriptions={onOpenSubscriptions}
          subscriptionsActive={subscriptionsActive}
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
        className="flex min-h-0 w-96 shrink-0 flex-col border-r border-hairline"
      >
        {tabbed && accounts.length > 0 ? (
          <MailTabs
            view={view}
            tabs={tabs}
            current={tab}
            counts={counts}
            onSelect={setTab}
            onZero={zero}
          />
        ) : null}
        <div className="pt-2">
          <MailStatusLine offline={offline} accounts={accounts} onReconnect={onReconnect} />
          <FailedActionsBar
            failed={failedOps}
            onRetry={(opIds) => void Promise.all(opIds.map((id) => commands.retry(id)))}
            onDiscard={(opIds) => void Promise.all(opIds.map((id) => commands.discard(id)))}
          />
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
          {tabbed ? (
            <FollowupNudges
              rows={followupsDue}
              selfAddresses={accounts.map((a) => a.address)}
              nowMs={now()}
              onOpen={(id) => setSel({ ...EMPTY_SELECTION, cursor: id })}
              onDismiss={(id) => void commands.dismissFollowup(id).catch(() => {})}
            />
          ) : null}
        </div>
        {sel.picked.length > 0 ? (
          <div role="status" className="mx-2 mb-1 px-1 text-xs text-muted-foreground">
            {sel.picked.length} selected
          </div>
        ) : null}
        {state.kind === "rows" ? (
          <MailThreadList
            rows={win.rows}
            cursor={sel.cursor}
            picked={sel.picked}
            hovered={hovered ?? sel.cursor}
            hues={hues}
            showHue={view.kind === "unified" && accounts.length > 1}
            density={density}
            previewLines={previewLines}
            nowMs={now()}
            actions={rowActions}
            onNearEnd={win.loadMore}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <MailListStateView state={state} onConnect={() => onConnect?.()} />
          </div>
        )}
        {hint ? (
          <div
            role="status"
            className="m-2 flex items-center gap-2 self-center text-xs text-muted-foreground"
          >
            Next time press <Kbd>{hint}</Kbd>
          </div>
        ) : null}
      </section>
      <section aria-label="Reader" className="flex min-h-0 min-w-0 flex-1 flex-col">
        {renderReader?.(sel.cursor) ?? null}
      </section>
      <MailLegendDialog open={legend} onOpenChange={setLegend} />
    </div>
  );
}
