// DB-5 — the shared dashboard data context (spec assumption 6). Mounts each
// module read ONCE for the whole page and shares it, so five Tasks widgets =
// one `tasks.list`, not five. Sources are presence-gated: a read only fires if
// a widget that needs it is somewhere in the layout (no Email fetch on a
// dashboard with no Email widget). Every source refetches on `moduo:data-refresh`
// and on tab re-focus, and degrades to its empty value on any error (a widget
// must never wall). Reads are direct-runtime (the CT-7/CAL-7/EM-11 widget
// pattern) rather than the heavy module hooks, so Home never triggers e.g. an
// IMAP sync just by being open.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { getRuntime } from "@/lib/runtime";
import type { EmailModuleBundle, HabitRow, ModuoRuntime } from "@/lib/runtime.types";
import type { CalendarModuleBundle } from "@/features/calendar/events";
import type { TasksModuleBundle } from "@/features/tasks/model";
import type { NeedsAttentionItem } from "@/features/contacts/needs-attention";
import type { ReconnectItem } from "@/features/contacts/reconnect";
import type { RecentNoteRow } from "@/features/notes/recent";
import type { NotificationItem } from "@/features/spine/notifications";
import type { RecentLinkItem } from "@/features/spine/recent";

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

/** Loosely-typed time-tracking bundle (the runtime surface is `any`; desktop-only). */
export interface TimetrackingBundle {
  entries: Array<Record<string, unknown>>;
  categories: unknown[];
  rules: unknown[];
  projects: unknown[];
}

export interface DashboardData {
  workspaceId: string | null;
  tasks: WidgetSource<TasksModuleBundle>;
  calendar: WidgetSource<CalendarModuleBundle>;
  email: WidgetSource<EmailModuleBundle>;
  recentNotes: WidgetSource<RecentNoteRow[]>;
  recentLinks: WidgetSource<RecentLinkItem[]>;
  notifications: WidgetSource<NotificationItem[]>;
  needsAttention: WidgetSource<NeedsAttentionItem[]>;
  reconnect: WidgetSource<ReconnectItem[]>;
  timetracking: WidgetSource<TimetrackingBundle>;
  habits: WidgetSource<HabitRow[]>;
}

const EMPTY_TASKS: TasksModuleBundle = {
  buckets: [],
  tasks: [],
  tags: [],
  tagLinks: [],
  taskRelations: [],
};
const EMPTY_CALENDAR: CalendarModuleBundle = { events: [], accounts: [], degraded: false };
const EMPTY_EMAIL: EmailModuleBundle = { accounts: [], refs: [], degraded: false };
const EMPTY_TIMETRACKING: TimetrackingBundle = {
  entries: [],
  categories: [],
  rules: [],
  projects: [],
};

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
  }, [enabled, workspaceId]);

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

  return useMemo(
    () => ({ data, loading, error, reload: load }),
    [data, loading, error, load],
  );
}

const DEFAULT_DATA: DashboardData = {
  workspaceId: null,
  tasks: idleSource(EMPTY_TASKS),
  calendar: idleSource(EMPTY_CALENDAR),
  email: idleSource(EMPTY_EMAIL),
  recentNotes: idleSource<RecentNoteRow[]>([]),
  recentLinks: idleSource<RecentLinkItem[]>([]),
  notifications: idleSource<NotificationItem[]>([]),
  needsAttention: idleSource<NeedsAttentionItem[]>([]),
  reconnect: idleSource<ReconnectItem[]>([]),
  timetracking: idleSource(EMPTY_TIMETRACKING),
  habits: idleSource<HabitRow[]>([]),
};

const DashboardDataContext = createContext<DashboardData>(DEFAULT_DATA);

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

  // Calendar-today composes tasks + events, so the tasks read is enabled by
  // either the Tasks widget or the Calendar widget (shared — one fetch).
  const tasks = useSource(has("tasks") || has("calendar"), workspaceId, EMPTY_TASKS, (rt, ws) =>
    rt.tasks.list(ws),
  );
  const calendar = useSource(has("calendar"), workspaceId, EMPTY_CALENDAR, (rt, ws) =>
    rt.calendar.listModule(ws),
  );
  const email = useSource(has("email"), workspaceId, EMPTY_EMAIL, (rt, ws) =>
    rt.email.listModule(ws),
  );
  const recentNotes = useSource<RecentNoteRow[]>(
    has("notes"),
    workspaceId,
    [],
    (rt, ws) => rt.notesV2.recent({ workspaceId: ws, limit: 12 }),
  );
  const recentLinks = useSource<RecentLinkItem[]>(
    has("recently-linked"),
    workspaceId,
    [],
    (rt, ws) => rt.spine.recentLinks({ workspaceId: ws, limit: 20 }),
  );
  const notifications = useSource<NotificationItem[]>(
    has("activity"),
    workspaceId,
    [],
    (rt, ws) => rt.spine.listNotifications({ workspaceId: ws, limit: 40 }),
  );
  const needsAttention = useSource<NeedsAttentionItem[]>(
    has("needs-attention"),
    workspaceId,
    [],
    (rt, ws) => rt.contacts.needsAttention({ workspaceId: ws }),
  );
  const reconnect = useSource<ReconnectItem[]>(
    has("reconnect"),
    workspaceId,
    [],
    (rt, ws) => rt.contacts.reconnect({ workspaceId: ws }),
  );
  const habits = useSource<HabitRow[]>(has("habits"), workspaceId, [], (rt, ws) =>
    rt.habits.list(ws),
  );
  const timetracking = useSource<TimetrackingBundle>(
    has("timetracking") && (getRuntime()?.capabilities.hasTimeTracking ?? false),
    workspaceId,
    EMPTY_TIMETRACKING,
    async (rt, ws) => {
      const raw = (await rt.timetracking.list(ws)) as Partial<TimetrackingBundle> | null;
      return {
        entries: Array.isArray(raw?.entries) ? (raw.entries as TimetrackingBundle["entries"]) : [],
        categories: Array.isArray(raw?.categories) ? raw.categories : [],
        rules: Array.isArray(raw?.rules) ? raw.rules : [],
        projects: Array.isArray(raw?.projects) ? raw.projects : [],
      };
    },
  );

  const value = useMemo<DashboardData>(
    () => ({
      workspaceId,
      tasks,
      calendar,
      email,
      recentNotes,
      recentLinks,
      notifications,
      needsAttention,
      reconnect,
      timetracking,
      habits,
    }),
    [
      workspaceId,
      tasks,
      calendar,
      email,
      recentNotes,
      recentLinks,
      notifications,
      needsAttention,
      reconnect,
      timetracking,
      habits,
    ],
  );

  return <DashboardDataContext.Provider value={value}>{children}</DashboardDataContext.Provider>;
}

/** Widget bodies read their slice here. Returns idle-empty outside a provider (stories). */
export function useDashboardData(): DashboardData {
  return useContext(DashboardDataContext);
}

// ── Story / test helpers ────────────────────────────────────────────────────
// The raw context + a loaded-source wrapper let a story inject sample data
// without the fetching provider (Storybook render is blocked in worktrees, so
// this is the human-capture path for DB-8's visual baselines).

export { DashboardDataContext };

/** Wrap sample data as a settled (non-loading) source. */
export function loadedSource<T>(data: T): WidgetSource<T> {
  return { data, loading: false, error: false, reload: () => Promise.resolve() };
}

/** A fully-formed data context from partial sample sources (rest idle-empty). */
export function makeMockDashboardData(overrides: Partial<DashboardData> = {}): DashboardData {
  return { ...DEFAULT_DATA, workspaceId: "ws-mock", ...overrides };
}
