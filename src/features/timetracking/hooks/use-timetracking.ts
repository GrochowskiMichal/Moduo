import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModuoRuntime } from "../../../lib/runtime";
import type {
  TimeEntry,
  TimeCategory,
  CategoryRule,
  TimeProject,
  FocusSession,
  DailySummary,
  DEFAULT_CATEGORIES,
} from "../types";

function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeEntry(raw: any): TimeEntry {
  return {
    id: raw.id,
    workspaceId: raw.workspaceId ?? raw.workspace_id,
    ownerId: raw.ownerId ?? raw.owner_id,
    startTime: raw.startTime ?? raw.start_time,
    endTime: raw.endTime ?? raw.end_time,
    duration: raw.duration ?? raw.durationSecs ?? raw.duration_secs ?? 0,
    appName: raw.appName ?? raw.app_name ?? null,
    windowTitle: raw.windowTitle ?? raw.window_title ?? null,
    url: raw.url ?? null,
    categoryId: raw.categoryId ?? raw.category_id ?? null,
    projectId: raw.projectId ?? raw.project_id ?? null,
    isManual: !!(raw.isManual ?? raw.is_manual),
    isMeeting: !!(raw.isMeeting ?? raw.is_meeting),
    description: raw.description ?? "",
    createdAt: raw.createdAt ?? raw.created_at ?? nowIso(),
    updatedAt: raw.updatedAt ?? raw.updated_at ?? nowIso(),
    deletedAt: raw.deletedAt ?? raw.deleted_at ?? null,
  };
}

function normalizeCategory(raw: any): TimeCategory {
  return {
    id: raw.id,
    workspaceId: raw.workspaceId ?? raw.workspace_id,
    ownerId: raw.ownerId ?? raw.owner_id,
    name: raw.name ?? "",
    color: raw.color ?? "#888",
    icon: raw.icon ?? "⏱️",
    productivityScore: raw.productivityScore ?? raw.productivity_score ?? 0,
    position: raw.position ?? "z99",
    createdAt: raw.createdAt ?? raw.created_at ?? nowIso(),
    updatedAt: raw.updatedAt ?? raw.updated_at ?? nowIso(),
    deletedAt: raw.deletedAt ?? raw.deleted_at ?? null,
  };
}

function normalizeRule(raw: any): CategoryRule {
  return {
    id: raw.id,
    workspaceId: raw.workspaceId ?? raw.workspace_id,
    ownerId: raw.ownerId ?? raw.owner_id,
    categoryId: raw.categoryId ?? raw.category_id,
    matchType: raw.matchType ?? raw.match_type ?? "app",
    matchValue: raw.matchValue ?? raw.match_value ?? "",
    isAiGenerated: !!(raw.isAiGenerated ?? raw.is_ai_generated),
    confidence: raw.confidence ?? 1,
    createdAt: raw.createdAt ?? raw.created_at ?? nowIso(),
    updatedAt: raw.updatedAt ?? raw.updated_at ?? nowIso(),
    deletedAt: raw.deletedAt ?? raw.deleted_at ?? null,
  };
}

function normalizeProject(raw: any): TimeProject {
  return {
    id: raw.id,
    workspaceId: raw.workspaceId ?? raw.workspace_id,
    ownerId: raw.ownerId ?? raw.owner_id,
    name: raw.name ?? "",
    color: raw.color ?? "#888",
    clientName: raw.clientName ?? raw.client_name ?? "",
    budgetHours: raw.budgetHours ?? raw.budget_hours ?? null,
    linkedTaskProjectId: raw.linkedTaskProjectId ?? raw.linked_task_project_id ?? null,
    createdAt: raw.createdAt ?? raw.created_at ?? nowIso(),
    updatedAt: raw.updatedAt ?? raw.updated_at ?? nowIso(),
    deletedAt: raw.deletedAt ?? raw.deleted_at ?? null,
  };
}

function normalizeFocusSession(raw: any): FocusSession {
  return {
    id: raw.id,
    workspaceId: raw.workspaceId ?? raw.workspace_id,
    ownerId: raw.ownerId ?? raw.owner_id,
    startTime: raw.startTime ?? raw.start_time,
    endTime: raw.endTime ?? raw.end_time ?? null,
    targetMinutes: raw.targetMinutes ?? raw.target_minutes ?? 25,
    categoryId: raw.categoryId ?? raw.category_id ?? null,
    label: raw.label ?? "",
    isActive: !!(raw.isActive ?? raw.is_active),
    createdAt: raw.createdAt ?? raw.created_at ?? nowIso(),
    updatedAt: raw.updatedAt ?? raw.updated_at ?? nowIso(),
    deletedAt: raw.deletedAt ?? raw.deleted_at ?? null,
  };
}

