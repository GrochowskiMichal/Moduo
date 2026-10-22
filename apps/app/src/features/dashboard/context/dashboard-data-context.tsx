// DB-5 — the shared dashboard data context (spec assumption 6). Mounts each
// module read ONCE for the whole page and shares it. Tasks and the queue come
// from the workspace's shared store (TV-D11a), the one live copy every surface
// reads, so Home reads no tasks of its own. Sources are presence-gated: a read only fires if
// a widget that needs it is somewhere in the layout (no Email fetch on a
// dashboard with no Email widget). Every source refetches on `moduo:data-refresh`
// and on tab re-focus, and degrades to its empty value on any error (a widget
// must never wall). Reads are direct-runtime (the CT-7/CAL-7/EM-11 widget
// pattern) rather than the heavy module hooks, so Home never triggers e.g. an
// IMAP sync just by being open.
//
// TV-H1: the Team and Upcoming widgets read the same store (queue rows, Waiting
// on entries, teams), and the time widget reads your tracked task time through
// TV-D14's report, read again whenever a tracked total in the store moves.

import {
  type Context,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { CalendarModuleBundle } from "@/features/calendar/events";
import type { NeedsAttentionItem } from "@/features/contacts/needs-attention";
import type { ReconnectItem } from "@/features/contacts/reconnect";
import type { RecentNoteRow } from "@/features/notes/recent";
import type { NotificationItem } from "@/features/spine/notifications";
import type { RecentLinkItem } from "@/features/spine/recent";
import type {
  TaskQueueEntry,
  TasksModuleBundle,
  TaskWaitingEntry,
  TimeReportRow,
} from "@/features/tasks/model";
import { reportRange } from "@/features/tasks/time-report";
import { useToday } from "@/features/tasks/use-today";
import { WorkspaceContext } from "@/features/workspaces/workspace-context";
import { getRuntime } from "@/lib/runtime";
import type { EmailModuleBundle, HabitRow, ModuoRuntime } from "@/lib/runtime.types";
import { useStoreSnapshot, useWorkspaceStore } from "@/lib/sync/react";
import { useTimeRegion } from "@/lib/time-region";
import { useAuth } from "@/providers/auth-provider";

import type { DashboardLayout, WidgetType } from "../engine/types";

/** Any module mutation can dispatch this to refresh every live widget. */
export const DASHBOARD_DATA_REFRESH_EVENT = "moduo:data-refresh";

export function requestDashboardDataRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DASHBOARD_DATA_REFRESH_EVENT));
}

export interface WidgetSource<T> {
  data: T;
  loading: boolean;
  error: boolean;
  /** Refetch now; resolves once the fresh data has been applied (awaitable). */
  reload: () => Promise<void>;
}

export interface DashboardData {
  workspaceId: string | null;
  tasks: WidgetSource<TasksModuleBundle>;
  /** Queue rows I can see (TV-D2): mine, plus others' on tasks I can see. */
  taskQueue: WidgetSource<TaskQueueEntry[]>;
  /** Task id → its finished files (AT-3's 📎 counts, from the shared store). */
  taskFiles?: ReadonlyMap<string, number>;
  /** Waiting on… entries on tasks I can see (TV-D10), for the Team widget. */
  taskWaiting: WidgetSource<TaskWaitingEntry[]>;
  /** This week's time report rows (TV-D14): the time widget keeps your own. */
  timeReport: WidgetSource<TimeReportRow[]>;
  calendar: WidgetSource<CalendarModuleBundle>;
  email: WidgetSource<EmailModuleBundle>;
  recentNotes: WidgetSource<RecentNoteRow[]>;
  recentLinks: WidgetSource<RecentLinkItem[]>;
  notifications: WidgetSource<NotificationItem[]>;
  needsAttention: WidgetSource<NeedsAttentionItem[]>;
  reconnect: WidgetSource<ReconnectItem[]>;
  habits: WidgetSource<HabitRow[]>;
}