export type UseTimetrackingState = {
  entries: TimeEntry[];
  categories: TimeCategory[];
  rules: CategoryRule[];
  projects: TimeProject[];
  focusSessions: FocusSession[];
  isTracking: boolean;
  loading: boolean;
  // CRUD
  createEntry: (entry: Partial<TimeEntry>) => Promise<string | null>;
  updateEntry: (id: string, patch: Partial<TimeEntry>) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  createCategory: (category: Partial<TimeCategory>) => Promise<string | null>;
  updateCategory: (id: string, patch: Partial<TimeCategory>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  createRule: (rule: Partial<CategoryRule>) => Promise<string | null>;
  deleteRule: (id: string) => Promise<void>;
  createProject: (project: Partial<TimeProject>) => Promise<string | null>;
  updateProject: (id: string, patch: Partial<TimeProject>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  startFocusSession: (targetMinutes: number, label?: string) => Promise<string | null>;
  stopFocusSession: (id: string) => Promise<void>;
  // Tracking
  startTracking: () => Promise<void>;
  stopTracking: () => Promise<void>;
  refreshData: () => Promise<void>;
  // Computed
  dailySummaries: DailySummary[];
  todayEntries: TimeEntry[];
  todayTotalSeconds: number;
  todayProductiveSeconds: number;
  todayFocusScore: number;
};

type UseTimetrackingParams = {
  userId: string | null;
  workspaceId: string | null;
};

export function useTimetracking(
  runtime: ModuoRuntime | null,
  params: UseTimetrackingParams
): UseTimetrackingState {
  const { userId, workspaceId } = params;

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [categories, setCategories] = useState<TimeCategory[]>([]);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [projects, setProjects] = useState<TimeProject[]>([]);
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>([]);
  const [isTracking, setIsTracking] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadBundle = useCallback(async () => {
    if (!runtime || !workspaceId) return;
    const bundle = await runtime.timetracking.list(workspaceId);
    setEntries((bundle.entries ?? []).map(normalizeEntry));
    setCategories((bundle.categories ?? []).map(normalizeCategory));
    setRules((bundle.rules ?? []).map(normalizeRule));
    setProjects((bundle.projects ?? []).map(normalizeProject));
    setFocusSessions((bundle.focusSessions ?? bundle.focus_sessions ?? []).map(normalizeFocusSession));

    const status = await runtime.timetracking.getTrackingStatus();
    setIsTracking(status.isTracking);
  }, [runtime, workspaceId]);

  useEffect(() => {
    if (!runtime || !workspaceId) {
      setLoading(false);
      return;
    }
    let active = true;
    const run = async () => {
      setLoading(true);
      try {
        await loadBundle();
      } finally {
        if (active) setLoading(false);
      }
    };
    void run();
    return () => { active = false; };
  }, [loadBundle, runtime, workspaceId]);

  // Auto-refresh every 10 seconds while tracking
  useEffect(() => {
    if (!isTracking || !runtime || !workspaceId) return;
    const interval = setInterval(() => { void loadBundle(); }, 10_000);
    return () => clearInterval(interval);
  }, [isTracking, loadBundle, runtime, workspaceId]);

  const createEntry = useCallback(async (partial: Partial<TimeEntry>) => {
    if (!runtime || !userId || !workspaceId) return null;
    const now = nowIso();
    const entry: any = {
      id: safeId(),
      workspaceId,
      ownerId: userId,
      startTime: partial.startTime ?? now,
      endTime: partial.endTime ?? now,
      durationSecs: partial.duration ?? 0,
      appName: partial.appName ?? null,
      windowTitle: partial.windowTitle ?? null,
      url: partial.url ?? null,
      categoryId: partial.categoryId ?? null,
      projectId: partial.projectId ?? null,
      isManual: partial.isManual ?? true,
      isMeeting: partial.isMeeting ?? false,
      description: partial.description ?? "",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await runtime.timetracking.upsertEntry(entry);
    await loadBundle();
    return entry.id;
  }, [runtime, userId, workspaceId, loadBundle]);

  const updateEntry = useCallback(async (id: string, patch: Partial<TimeEntry>) => {
    if (!runtime) return;
    const existing = entries.find(e => e.id === id);
    if (!existing) return;
    const updated: any = {
      ...existing,
      ...patch,
      durationSecs: patch.duration ?? existing.duration,
      updatedAt: nowIso(),
    };
    await runtime.timetracking.upsertEntry(updated);
    await loadBundle();
  }, [runtime, entries, loadBundle]);

  const deleteEntry = useCallback(async (id: string) => {
    if (!runtime) return;
    await runtime.timetracking.deleteEntry(id);
    await loadBundle();
  }, [runtime, loadBundle]);

  const createCategory = useCallback(async (partial: Partial<TimeCategory>) => {
    if (!runtime || !userId || !workspaceId) return null;
    const now = nowIso();
    const category: any = {
      id: safeId(),
      workspaceId,
      ownerId: userId,
      name: partial.name ?? "New Category",
      color: partial.color ?? "#888",
      icon: partial.icon ?? "⏱️",
      productivityScore: partial.productivityScore ?? 0,
      position: partial.position ?? `z${String(categories.length + 1).padStart(2, "0")}`,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await runtime.timetracking.upsertCategory(category);
    await loadBundle();
    return category.id;
  }, [runtime, userId, workspaceId, categories.length, loadBundle]);

  const updateCategory = useCallback(async (id: string, patch: Partial<TimeCategory>) => {
    if (!runtime) return;
    const existing = categories.find(c => c.id === id);
    if (!existing) return;
    const updated: any = { ...existing, ...patch, updatedAt: nowIso() };
    await runtime.timetracking.upsertCategory(updated);
    await loadBundle();
  }, [runtime, categories, loadBundle]);

  const deleteCategory = useCallback(async (id: string) => {
    if (!runtime) return;
    await runtime.timetracking.deleteCategory(id);
    await loadBundle();
  }, [runtime, loadBundle]);

  const createRule = useCallback(async (partial: Partial<CategoryRule>) => {
    if (!runtime || !userId || !workspaceId) return null;
    const now = nowIso();
    const rule: any = {
      id: safeId(),
      workspaceId,
      ownerId: userId,
      categoryId: partial.categoryId ?? "",
      matchType: partial.matchType ?? "app",
      matchValue: partial.matchValue ?? "",
      isAiGenerated: partial.isAiGenerated ?? false,
      confidence: partial.confidence ?? 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await runtime.timetracking.upsertRule(rule);
    await loadBundle();
    return rule.id;
  }, [runtime, userId, workspaceId, loadBundle]);

  const deleteRule = useCallback(async (id: string) => {
    if (!runtime) return;
    await runtime.timetracking.deleteRule(id);
    await loadBundle();
  }, [runtime, loadBundle]);

  const createProject = useCallback(async (partial: Partial<TimeProject>) => {
    if (!runtime || !userId || !workspaceId) return null;
    const now = nowIso();
    const project: any = {
      id: safeId(),
      workspaceId,
      ownerId: userId,
      name: partial.name ?? "New Project",
      color: partial.color ?? "#60A5FA",
      clientName: partial.clientName ?? "",
      budgetHours: partial.budgetHours ?? null,
      linkedTaskProjectId: partial.linkedTaskProjectId ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await runtime.timetracking.upsertProject(project);
    await loadBundle();
    return project.id;
  }, [runtime, userId, workspaceId, loadBundle]);

  const updateProject = useCallback(async (id: string, patch: Partial<TimeProject>) => {
    if (!runtime) return;
    const existing = projects.find(p => p.id === id);
    if (!existing) return;
    const updated: any = { ...existing, ...patch, updatedAt: nowIso() };
    await runtime.timetracking.upsertProject(updated);
    await loadBundle();
  }, [runtime, projects, loadBundle]);

  const deleteProject = useCallback(async (id: string) => {
    if (!runtime) return;
    await runtime.timetracking.deleteProject(id);
    await loadBundle();
  }, [runtime, loadBundle]);

  const startFocusSession = useCallback(async (targetMinutes: number, label = "Focus") => {
    if (!runtime || !userId || !workspaceId) return null;
    const now = nowIso();
    const session: any = {
      id: safeId(),
      workspaceId,
      ownerId: userId,
      startTime: now,
      endTime: null,
      targetMinutes,
      categoryId: null,
      label,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await runtime.timetracking.upsertFocusSession(session);
    await loadBundle();
    return session.id;
  }, [runtime, userId, workspaceId, loadBundle]);

  const stopFocusSession = useCallback(async (id: string) => {
    if (!runtime) return;
    const existing = focusSessions.find(s => s.id === id);
    if (!existing) return;
    const updated: any = {
      ...existing,
      endTime: nowIso(),
      isActive: false,
      updatedAt: nowIso(),
    };
    await runtime.timetracking.upsertFocusSession(updated);
    await loadBundle();
  }, [runtime, focusSessions, loadBundle]);

  const startTracking = useCallback(async () => {
    if (!runtime || !workspaceId) return;
    await runtime.timetracking.startTracking(workspaceId);
    setIsTracking(true);
  }, [runtime, workspaceId]);

  const stopTracking = useCallback(async () => {
    if (!runtime) return;
    await runtime.timetracking.stopTracking();
    setIsTracking(false);
    await loadBundle();
  }, [runtime, loadBundle]);

  // ─── Computed Values ──────────────────────────────────────────────────────
  const activeEntries = useMemo(() => entries.filter(e => !e.deletedAt), [entries]);
  const activeCategories = useMemo(() => categories.filter(c => !c.deletedAt), [categories]);
  const categoryById = useMemo(() => new Map(activeCategories.map(c => [c.id, c])), [activeCategories]);

  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const todayEntries = useMemo(() =>
    activeEntries.filter(e => e.startTime.startsWith(todayStr))
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [activeEntries, todayStr]
  );

  const todayTotalSeconds = useMemo(() =>
    todayEntries.reduce((sum, e) => sum + (e.duration || 0), 0),
    [todayEntries]
  );

  const todayProductiveSeconds = useMemo(() =>
    todayEntries.reduce((sum, e) => {
      const cat = e.categoryId ? categoryById.get(e.categoryId) : null;
      if (cat && cat.productivityScore > 0) return sum + (e.duration || 0);
      return sum;
    }, 0),
    [todayEntries, categoryById]
  );

  const todayFocusScore = useMemo(() => {
    if (todayTotalSeconds === 0) return 0;
    return Math.round((todayProductiveSeconds / todayTotalSeconds) * 100);
  }, [todayTotalSeconds, todayProductiveSeconds]);

  const dailySummaries = useMemo(() => {
    const byDay = new Map<string, TimeEntry[]>();
    for (const entry of activeEntries) {
      const day = entry.startTime.slice(0, 10);
      const list = byDay.get(day) ?? [];
      list.push(entry);
      byDay.set(day, list);
    }
    const summaries: DailySummary[] = [];
    for (const [date, dayEntries] of byDay) {
      const total = dayEntries.reduce((s, e) => s + (e.duration || 0), 0);
      let productive = 0;
      let distracting = 0;
      let neutral = 0;
      const catSeconds = new Map<string, number>();
      for (const e of dayEntries) {
        const cat = e.categoryId ? categoryById.get(e.categoryId) : null;
        const dur = e.duration || 0;
        if (cat) {
          if (cat.productivityScore > 0) productive += dur;
          else if (cat.productivityScore < 0) distracting += dur;
          else neutral += dur;
          catSeconds.set(cat.id, (catSeconds.get(cat.id) ?? 0) + dur);
        } else {
          neutral += dur;
        }
      }
      const focusDayStr = date;
      const dayFocusSessions = focusSessions.filter(s =>
        !s.deletedAt && s.startTime.startsWith(focusDayStr)
      );
      summaries.push({
        date,
        totalTrackedSeconds: total,
        productiveSeconds: productive,
        distractingSeconds: distracting,
        neutralSeconds: neutral,
        focusScore: total > 0 ? Math.round((productive / total) * 100) : 0,
        topCategories: [...catSeconds.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([categoryId, seconds]) => ({ categoryId, seconds })),
        focusSessionCount: dayFocusSessions.length,
      });
    }
    return summaries.sort((a, b) => b.date.localeCompare(a.date));
  }, [activeEntries, categoryById, focusSessions]);

  return {
    entries: activeEntries,
    categories: activeCategories,
    rules: rules.filter(r => !r.deletedAt),
    projects: projects.filter(p => !p.deletedAt),
    focusSessions: focusSessions.filter(s => !s.deletedAt),
    isTracking,
    loading,
    createEntry,
    updateEntry,
    deleteEntry,
    createCategory,
    updateCategory,
    deleteCategory,
    createRule,
    deleteRule,
    createProject,
    updateProject,
    deleteProject,
    startFocusSession,
    stopFocusSession,
    startTracking,
    stopTracking,
    refreshData: loadBundle,
    dailySummaries,
    todayEntries,
    todayTotalSeconds,
    todayProductiveSeconds,
    todayFocusScore,
  };
}