const EMPTY_TASKS: TasksModuleBundle = {
  buckets: [],
  tasks: [],
  tags: [],
  tagLinks: [],
  taskRelations: [],
  truncated: [],
};
const NO_QUEUE: TaskQueueEntry[] = [];
const NO_FILES: ReadonlyMap<string, number> = new Map<string, number>();
const NO_WAITING: TaskWaitingEntry[] = [];
const EMPTY_CALENDAR: CalendarModuleBundle = {
  events: [],
  accounts: [],
  degraded: false,
  truncated: [],
};
const EMPTY_EMAIL: EmailModuleBundle = { accounts: [], refs: [], degraded: false, truncated: [] };

function idleSource<T>(data: T): WidgetSource<T> {
  return { data, loading: false, error: false, reload: () => Promise.resolve() };
}

/**
 * One presence-gated, race-safe read. When `enabled` is false it stays idle
 * (never fetches). Refetches on mount, on `moduo:data-refresh`, and on tab
 * re-focus; the seq guard drops out-of-order responses; errors degrade to `empty`.
 */
function useSource<T>(
  enabled: boolean,
  workspaceId: string | null,
  empty: T,
  fetcher: (runtime: ModuoRuntime, workspaceId: string) => Promise<T>,
  /** Read again whenever this changes (a stamp of what the read depends on). */
  refreshKey: string | number = 0,
): WidgetSource<T> {
  const [data, setData] = useState<T>(empty);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const seq = useRef(0);
  const fetcherRef = useRef(fetcher);
  const emptyRef = useRef(empty);
  useEffect(() => {
    fetcherRef.current = fetcher;
    emptyRef.current = empty;
  });

  const load = useCallback((): Promise<void> => {
    // A retired source clears itself; the seq bump cancels any in-flight read.
    if (!enabled || !workspaceId) {
      seq.current += 1;
      setData(emptyRef.current);
      setLoading(false);
      setError(false);
      return Promise.resolve();
    }
    const runtime = getRuntime();
    if (!runtime) {
      setLoading(false);
      return Promise.resolve();
    }
    const mine = ++seq.current;
    setLoading(true);
    setError(false);
    return fetcherRef
      .current(runtime, workspaceId)
      .then((result) => {
        if (mine !== seq.current) return;
        setData(result);
        setError(false);
      })
      .catch(() => {
        if (mine !== seq.current) return;
        setData(emptyRef.current);
        setError(true);
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
    // `empty` arrives via emptyRef — array sources pass a fresh `[]` per render,
    // so listing it as a dep would loop the fetch; the ref reads the latest.
    // `refreshKey` is listed only so a new stamp reads again.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey re-runs the read on purpose
  }, [enabled, workspaceId, refreshKey]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onRefresh = () => load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener(DASHBOARD_DATA_REFRESH_EVENT, onRefresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(DASHBOARD_DATA_REFRESH_EVENT, onRefresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, load]);

  return useMemo(() => ({ data, loading, error, reload: load }), [data, loading, error, load]);
}

const DEFAULT_DATA: DashboardData = {
  workspaceId: null,
  tasks: idleSource(EMPTY_TASKS),
  taskQueue: idleSource<TaskQueueEntry[]>([]),
  taskWaiting: idleSource<TaskWaitingEntry[]>([]),
  timeReport: idleSource<TimeReportRow[]>([]),
  calendar: idleSource(EMPTY_CALENDAR),
  email: idleSource(EMPTY_EMAIL),
  recentNotes: idleSource<RecentNoteRow[]>([]),
  recentLinks: idleSource<RecentLinkItem[]>([]),
  notifications: idleSource<NotificationItem[]>([]),
  needsAttention: idleSource<NeedsAttentionItem[]>([]),
  reconnect: idleSource<ReconnectItem[]>([]),
  habits: idleSource<HabitRow[]>([]),
};

// One context per source (TS-3b): a widget reads only the sources it shows,
// so a task change re-renders the task widgets and never Email's or Notes'.
// The provider holds the shared store's snapshot; each source keeps its
// identity until its own slice moves, so its context alone changes.
type SourceKey = keyof DashboardData;

const SOURCE_KEYS = Object.keys(DEFAULT_DATA).concat("taskFiles") as SourceKey[];

const sourceContexts = Object.fromEntries(
  SOURCE_KEYS.map((key) => [key, createContext<unknown>(DEFAULT_DATA[key])]),
) as { [K in SourceKey]: Context<DashboardData[K]> };

/** The set of widget types placed anywhere in the layout (across all pages). */
function presentTypes(layout: DashboardLayout): Set<WidgetType> {
  const set = new Set<WidgetType>();
  for (const page of layout.pages) {
    for (const widget of page.widgets) set.add(widget.type);
  }
  return set;
}

export function DashboardDataProvider({
  layout,
  workspaceId,
  children,
}: {
  layout: DashboardLayout;
  workspaceId: string | null;
  children: ReactNode;
}) {
  const present = useMemo(() => presentTypes(layout), [layout]);
  const has = (type: WidgetType) => present.has(type);

  // Tasks and my queue come from the workspace's shared store (TV-D11a): the
  // copy the app shell keeps live, so Home reads nothing of its own for them
  // and a change anywhere shows here at once. Calendar-today composes tasks +
  // events, Team and Upcoming read tasks, queues and teams, and the time widget
  // watches the tracked totals, so any of them holds the store.
  const { userId } = useAuth();
  const tasksAccess = useContext(WorkspaceContext)?.modulePermissions.tasks ?? "none";
  const tasksVisible = tasksAccess !== "none";
  const store = useWorkspaceStore(
    getRuntime(),
    userId,
    workspaceId,
    (has("tasks") || has("calendar") || has("team") || has("upcoming") || has("timetracking")) &&
      tasksVisible,
  );
  const snap = useStoreSnapshot(store);
  const reloadStore = useCallback(async () => {
    await store?.reload();
  }, [store]);
  const storeLoading = !!store && !snap.loaded;
  const storeError = !!store && !!snap.error;
  const tasks = useMemo<WidgetSource<TasksModuleBundle>>(
    () => ({
      data: store ? snap.bundle : EMPTY_TASKS,
      loading: storeLoading,
      error: storeError,
      reload: reloadStore,
    }),
    [store, snap.bundle, storeLoading, storeError, reloadStore],
  );
  // The Tasks widget shows my Focus line-up (TV-D4); the Team widget counts
  // everyone's (only on tasks I can see: the queue's read policy asks the task's).
  const wantsQueue = has("tasks") || has("team");
  const taskQueue = useMemo<WidgetSource<TaskQueueEntry[]>>(
    () => ({
      data: store && wantsQueue ? snap.queue : NO_QUEUE,
      loading: storeLoading,
      error: storeError,
      reload: reloadStore,
    }),
    [store, wantsQueue, snap.queue, storeLoading, storeError, reloadStore],
  );
  const wantsWaiting = has("team");
  const taskWaiting = useMemo<WidgetSource<TaskWaitingEntry[]>>(
    () => ({
      data: store && wantsWaiting ? snap.waiting : NO_WAITING,
      loading: storeLoading,
      error: storeError,
      reload: reloadStore,
    }),
    [store, wantsWaiting, snap.waiting, storeLoading, storeError, reloadStore],
  );
  // The time widget: this week (Time & region's week and zone), read again
  // when a tracked total in the store moves (a Focus save, Add time…, a
  // teammate's save on a shared task) or Time & region changes.
  const wantsTime = has("timetracking") && tasksVisible;
  const region = useTimeRegion();
  // A new day (a new week) reads again even when nothing was tracked: the
  // saved zone's day, the one the report dates entries in (MOD-110).
  const today = useToday(region.timeZone);
  const trackedStamp = useMemo(() => {
    if (!wantsTime || !store) return 0;
    let sum = 0;
    for (const t of snap.bundle.tasks) sum += t.timeSpentSeconds || 0;
    return sum;
  }, [wantsTime, store, snap.bundle.tasks]);
  const timeReport = useSource<TimeReportRow[]>(
    wantsTime,
    workspaceId,
    [],
    async (rt, ws) => {
      const range = reportRange(
        "this_week",
        new Date(),
        region.weekStartsOn,
        null,
        region.timeZone,
      );
      const res = await rt.tasks.timeReport({
        workspaceId: ws,
        from: range.from,
        to: range.to,
        zone: region.timeZone,
      });
      return res.rows;
    },
    `${trackedStamp}:${today}:${region.weekStartsOn}:${region.timeZone}`,
  );
  const calendar = useSource(has("calendar"), workspaceId, EMPTY_CALENDAR, (rt, ws) =>
    rt.calendar.listModule(ws),
  );
  const email = useSource(has("email"), workspaceId, EMPTY_EMAIL, (rt, ws) =>
    rt.email.listModule(ws),
  );
  const recentNotes = useSource<RecentNoteRow[]>(has("notes"), workspaceId, [], (rt, ws) =>
    rt.notesV2.recent({ workspaceId: ws, limit: 12 }),
  );
  const recentLinks = useSource<RecentLinkItem[]>(
    has("recently-linked"),
    workspaceId,
    [],
    (rt, ws) => rt.spine.recentLinks({ workspaceId: ws, limit: 20 }),
  );
  const notifications = useSource<NotificationItem[]>(has("activity"), workspaceId, [], (rt, ws) =>
    rt.spine.listNotifications({ workspaceId: ws, limit: 40 }),
  );
  const needsAttention = useSource<NeedsAttentionItem[]>(
    has("needs-attention"),
    workspaceId,
    [],
    (rt, ws) => rt.contacts.needsAttention({ workspaceId: ws }),
  );
  const reconnect = useSource<ReconnectItem[]>(has("reconnect"), workspaceId, [], (rt, ws) =>
    rt.contacts.reconnect({ workspaceId: ws }),
  );
  const habits = useSource<HabitRow[]>(has("habits"), workspaceId, [], (rt, ws) =>
    rt.habits.list(ws),
  );
  // A task's finished files (AT-3's 📎 mark on the widget's rows), live.
  const taskFiles = store ? snap.attachmentCounts : NO_FILES;

  const value = useMemo<DashboardData>(
    () => ({
      workspaceId,
      tasks,
      taskQueue,
      taskFiles,
      taskWaiting,
      timeReport,
      calendar,
      email,
      recentNotes,
      recentLinks,
      notifications,
      needsAttention,
      reconnect,
      habits,
    }),
    [
      workspaceId,
      tasks,
      taskQueue,
      taskFiles,
      taskWaiting,
      timeReport,
      calendar,
      email,
      recentNotes,
      recentLinks,
      notifications,
      needsAttention,
      reconnect,
      habits,
    ],
  );

  return <DashboardSources value={value}>{children}</DashboardSources>;
}

/** Each source into its own context (the provider's, or a story's sample data). */
export function DashboardSources({
  value,
  children,
}: {
  value: DashboardData;
  children: ReactNode;
}) {
  let tree = children;
  for (const key of SOURCE_KEYS) {
    const Source = sourceContexts[key] as Context<unknown>;
    tree = <Source.Provider value={value[key]}>{tree}</Source.Provider>;
  }
  return <>{tree}</>;
}

/**
 * One source, re-rendering only when it changes (TS-3b). Idle-empty outside a
 * provider (stories without sample data).
 */
export function useDashboardSource<K extends SourceKey>(key: K): DashboardData[K] {
  return useContext(sourceContexts[key]);
}

// ── Story / test helpers ────────────────────────────────────────────────────
// `DashboardSources` + a loaded-source wrapper let a story inject sample data
// without the fetching provider (Storybook render is blocked in worktrees, so
// this is the human-capture path for DB-8's visual baselines).

/** Wrap sample data as a settled (non-loading) source. */
export function loadedSource<T>(data: T): WidgetSource<T> {
  return { data, loading: false, error: false, reload: () => Promise.resolve() };
}

/** A fully-formed data context from partial sample sources (rest idle-empty). */
export function makeMockDashboardData(overrides: Partial<DashboardData> = {}): DashboardData {
  return { ...DEFAULT_DATA, workspaceId: "ws-mock", ...overrides };
}
