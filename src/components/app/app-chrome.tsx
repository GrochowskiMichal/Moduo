import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import {
  dispatchDashboardViewChange,
  readStoredDashboardActiveView,
  writeStoredDashboardActiveView,
} from "../../features/dashboard/ui/layout-events";
import {
  DEFAULT_DASHBOARD_VIEW,
  deleteDashboardLayout,
  ensureDashboardLayout,
  listDashboardViews,
  readPersistedDashboardActiveView,
  saveDashboardViews,
  writePersistedDashboardActiveView,
  type DashboardViewOption,
} from "../../features/dashboard/storage/dashboard-view-storage";
import { NotificationCenter } from "../notification-center";
import { WorkspaceSwitcher } from "../workspace-switcher";
import { WorkspaceSettingsModal } from "../workspace-settings-modal";
import { Image, Modal, Pressable, Text, TextInput, View } from "../../tw";
import {
  dispatchLayoutPanelsApply,
  LAYOUT_PANELS_SET_EVENT,
  readPanelsMap,
  routeToFeatureLayout,
  writePanelsMap,
  type FeatureLayoutKey,
  type LayoutPanelsApplyDetail,
} from "../../features/layout/panel-events";
import {
  dispatchTasksSelectProject,
  TASKS_SELECT_PROJECT_EVENT,
  type TasksSelectProjectDetail,
} from "../../features/tasks/ui/layout-events";
import {
  createMindmap,
  deleteMindmap,
  listMindmaps,
  readStoredActiveMindmap,
  writeStoredActiveMindmap,
  type MindmapOption,
} from "../../features/mindmap/ui/mindmap-storage";
import { dispatchMindmapSelectMap } from "../../features/mindmap/ui/layout-events";
import {
  createBrainstorm,
  deleteBrainstorm,
  listBrainstorms,
  readStoredActiveBrainstorm,
  writeStoredActiveBrainstorm,
  type BrainstormOption,
} from "../../features/brainstorm/storage/brainstorm-storage";
import { dispatchBrainstormSelectView } from "../../features/brainstorm/ui/layout-events";
import { Icon, type IconName } from "../ui/icon";
import moduoFavicon from "../../../assets/moduo_favicon.png";
import { UserMenu } from "../user-menu";

type TabItem = { label: string; iconName: IconName; href: string; module?: "notes" | "tasks" | "mindmap" | "templates" | "email" };
type TaskProjectOption = {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  description: string;
  position: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
type MenuAnchor = { left: number; top: number };

const AVATAR_STORAGE_KEY = "moduo:auth-avatar-preview-v1";
const AVATAR_STORE_NAMESPACE = "auth_ui";
const AVATAR_STORE_KEY = "avatar_preview_v1";

function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTaskProject(raw: any): TaskProjectOption {
  return {
    id: raw.id,
    workspaceId: raw.workspaceId ?? raw.workspace_id,
    ownerId: raw.ownerId ?? raw.owner_id,
    name: raw.name ?? "New Project",
    description: raw.description ?? "",
    position: raw.position ?? `m${Date.now().toString(36)}`,
    createdAt: raw.createdAt ?? raw.created_at ?? nowIso(),
    updatedAt: raw.updatedAt ?? raw.updated_at ?? nowIso(),
    deletedAt: raw.deletedAt ?? raw.deleted_at ?? null,
  };
}

const baseTabs: TabItem[] = [
  { label: "Dashboard", iconName: "grid", href: "/dashboard" },
  { label: "Notes", iconName: "file-text", href: "/notes", module: "notes" },
  { label: "Tasks", iconName: "check-square", href: "/tasks", module: "tasks" },
  { label: "Mindmap", iconName: "git-branch", href: "/mindmap", module: "mindmap" },
  { label: "Templates", iconName: "edit-3", href: "/templates", module: "templates" },
  { label: "Email", iconName: "mail", href: "/email", module: "email" },
  { label: "Calendar", iconName: "calendar", href: "/calendar" },
  { label: "CRM", iconName: "folder", href: "/crm" },
  { label: "Calendly", iconName: "calendar", href: "/calendly" },
  { label: "Forms", iconName: "edit-2", href: "/forms" },
  { label: "Activity", iconName: "bar-chart-2", href: "/activity" },
  { label: "Feed", iconName: "bar-chart-2", href: "/feed" },
  { label: "Files", iconName: "folder", href: "/files" },
  { label: "Brainstorm", iconName: "pen-tool", href: "/brainstorm" },
  { label: "Expanses", iconName: "dollar-sign", href: "/expanses" },
  { label: "Revenue", iconName: "dollar-sign", href: "/revenue" },
  { label: "KPI/OKR", iconName: "tag", href: "/kpi-okr" },
  { label: "Stats", iconName: "bar-chart-2", href: "/stats" },
  { label: "Analytics", iconName: "search", href: "/analytics" },
  { label: "Recordings", iconName: "file-text", href: "/recordings" },
  { label: "Timetracking", iconName: "clock", href: "/timetracking" },
  { label: "Roadmap", iconName: "git-branch", href: "/roadmap" },
];

export function AppChrome({ profileInitial }: { profileInitial: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const { runtime, userEmail, userId } = useAuth();
  const { loading, modulePermissions, selectedWorkspaceId } = useWorkspace();
  const currentFeature = routeToFeatureLayout(pathname);
  const isDashboardRoute = pathname === "/" || pathname.startsWith("/dashboard");
  const isTasksRoute = pathname.startsWith("/tasks");
  const isMindmapRoute = pathname.startsWith("/mindmap");
  const isBrainstormRoute = pathname.startsWith("/brainstorm");
  const isEmailRoute = pathname.startsWith("/email");
  const canEditTasks = modulePermissions.tasks === "edit" || modulePermissions.tasks === "admin";

  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [featurePanels, setFeaturePanels] = useState(() => readPanelsMap());
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [dashboardViews, setDashboardViews] = useState<DashboardViewOption[]>([DEFAULT_DASHBOARD_VIEW]);
  const [activeDashboardViewId, setActiveDashboardViewId] = useState<string>(DEFAULT_DASHBOARD_VIEW.id);
  const [dashboardMenuOpen, setDashboardMenuOpen] = useState(false);
  const [isCreatingDashboardView, setIsCreatingDashboardView] = useState(false);
  const [newDashboardViewName, setNewDashboardViewName] = useState("New Dashboard View");
  const [deleteCandidateDashboardViewId, setDeleteCandidateDashboardViewId] = useState<string | null>(null);
  const [deleteDashboardViewInput, setDeleteDashboardViewInput] = useState("");
  const [deleteSubmittingDashboardViewId, setDeleteSubmittingDashboardViewId] = useState<string | null>(null);
  const [taskProjects, setTaskProjects] = useState<TaskProjectOption[]>([]);
  const [selectedTaskProjectId, setSelectedTaskProjectId] = useState<string | null>(null);
  const [tasksMenuOpen, setTasksMenuOpen] = useState(false);
  const [isCreatingTaskProject, setIsCreatingTaskProject] = useState(false);
  const [newTaskProjectName, setNewTaskProjectName] = useState("New Project");
  const [deleteCandidateTaskProjectId, setDeleteCandidateTaskProjectId] = useState<string | null>(null);
  const [deleteTaskProjectInput, setDeleteTaskProjectInput] = useState("");
  const [deleteSubmittingTaskProjectId, setDeleteSubmittingTaskProjectId] = useState<string | null>(null);
  const [mindmaps, setMindmaps] = useState<MindmapOption[]>([]);
  const [selectedMindmapId, setSelectedMindmapId] = useState<string | null>(null);
  const [mindmapMenuOpen, setMindmapMenuOpen] = useState(false);
  const [isCreatingMindmap, setIsCreatingMindmap] = useState(false);
  const [newMindmapName, setNewMindmapName] = useState("New Mindmap");
  const [deleteCandidateMindmapId, setDeleteCandidateMindmapId] = useState<string | null>(null);
  const [deleteMindmapInput, setDeleteMindmapInput] = useState("");
  const [deleteSubmittingMindmapId, setDeleteSubmittingMindmapId] = useState<string | null>(null);
  const [dashboardMenuAnchor, setDashboardMenuAnchor] = useState<MenuAnchor | null>(null);
  const [tasksMenuAnchor, setTasksMenuAnchor] = useState<MenuAnchor | null>(null);
  const [mindmapMenuAnchor, setMindmapMenuAnchor] = useState<MenuAnchor | null>(null);
  const [brainstorms, setBrainstorms] = useState<BrainstormOption[]>([]);
  const [selectedBrainstormId, setSelectedBrainstormId] = useState<string | null>(null);
  const [brainstormMenuOpen, setBrainstormMenuOpen] = useState(false);
  const [isCreatingBrainstorm, setIsCreatingBrainstorm] = useState(false);
  const [newBrainstormName, setNewBrainstormName] = useState("New Brainstorm");
  const [deleteCandidateBrainstormId, setDeleteCandidateBrainstormId] = useState<string | null>(null);
  const [deleteBrainstormInput, setDeleteBrainstormInput] = useState("");
  const [deleteSubmittingBrainstormId, setDeleteSubmittingBrainstormId] = useState<string | null>(null);
  const [brainstormMenuAnchor, setBrainstormMenuAnchor] = useState<MenuAnchor | null>(null);
  const dashboardControlRef = useRef<HTMLDivElement | null>(null);
  const tasksControlRef = useRef<HTMLDivElement | null>(null);
  const mindmapControlRef = useRef<HTMLDivElement | null>(null);
  const brainstormControlRef = useRef<HTMLDivElement | null>(null);
  const rowStyle = { display: "flex", flexDirection: "row" as const, alignItems: "center" };
  const itemRowStyle = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: 8,
    minHeight: 32,
  } as const;
  const itemNameWrapStyle = { minWidth: 0, display: "flex", alignItems: "center", height: 28 } as const;
  const itemActionsStyle = { display: "flex", alignItems: "center", gap: 4, height: 28 } as const;
  const iconButtonStyle = { display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28 } as const;
  const plusButtonStyle = { display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24 } as const;
  const deleteRevealBaseStyle = {
    overflow: "hidden",
    transition: "max-height 220ms ease, opacity 180ms ease, transform 180ms ease, margin-top 180ms ease",
  } as const;

  const tabs = useMemo(
    () =>
      baseTabs.filter((tab) => {
        if (tab.module === "notes") return modulePermissions.notes !== "none";
        if (tab.module === "tasks") return modulePermissions.tasks !== "none";
        return true;
      }),
    [modulePermissions.notes, modulePermissions.tasks]
  );

  const activeDashboardViewName =
    dashboardViews.find((view) => view.id === activeDashboardViewId)?.name ?? DEFAULT_DASHBOARD_VIEW.name;
  const selectedTaskProjectLabel =
    selectedTaskProjectId === null
      ? "All projects"
      : taskProjects.find((project) => project.id === selectedTaskProjectId)?.name ?? "All projects";
  const selectedMindmapLabel =
    selectedMindmapId === null
      ? "No mindmap selected"
      : mindmaps.find((mindmap) => mindmap.id === selectedMindmapId)?.name ?? "No mindmap selected";
  const selectedBrainstormLabel =
    selectedBrainstormId === null
      ? "No session selected"
      : brainstorms.find((b) => b.id === selectedBrainstormId)?.name ?? "No session selected";

  useEffect(() => {
    if (!tabs.some((tab) => tab.href === pathname)) {
      void navigate({ to: tabs[0]?.href ?? "/dashboard", replace: true });
    }
  }, [navigate, pathname, tabs]);

  useEffect(() => {
    writePanelsMap(featurePanels);
  }, [featurePanels]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSetPanels = (event: Event) => {
      const detail = (event as CustomEvent<LayoutPanelsApplyDetail>).detail;
      if (!detail?.feature) return;
      setFeaturePanels((current) => ({
        ...current,
        [detail.feature]: { left: detail.left, right: detail.right },
      }));
    };
    window.addEventListener(LAYOUT_PANELS_SET_EVENT, onSetPanels);
    return () => window.removeEventListener(LAYOUT_PANELS_SET_EVENT, onSetPanels);
  }, []);

  useEffect(() => {
    const current = featurePanels[currentFeature];
    dispatchLayoutPanelsApply({
      feature: currentFeature,
      left: current.left,
      right: current.right,
    });
  }, [currentFeature, featurePanels]);

  useEffect(() => {
    if (!runtime || typeof document === "undefined") return;
    const publishActivity = async () => {
      if (document.visibilityState !== "hidden" && isEmailRoute) {
        // Email workspace publishes account/folder-specific foreground state.
        return;
      }
      const mode = document.visibilityState === "hidden" ? "appBackground" : "appForegroundNonMail";
      try {
        await runtime.email.setActivityState({
          mode,
          activeAccountId: null,
          activeFolder: null,
        });
      } catch {
        // best-effort signal only
      }
    };

    void publishActivity();
    const onVisibilityChange = () => {
      void publishActivity();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isEmailRoute, runtime]);

  useEffect(() => {
    if (!runtime || typeof document === "undefined" || typeof window === "undefined") return;
    const timer = window.setInterval(() => {
      const shouldRefreshInboxes = document.visibilityState === "hidden" || !isEmailRoute;
      if (!shouldRefreshInboxes) return;
      void runtime.email.syncNow({ folder: "inbox" });
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [isEmailRoute, runtime]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    const readAvatar = async () => {
      const fromLocal = window.localStorage.getItem(AVATAR_STORAGE_KEY);
      if (fromLocal) {
        if (active) setAvatarDataUrl(fromLocal);
        return;
      }
      if (!runtime) {
        if (active) setAvatarDataUrl(null);
        return;
      }
      const fromStore = await runtime.localStore.get(AVATAR_STORE_NAMESPACE, AVATAR_STORE_KEY).catch(() => null);
      const next = typeof fromStore === "string" && fromStore ? fromStore : null;
      if (next) window.localStorage.setItem(AVATAR_STORAGE_KEY, next);
      if (active) setAvatarDataUrl(next);
    };
    void readAvatar();
    const onStorage = () => {
      void readAvatar();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      active = false;
      window.removeEventListener("storage", onStorage);
    };
  }, [runtime]);

  useEffect(() => {
    if (!runtime) return;
    let active = true;
    const load = async () => {
      const { data } = await runtime.auth.getLocalAuthState();
      if (!active) return;
      setDisplayName(data.displayName);
    };
    void load();
    return () => {
      active = false;
    };
  }, [runtime]);

  useEffect(() => {
    setDashboardMenuOpen(false);
    setTasksMenuOpen(false);
    setMindmapMenuOpen(false);
    setIsCreatingDashboardView(false);
    setIsCreatingTaskProject(false);
    setIsCreatingMindmap(false);
    setDeleteCandidateDashboardViewId(null);
    setDeleteDashboardViewInput("");
    setDeleteSubmittingDashboardViewId(null);
    setDeleteCandidateMindmapId(null);
    setDeleteMindmapInput("");
    setDeleteSubmittingMindmapId(null);
    setBrainstormMenuOpen(false);
    setIsCreatingBrainstorm(false);
    setDeleteCandidateBrainstormId(null);
    setDeleteBrainstormInput("");
    setDeleteSubmittingBrainstormId(null);
  }, [pathname, selectedWorkspaceId]);

  const loadDashboardViews = useCallback(
    async (preferredViewId?: string | null) => {
      if (!runtime || !selectedWorkspaceId) {
        setDashboardViews([DEFAULT_DASHBOARD_VIEW]);
        setActiveDashboardViewId(DEFAULT_DASHBOARD_VIEW.id);
        return;
      }

      try {
        const views = await listDashboardViews(runtime, selectedWorkspaceId);
        const storedActive = await readPersistedDashboardActiveView(runtime, selectedWorkspaceId);
        setDashboardViews(views);
        setActiveDashboardViewId((current) => {
          const preferred = preferredViewId ?? storedActive ?? readStoredDashboardActiveView(selectedWorkspaceId) ?? current;
          const resolved =
            (preferred && views.some((view) => view.id === preferred) ? preferred : null) ?? views[0]?.id ?? DEFAULT_DASHBOARD_VIEW.id;
          writeStoredDashboardActiveView(selectedWorkspaceId, resolved);
          dispatchDashboardViewChange(resolved, views.find((view) => view.id === resolved)?.name);
          void writePersistedDashboardActiveView(runtime, selectedWorkspaceId, resolved).catch(console.error);
          return resolved;
        });
      } catch (error) {
        console.error(error);
        setDashboardViews([DEFAULT_DASHBOARD_VIEW]);
        setActiveDashboardViewId(DEFAULT_DASHBOARD_VIEW.id);
      }
    },
    [runtime, selectedWorkspaceId]
  );

  useEffect(() => {
    void loadDashboardViews();
  }, [loadDashboardViews]);

  const setActiveDashboardView = useCallback(
    (viewId: string) => {
      const view = dashboardViews.find((entry) => entry.id === viewId);
      if (!view || !runtime || !selectedWorkspaceId) return;
      setActiveDashboardViewId(viewId);
      writeStoredDashboardActiveView(selectedWorkspaceId, viewId);
      dispatchDashboardViewChange(viewId, view.name);
      void writePersistedDashboardActiveView(runtime, selectedWorkspaceId, viewId).catch(console.error);
    },
    [dashboardViews, runtime, selectedWorkspaceId]
  );

  const closeDashboardMenu = useCallback(() => {
    setDashboardMenuOpen(false);
    setIsCreatingDashboardView(false);
    setNewDashboardViewName("New Dashboard View");
    setDeleteCandidateDashboardViewId(null);
    setDeleteDashboardViewInput("");
    setDeleteSubmittingDashboardViewId(null);
  }, []);

  const cancelTaskProjectDeleteIntent = useCallback(() => {
    setDeleteCandidateTaskProjectId(null);
    setDeleteTaskProjectInput("");
    setDeleteSubmittingTaskProjectId(null);
  }, []);

  const closeTasksMenu = useCallback(() => {
    setTasksMenuOpen(false);
    setIsCreatingTaskProject(false);
    setNewTaskProjectName("New Project");
    cancelTaskProjectDeleteIntent();
  }, [cancelTaskProjectDeleteIntent]);

  const submitCreateDashboardView = useCallback(async () => {
    if (!runtime || !selectedWorkspaceId) return;
    const name = newDashboardViewName.trim() || "New Dashboard View";
    const nextView = { id: safeId(), name };
    const nextViews = [...dashboardViews, nextView];
    try {
      await saveDashboardViews(runtime, selectedWorkspaceId, nextViews);
      await ensureDashboardLayout(runtime, selectedWorkspaceId, nextView.id);
      await writePersistedDashboardActiveView(runtime, selectedWorkspaceId, nextView.id);
      setDashboardViews(nextViews);
      setActiveDashboardViewId(nextView.id);
      writeStoredDashboardActiveView(selectedWorkspaceId, nextView.id);
      dispatchDashboardViewChange(nextView.id, nextView.name);
      closeDashboardMenu();
    } catch (error) {
      console.error(error);
    }
  }, [closeDashboardMenu, dashboardViews, newDashboardViewName, runtime, selectedWorkspaceId]);

  const removeDashboardView = useCallback(
    async (viewId: string) => {
      if (!runtime || !selectedWorkspaceId) return;
      if (dashboardViews.length <= 1) return;
      const target = dashboardViews.find((view) => view.id === viewId);
      if (!target) return;
      if (deleteCandidateDashboardViewId !== viewId) return;
      if (deleteDashboardViewInput.trim() !== target.name.trim()) return;
      if (deleteSubmittingDashboardViewId === viewId) return;
      setDeleteSubmittingDashboardViewId(viewId);
      try {
        const nextViews = dashboardViews.filter((view) => view.id !== viewId);
        await saveDashboardViews(runtime, selectedWorkspaceId, nextViews);
        await deleteDashboardLayout(runtime, selectedWorkspaceId, viewId);
        setDashboardViews(nextViews);
        if (activeDashboardViewId === viewId) {
          const fallback = nextViews[0]?.id ?? DEFAULT_DASHBOARD_VIEW.id;
          setActiveDashboardView(fallback);
        }
        closeDashboardMenu();
      } finally {
        setDeleteSubmittingDashboardViewId(null);
      }
    },
    [
      activeDashboardViewId,
      closeDashboardMenu,
      dashboardViews,
      deleteCandidateDashboardViewId,
      deleteDashboardViewInput,
      deleteSubmittingDashboardViewId,
      runtime,
      selectedWorkspaceId,
      setActiveDashboardView,
    ]
  );

  const loadTaskProjects = useCallback(
    async (preferredProjectId?: string | null) => {
      if (!runtime || !selectedWorkspaceId) {
        setTaskProjects([]);
        setSelectedTaskProjectId(null);
        return;
      }

      const bundle = await runtime.tasks.list(selectedWorkspaceId);
      const nextProjects: TaskProjectOption[] = (bundle.projects ?? [])
        .map((project: any) => normalizeTaskProject(project))
        .filter((project: TaskProjectOption) => !project.deletedAt)
        .sort((a: TaskProjectOption, b: TaskProjectOption) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));

      setTaskProjects(nextProjects);
      setSelectedTaskProjectId((current) => {
        const preferred = preferredProjectId ?? current;
        if (preferred !== null && nextProjects.some((project) => project.id === preferred)) return preferred;
        return nextProjects[0]?.id ?? null;
      });
    },
    [runtime, selectedWorkspaceId]
  );

  useEffect(() => {
    if (!isTasksRoute) return;
    void loadTaskProjects();
  }, [isTasksRoute, loadTaskProjects]);

  useEffect(() => {
    if (!isTasksRoute) return;
    dispatchTasksSelectProject(selectedTaskProjectId);
  }, [isTasksRoute, selectedTaskProjectId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onProjectSelect = (event: Event) => {
      const detail = (event as CustomEvent<TasksSelectProjectDetail>).detail;
      const nextId = detail?.projectId ?? null;
      setSelectedTaskProjectId(nextId);
    };
    window.addEventListener(TASKS_SELECT_PROJECT_EVENT, onProjectSelect);
    return () => window.removeEventListener(TASKS_SELECT_PROJECT_EVENT, onProjectSelect);
  }, []);

  const submitCreateTaskProject = useCallback(async () => {
    if (!runtime || !selectedWorkspaceId || !userId || !canEditTasks) return;
    const name = newTaskProjectName.trim() || "New Project";
    const timestamp = nowIso();
    const project: TaskProjectOption = {
      id: safeId(),
      workspaceId: selectedWorkspaceId,
      ownerId: userId,
      name,
      description: "",
      position: `m${Date.now().toString(36)}`,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };

    await runtime.tasks.upsertProject(project);
    const stateBase = {
      workspaceId: selectedWorkspaceId,
      ownerId: userId,
      projectId: project.id,
      color: null as string | null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null as string | null,
    };
    await Promise.all([
      runtime.tasks.upsertState({
        ...stateBase,
        id: safeId(),
        name: "ToDo",
        kind: "todo",
        position: "todo-01",
      }),
      runtime.tasks.upsertState({
        ...stateBase,
        id: safeId(),
        name: "InProgress",
        kind: "in_progress",
        position: "in_progress-02",
      }),
      runtime.tasks.upsertState({
        ...stateBase,
        id: safeId(),
        name: "Done",
        kind: "done",
        position: "done-03",
      }),
    ]);
    await loadTaskProjects(project.id);
    closeTasksMenu();
    dispatchTasksSelectProject(project.id);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("moduo:data-refresh"));
    }
  }, [canEditTasks, closeTasksMenu, loadTaskProjects, newTaskProjectName, runtime, selectedWorkspaceId, userId]);

  const removeTaskProject = useCallback(
    async (projectId: string) => {
      if (!runtime || !canEditTasks) return;
      const current = taskProjects.find((project) => project.id === projectId);
      if (!current) return;
      if (deleteCandidateTaskProjectId !== projectId) return;
      if (deleteTaskProjectInput.trim() !== current.name.trim()) return;
      if (deleteSubmittingTaskProjectId === projectId) return;
      setDeleteSubmittingTaskProjectId(projectId);
      try {
        await runtime.tasks.upsertProject({ ...current, deletedAt: nowIso(), updatedAt: nowIso() });
        await loadTaskProjects(selectedTaskProjectId === projectId ? null : selectedTaskProjectId);
        closeTasksMenu();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("moduo:data-refresh"));
        }
      } finally {
        setDeleteSubmittingTaskProjectId((currentSubmittingId) =>
          currentSubmittingId === projectId ? null : currentSubmittingId
        );
      }
    },
    [
      canEditTasks,
      closeTasksMenu,
      deleteCandidateTaskProjectId,
      deleteSubmittingTaskProjectId,
      deleteTaskProjectInput,
      loadTaskProjects,
      runtime,
      selectedTaskProjectId,
      taskProjects,
    ]
  );

  const cancelMindmapDeleteIntent = useCallback(() => {
    setDeleteCandidateMindmapId(null);
    setDeleteMindmapInput("");
    setDeleteSubmittingMindmapId(null);
  }, []);

  const closeMindmapMenu = useCallback(() => {
    setMindmapMenuOpen(false);
    setIsCreatingMindmap(false);
    setNewMindmapName("New Mindmap");
    cancelMindmapDeleteIntent();
  }, [cancelMindmapDeleteIntent]);

  const loadMindmaps = useCallback(
    async (preferredMindmapId?: string | null) => {
      if (!runtime || !selectedWorkspaceId) {
        setMindmaps([]);
        setSelectedMindmapId(null);
        writeStoredActiveMindmap(selectedWorkspaceId ?? null, null);
        dispatchMindmapSelectMap(null);
        return;
      }
      const nextMindmaps = await listMindmaps(runtime, selectedWorkspaceId);
      setMindmaps(nextMindmaps);
      setSelectedMindmapId((current) => {
        const preferred = preferredMindmapId ?? readStoredActiveMindmap(selectedWorkspaceId) ?? current;
        const resolved = preferred && nextMindmaps.some((mindmap) => mindmap.id === preferred) ? preferred : nextMindmaps[0]?.id ?? null;
        writeStoredActiveMindmap(selectedWorkspaceId, resolved);
        dispatchMindmapSelectMap(resolved, nextMindmaps.find((mindmap) => mindmap.id === resolved)?.name);
        return resolved;
      });
    },
    [runtime, selectedWorkspaceId]
  );

  const submitCreateMindmap = useCallback(async () => {
    if (!runtime || !selectedWorkspaceId || !userId) return;
    const map = await createMindmap(runtime, {
      workspaceId: selectedWorkspaceId,
      ownerId: userId,
      name: newMindmapName,
    });
    await loadMindmaps(map.id);
    closeMindmapMenu();
  }, [closeMindmapMenu, loadMindmaps, newMindmapName, runtime, selectedWorkspaceId, userId]);

  const removeMindmap = useCallback(
    async (mindmapId: string) => {
      if (!runtime || !selectedWorkspaceId) return;
      const current = mindmaps.find((mindmap) => mindmap.id === mindmapId);
      if (!current) return;
      if (deleteCandidateMindmapId !== mindmapId) return;
      if (deleteMindmapInput.trim() !== current.name.trim()) return;
      if (deleteSubmittingMindmapId === mindmapId) return;
      setDeleteSubmittingMindmapId(mindmapId);
      try {
        await deleteMindmap(runtime, selectedWorkspaceId, mindmapId);
        await loadMindmaps(selectedMindmapId === mindmapId ? null : selectedMindmapId);
        cancelMindmapDeleteIntent();
      } finally {
        setDeleteSubmittingMindmapId(null);
      }
    },
    [
      cancelMindmapDeleteIntent,
      deleteCandidateMindmapId,
      deleteMindmapInput,
      deleteSubmittingMindmapId,
      loadMindmaps,
      mindmaps,
      runtime,
      selectedMindmapId,
      selectedWorkspaceId,
    ]
  );

  useEffect(() => {
    void loadMindmaps();
  }, [loadMindmaps]);

  useEffect(() => {
    if (!isMindmapRoute) return;
    dispatchMindmapSelectMap(selectedMindmapId, mindmaps.find((mindmap) => mindmap.id === selectedMindmapId)?.name);
  }, [isMindmapRoute, mindmaps, selectedMindmapId]);

  const cancelBrainstormDeleteIntent = useCallback(() => {
    setDeleteCandidateBrainstormId(null);
    setDeleteBrainstormInput("");
    setDeleteSubmittingBrainstormId(null);
  }, []);

  const closeBrainstormMenu = useCallback(() => {
    setBrainstormMenuOpen(false);
    setIsCreatingBrainstorm(false);
    setNewBrainstormName("New Brainstorm");
    cancelBrainstormDeleteIntent();
  }, [cancelBrainstormDeleteIntent]);

  const loadBrainstorms = useCallback(
    async (preferredId?: string | null) => {
      if (!runtime || !selectedWorkspaceId) {
        setBrainstorms([]);
        setSelectedBrainstormId(null);
        writeStoredActiveBrainstorm(selectedWorkspaceId ?? null, null);
        dispatchBrainstormSelectView(null);
        return;
      }
      const next = await listBrainstorms(runtime, selectedWorkspaceId);
      setBrainstorms(next);
      setSelectedBrainstormId((current) => {
        const preferred = preferredId ?? readStoredActiveBrainstorm(selectedWorkspaceId) ?? current;
        const resolved = preferred && next.some((b) => b.id === preferred) ? preferred : next[0]?.id ?? null;
        writeStoredActiveBrainstorm(selectedWorkspaceId, resolved);
        dispatchBrainstormSelectView(resolved, next.find((b) => b.id === resolved)?.name);
        return resolved;
      });
    },
    [runtime, selectedWorkspaceId]
  );

  const submitCreateBrainstorm = useCallback(async () => {
    if (!runtime || !selectedWorkspaceId || !userId) return;
    const created = await createBrainstorm(runtime, {
      workspaceId: selectedWorkspaceId,
      ownerId: userId,
      name: newBrainstormName,
    });
    await loadBrainstorms(created.id);
    closeBrainstormMenu();
  }, [closeBrainstormMenu, loadBrainstorms, newBrainstormName, runtime, selectedWorkspaceId, userId]);

  const removeBrainstorm = useCallback(
    async (brainstormId: string) => {
      if (!runtime || !selectedWorkspaceId) return;
      const current = brainstorms.find((b) => b.id === brainstormId);
      if (!current) return;
      if (deleteCandidateBrainstormId !== brainstormId) return;
      if (deleteBrainstormInput.trim() !== current.name.trim()) return;
      if (deleteSubmittingBrainstormId === brainstormId) return;
      setDeleteSubmittingBrainstormId(brainstormId);
      try {
        await deleteBrainstorm(runtime, selectedWorkspaceId, brainstormId);
        await loadBrainstorms(selectedBrainstormId === brainstormId ? null : selectedBrainstormId);
        cancelBrainstormDeleteIntent();
      } finally {
        setDeleteSubmittingBrainstormId(null);
      }
    },
    [
      cancelBrainstormDeleteIntent,
      deleteCandidateBrainstormId,
      deleteBrainstormInput,
      deleteSubmittingBrainstormId,
      loadBrainstorms,
      brainstorms,
      runtime,
      selectedBrainstormId,
      selectedWorkspaceId,
    ]
  );

  useEffect(() => {
    void loadBrainstorms();
  }, [loadBrainstorms]);

  useEffect(() => {
    if (!isBrainstormRoute) return;
    dispatchBrainstormSelectView(selectedBrainstormId, brainstorms.find((b) => b.id === selectedBrainstormId)?.name);
  }, [isBrainstormRoute, brainstorms, selectedBrainstormId]);

  const updateDashboardMenuAnchor = useCallback(() => {
    if (typeof window === "undefined") return;
    const rect = dashboardControlRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - 372));
    setDashboardMenuAnchor({ left, top: rect.bottom + 8 });
  }, []);

  const updateTasksMenuAnchor = useCallback(() => {
    if (typeof window === "undefined") return;
    const rect = tasksControlRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - 372));
    setTasksMenuAnchor({ left, top: rect.bottom + 8 });
  }, []);

  const updateMindmapMenuAnchor = useCallback(() => {
    if (typeof window === "undefined") return;
    const rect = mindmapControlRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - 372));
    setMindmapMenuAnchor({ left, top: rect.bottom + 8 });
  }, []);

  const updateBrainstormMenuAnchor = useCallback(() => {
    if (typeof window === "undefined") return;
    const rect = brainstormControlRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - 372));
    setBrainstormMenuAnchor({ left, top: rect.bottom + 8 });
  }, []);

  const toggleDashboardMenu = useCallback(() => {
    closeTasksMenu();
    closeMindmapMenu();
    closeBrainstormMenu();
    if (dashboardMenuOpen) {
      closeDashboardMenu();
      return;
    }
    updateDashboardMenuAnchor();
    setDashboardMenuOpen(true);
  }, [closeBrainstormMenu, closeDashboardMenu, closeMindmapMenu, closeTasksMenu, dashboardMenuOpen, updateDashboardMenuAnchor]);

  const toggleTasksMenu = useCallback(() => {
    closeDashboardMenu();
    closeMindmapMenu();
    closeBrainstormMenu();
    if (tasksMenuOpen) {
      closeTasksMenu();
      return;
    }
    updateTasksMenuAnchor();
    setTasksMenuOpen(true);
  }, [closeBrainstormMenu, closeDashboardMenu, closeMindmapMenu, closeTasksMenu, tasksMenuOpen, updateTasksMenuAnchor]);

  const toggleMindmapMenu = useCallback(() => {
    closeDashboardMenu();
    closeTasksMenu();
    closeBrainstormMenu();
    if (mindmapMenuOpen) {
      closeMindmapMenu();
      return;
    }
    updateMindmapMenuAnchor();
    setMindmapMenuOpen(true);
  }, [closeBrainstormMenu, closeDashboardMenu, closeMindmapMenu, closeTasksMenu, mindmapMenuOpen, updateMindmapMenuAnchor]);

  const toggleBrainstormMenu = useCallback(() => {
    closeDashboardMenu();
    closeTasksMenu();
    closeMindmapMenu();
    if (brainstormMenuOpen) {
      closeBrainstormMenu();
      return;
    }
    updateBrainstormMenuAnchor();
    setBrainstormMenuOpen(true);
  }, [closeBrainstormMenu, closeDashboardMenu, closeMindmapMenu, closeTasksMenu, brainstormMenuOpen, updateBrainstormMenuAnchor]);

  useEffect(() => {
    if (typeof window === "undefined" || (!dashboardMenuOpen && !tasksMenuOpen && !mindmapMenuOpen && !brainstormMenuOpen)) return;
    const onReposition = () => {
      if (dashboardMenuOpen) updateDashboardMenuAnchor();
      if (tasksMenuOpen) updateTasksMenuAnchor();
      if (mindmapMenuOpen) updateMindmapMenuAnchor();
      if (brainstormMenuOpen) updateBrainstormMenuAnchor();
    };
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [brainstormMenuOpen, dashboardMenuOpen, mindmapMenuOpen, tasksMenuOpen, updateBrainstormMenuAnchor, updateDashboardMenuAnchor, updateMindmapMenuAnchor, updateTasksMenuAnchor]);

  const setPanelsForFeature = useCallback((feature: FeatureLayoutKey, left: boolean, right: boolean) => {
    setFeaturePanels((current) => ({
      ...current,
      [feature]: { left, right },
    }));
  }, []);

  if (loading) {
    return (
      <View className="flex-1 bg-[#0C0C0C] items-center justify-center">
        <Text className="text-[#a0a0a0] text-[14px]">Loading workspace...</Text>
      </View>
    );
  }

  const currentPanels = featurePanels[currentFeature];
  const derivedInitial =
    displayName?.trim().slice(0, 1).toUpperCase() ||
    userEmail?.trim().slice(0, 1).toUpperCase() ||
    profileInitial;
  const toggleLeftPanel = () => setPanelsForFeature(currentFeature, !currentPanels.left, currentPanels.right);
  const toggleRightPanel = () => setPanelsForFeature(currentFeature, currentPanels.left, !currentPanels.right);

  return (
    <View className="flex h-screen min-h-screen flex-col overflow-hidden bg-[#0C0C0C]">
      <View className="relative z-[400] px-5 pt-4 pb-2 bg-[#0C0C0C]">
        <View className="relative z-[410] flex flex-row items-center justify-between gap-3">
          <View className="min-w-[260px] flex flex-row items-center gap-3">
            <Image source={moduoFavicon} className="h-8 w-8 shrink-0" contentFit="contain" />
            <WorkspaceSwitcher onOpenSettings={() => setWorkspaceSettingsOpen(true)} />
          </View>

          <View className="min-w-0 flex-1 overflow-x-auto overflow-y-visible">
            <View className="flex min-w-max flex-row items-center gap-2 pr-2">
              {tabs.map((tab) => {
                const active = pathname === tab.href || (tab.href !== "/" && pathname.startsWith(tab.href));
                const isDashboardTab = tab.href === "/dashboard";
                const isTasksTab = tab.href === "/tasks";
                const isMindmapTab = tab.href === "/mindmap";
                const isBrainstormTab = tab.href === "/brainstorm";
                return (
                  <View key={tab.href} className="relative flex flex-row items-center">
                    <Pressable
                      className="flex flex-row items-center gap-2 bg-transparent border-0 rounded-none px-3 py-2"
                      onPress={() => void navigate({ to: tab.href })}
                    >
                      <Icon name={tab.iconName} size={14} color={active ? "#f2f2f2" : "#9a9a9a"} />
                      <Text className={`${active ? "text-[#f5f5f5]" : "text-[#a3a3a3]"} text-[14px]`}>{tab.label}</Text>
                    </Pressable>

                    {isDashboardTab && isDashboardRoute ? (
                      <View ref={dashboardControlRef} className="relative ml-1 overflow-visible z-[600] shrink-0">
                        <Pressable className="flex h-8 flex-row items-center gap-2 rounded-md bg-[#111111] px-3" onPress={toggleDashboardMenu}>
                          <Text className="text-[13px] text-[#d7d7d7]">{activeDashboardViewName}</Text>
                          <Text className="text-[11px] text-[#8f8f8f]">▾</Text>
                        </Pressable>
                      </View>
                    ) : null}

                    {isTasksTab && isTasksRoute ? (
                      <View ref={tasksControlRef} className="relative ml-1 overflow-visible z-[600] shrink-0">
                        <Pressable className="flex h-8 flex-row items-center gap-2 rounded-md bg-[#111111] px-3" onPress={toggleTasksMenu}>
                          <Text className="text-[13px] text-[#d7d7d7]">{selectedTaskProjectLabel}</Text>
                          <Text className="text-[11px] text-[#8f8f8f]">▾</Text>
                        </Pressable>
                      </View>
                    ) : null}

                    {isMindmapTab && isMindmapRoute ? (
                      <View ref={mindmapControlRef} className="relative ml-1 overflow-visible z-[600] shrink-0">
                        <Pressable className="flex h-8 flex-row items-center gap-2 rounded-md bg-[#111111] px-3" onPress={toggleMindmapMenu}>
                          <Text className="text-[13px] text-[#d7d7d7]">{selectedMindmapLabel}</Text>
                          <Text className="text-[11px] text-[#8f8f8f]">▾</Text>
                        </Pressable>
                      </View>
                    ) : null}

                    {isBrainstormTab && isBrainstormRoute ? (
                      <View ref={brainstormControlRef} className="relative ml-1 overflow-visible z-[600] shrink-0">
                        <Pressable className="flex h-8 flex-row items-center gap-2 rounded-md bg-[#111111] px-3" onPress={toggleBrainstormMenu}>
                          <Text className="text-[13px] text-[#d7d7d7]">{selectedBrainstormLabel}</Text>
                          <Text className="text-[11px] text-[#8f8f8f]">▾</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>

          {dashboardMenuOpen && dashboardMenuAnchor ? (
            <Modal transparent visible={dashboardMenuOpen} animationType="fade" onRequestClose={closeDashboardMenu}>
              <Pressable className="fixed inset-0 z-[998]" onPress={closeDashboardMenu} />
              <View className="fixed z-[1000] w-[360px] rounded-xl bg-[#171717] p-2" style={{ left: dashboardMenuAnchor.left, top: dashboardMenuAnchor.top }}>
                <View className="mb-2 border-b border-[#262626] px-2 pb-2 pt-1" style={rowStyle}>
                  <View className="min-w-0 flex flex-1 gap-2" style={rowStyle}>
                    <Text className="text-[#a0a0a0] text-xs">All views</Text>
                    <Pressable
                      className="rounded-md"
                      style={plusButtonStyle}
                      onPress={(event: any) => {
                        event?.stopPropagation?.();
                        setIsCreatingDashboardView(true);
                        setNewDashboardViewName("New Dashboard View");
                      }}
                    >
                      <Text className="text-[#d8d8d8] text-[16px] leading-none">+</Text>
                    </Pressable>
                  </View>
                </View>
                <View className="max-h-[260px] overflow-y-auto">
                  {isCreatingDashboardView ? (
                    <View className="mb-2 rounded-lg border border-[#2a2a2a] bg-[#1b1b1b] px-2 py-2" style={rowStyle}>
                      <TextInput
                        autoFocus
                        value={newDashboardViewName}
                        onChangeText={setNewDashboardViewName}
                        onKeyDown={(event: any) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            submitCreateDashboardView();
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setIsCreatingDashboardView(false);
                          }
                        }}
                        className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[13px] text-[#e5e5e5] outline-none"
                      />
                      <View className="ml-1" style={rowStyle}>
                        <Pressable className="rounded-md hover:bg-[#2b2b2b]" style={iconButtonStyle} onPress={submitCreateDashboardView}>
                          <Text className="text-[14px] leading-none text-[#d8d8d8]">✓</Text>
                        </Pressable>
                        <Pressable
                          className="rounded-md hover:bg-[#2b2b2b]"
                          style={iconButtonStyle}
                          onPress={() => {
                            setIsCreatingDashboardView(false);
                            setNewDashboardViewName("New Dashboard View");
                          }}
                        >
                          <Text className="text-[14px] leading-none text-[#d8d8d8]">×</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}

                  {dashboardViews.map((view) => {
                    const isActiveView = view.id === activeDashboardViewId;
                    const isDeleteOpen = deleteCandidateDashboardViewId === view.id;
                    const deleteMatches = deleteDashboardViewInput.trim() === view.name.trim();
                    return (
                      <View
                        key={view.id}
                        className={`rounded-lg px-3 py-2 ${isActiveView ? "bg-[#242424]" : "bg-transparent hover:bg-[#1f1f1f]"}`}
                      >
                        <Pressable
                          onPress={() => {
                            setActiveDashboardView(view.id);
                            closeDashboardMenu();
                          }}
                        >
                          <View style={itemRowStyle}>
                            <View style={itemNameWrapStyle}>
                              <Text
                                as="div"
                                className={`${isActiveView ? "text-white" : "text-[#d9d9d9]"} text-[14px]`}
                                style={{ lineHeight: "28px" }}
                                numberOfLines={1}
                              >
                                {view.name}
                              </Text>
                            </View>
                            <View className="shrink-0" style={itemActionsStyle}>
                              <Pressable
                                className="rounded-md hover:bg-[#2b2b2b]"
                                style={iconButtonStyle}
                                onPress={(event: any) => {
                                  event?.stopPropagation?.();
                                }}
                              >
                                <Icon name="settings" size={13} color="#d8d8d8" />
                              </Pressable>
                              <Pressable
                                className="rounded-md hover:bg-[#2b2b2b]"
                                style={iconButtonStyle}
                                onPress={(event: any) => {
                                  event?.stopPropagation?.();
                                  if (isDeleteOpen) {
                                    setDeleteCandidateDashboardViewId(null);
                                    setDeleteDashboardViewInput("");
                                    setDeleteSubmittingDashboardViewId(null);
                                  } else {
                                    setDeleteCandidateDashboardViewId(view.id);
                                    setDeleteDashboardViewInput("");
                                  }
                                }}
                                disabled={dashboardViews.length <= 1}
                              >
                                <Icon name="trash-2" size={13} color={dashboardViews.length > 1 ? "#ffb0b0" : "#6a6a6a"} />
                              </Pressable>
                            </View>
                          </View>
                        </Pressable>

                        <View
                          style={{
                            ...deleteRevealBaseStyle,
                            maxHeight: isDeleteOpen ? 116 : 0,
                            opacity: isDeleteOpen ? 1 : 0,
                            transform: isDeleteOpen ? "translateY(0)" : "translateY(-4px)",
                            marginTop: isDeleteOpen ? 8 : 0,
                          }}
                        >
                          <Text className="text-[11px] text-[#9a9a9a]">
                            Retype <Text className="font-semibold text-[#d9d9d9]">{view.name}</Text> to delete this view.
                          </Text>
                          <View className="mt-2" style={rowStyle}>
                            <TextInput
                              value={deleteDashboardViewInput}
                              onChangeText={setDeleteDashboardViewInput}
                              onKeyDown={(event: any) => {
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  setDeleteCandidateDashboardViewId(null);
                                  setDeleteDashboardViewInput("");
                                  setDeleteSubmittingDashboardViewId(null);
                                }
                                if (event.key === "Enter" && deleteMatches && deleteSubmittingDashboardViewId !== view.id) {
                                  event.preventDefault();
                                  removeDashboardView(view.id);
                                }
                              }}
                              placeholder={view.name}
                              className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[12px] text-[#e5e5e5] outline-none"
                            />
                            <Pressable
                              className="ml-1 rounded-md hover:bg-[#2b2b2b]"
                              style={iconButtonStyle}
                              onPress={() => {
                                setDeleteCandidateDashboardViewId(null);
                                setDeleteDashboardViewInput("");
                                setDeleteSubmittingDashboardViewId(null);
                              }}
                            >
                              <Text className="text-[12px] leading-none text-[#d0d0d0]">×</Text>
                            </Pressable>
                            <Pressable
                              className="ml-1 rounded-md"
                              style={iconButtonStyle}
                              onPress={() => removeDashboardView(view.id)}
                              aria-disabled={!deleteMatches || deleteSubmittingDashboardViewId === view.id}
                            >
                              <Text
                                className={`text-[11px] font-semibold leading-none ${
                                  deleteMatches && deleteSubmittingDashboardViewId !== view.id ? "text-[#ffb0b0]" : "text-[#6a6a6a]"
                                }`}
                              >
                                Del
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            </Modal>
          ) : null}

          {tasksMenuOpen && tasksMenuAnchor ? (
            <Modal transparent visible={tasksMenuOpen} animationType="fade" onRequestClose={closeTasksMenu}>
              <Pressable className="fixed inset-0 z-[998]" onPress={closeTasksMenu} />
              <View className="fixed z-[1000] w-[360px] rounded-xl bg-[#171717] p-2" style={{ left: tasksMenuAnchor.left, top: tasksMenuAnchor.top }}>
                <View className="mb-2 border-b border-[#262626] px-2 pb-2 pt-1" style={rowStyle}>
                  <View className="min-w-0 flex flex-1 gap-2" style={rowStyle}>
                    <Text className="text-[#a0a0a0] text-xs">All projects</Text>
                    <Pressable
                      className="rounded-md"
                      style={plusButtonStyle}
                      onPress={(event: any) => {
                        event?.stopPropagation?.();
                        if (!canEditTasks) return;
                        setIsCreatingTaskProject(true);
                        setNewTaskProjectName("New Project");
                      }}
                      disabled={!canEditTasks}
                    >
                      <Text className={`text-[16px] leading-none ${canEditTasks ? "text-[#d8d8d8]" : "text-[#6a6a6a]"}`}>+</Text>
                    </Pressable>
                  </View>
                </View>
                <View className="max-h-[260px] overflow-y-auto">
                  {isCreatingTaskProject && canEditTasks ? (
                    <View className="mb-2 rounded-lg border border-[#2a2a2a] bg-[#1b1b1b] px-2 py-2" style={rowStyle}>
                      <TextInput
                        autoFocus
                        value={newTaskProjectName}
                        onChangeText={setNewTaskProjectName}
                        onKeyDown={(event: any) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void submitCreateTaskProject();
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setIsCreatingTaskProject(false);
                          }
                        }}
                        className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[13px] text-[#e5e5e5] outline-none"
                      />
                      <View className="ml-1" style={rowStyle}>
                        <Pressable className="rounded-md hover:bg-[#2b2b2b]" style={iconButtonStyle} onPress={() => void submitCreateTaskProject()}>
                          <Text className="text-[14px] leading-none text-[#d8d8d8]">✓</Text>
                        </Pressable>
                        <Pressable
                          className="rounded-md hover:bg-[#2b2b2b]"
                          style={iconButtonStyle}
                          onPress={() => {
                            setIsCreatingTaskProject(false);
                            setNewTaskProjectName("New Project");
                          }}
                        >
                          <Text className="text-[14px] leading-none text-[#d8d8d8]">×</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}

                  <View className={`rounded-lg px-3 py-2 ${selectedTaskProjectId === null ? "bg-[#242424]" : "bg-transparent hover:bg-[#1f1f1f]"}`}>
                    <Pressable
                      onPress={() => {
                        setSelectedTaskProjectId(null);
                        closeTasksMenu();
                      }}
                    >
                      <View style={itemRowStyle}>
                        <View style={itemNameWrapStyle}>
                          <Text
                            as="div"
                            className={`${selectedTaskProjectId === null ? "text-white" : "text-[#d9d9d9]"} text-[14px]`}
                            style={{ lineHeight: "28px" }}
                            numberOfLines={1}
                          >
                            All projects
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  </View>

                  {taskProjects.map((project) => {
                    const isActiveProject = selectedTaskProjectId === project.id;
                    const isDeleteOpen = deleteCandidateTaskProjectId === project.id;
                    const deleteMatches = deleteTaskProjectInput.trim() === project.name.trim();
                    return (
                      <View
                        key={project.id}
                        className={`rounded-lg px-3 py-2 ${isActiveProject ? "bg-[#242424]" : "bg-transparent hover:bg-[#1f1f1f]"}`}
                      >
                        <Pressable
                          onPress={() => {
                            setSelectedTaskProjectId(project.id);
                            closeTasksMenu();
                          }}
                        >
                          <View style={itemRowStyle}>
                            <View style={itemNameWrapStyle}>
                              <Text
                                as="div"
                                className={`${isActiveProject ? "text-white" : "text-[#d9d9d9]"} text-[14px]`}
                                style={{ lineHeight: "28px" }}
                                numberOfLines={1}
                              >
                                {project.name}
                              </Text>
                            </View>
                            <View className="shrink-0" style={itemActionsStyle}>
                              <Pressable
                                className="rounded-md hover:bg-[#2b2b2b]"
                                style={iconButtonStyle}
                                onPress={(event: any) => {
                                  event?.stopPropagation?.();
                                }}
                                disabled={!canEditTasks}
                              >
                                <Icon name="settings" size={13} color={canEditTasks ? "#d8d8d8" : "#6a6a6a"} />
                              </Pressable>
                              <Pressable
                                className="rounded-md hover:bg-[#2b2b2b]"
                                style={iconButtonStyle}
                                onPress={(event: any) => {
                                  event?.stopPropagation?.();
                                  if (isDeleteOpen) {
                                    cancelTaskProjectDeleteIntent();
                                  } else {
                                    setDeleteCandidateTaskProjectId(project.id);
                                    setDeleteTaskProjectInput("");
                                  }
                                }}
                                disabled={!canEditTasks}
                              >
                                <Icon name="trash-2" size={13} color={canEditTasks ? "#ffb0b0" : "#6a6a6a"} />
                              </Pressable>
                            </View>
                          </View>
                        </Pressable>

                        <View
                          style={{
                            ...deleteRevealBaseStyle,
                            maxHeight: isDeleteOpen ? 116 : 0,
                            opacity: isDeleteOpen ? 1 : 0,
                            transform: isDeleteOpen ? "translateY(0)" : "translateY(-4px)",
                            marginTop: isDeleteOpen ? 8 : 0,
                          }}
                        >
                          <Text className="text-[11px] text-[#9a9a9a]">
                            Retype <Text className="font-semibold text-[#d9d9d9]">{project.name}</Text> to delete this project.
                          </Text>
                          <View className="mt-2" style={rowStyle}>
                            <TextInput
                              value={deleteTaskProjectInput}
                              onChangeText={setDeleteTaskProjectInput}
                              onKeyDown={(event: any) => {
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  cancelTaskProjectDeleteIntent();
                                }
                                if (event.key === "Enter" && deleteMatches && deleteSubmittingTaskProjectId !== project.id) {
                                  event.preventDefault();
                                  void removeTaskProject(project.id);
                                }
                              }}
                              placeholder={project.name}
                              className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[12px] text-[#e5e5e5] outline-none"
                            />
                            <Pressable className="ml-1 rounded-md hover:bg-[#2b2b2b]" style={iconButtonStyle} onPress={cancelTaskProjectDeleteIntent}>
                              <Text className="text-[12px] leading-none text-[#d0d0d0]">×</Text>
                            </Pressable>
                            <Pressable
                              className="ml-1 rounded-md"
                              style={iconButtonStyle}
                              onPress={() => void removeTaskProject(project.id)}
                              aria-disabled={!deleteMatches || deleteSubmittingTaskProjectId === project.id}
                            >
                              <Text
                                className={`text-[11px] font-semibold leading-none ${
                                  deleteMatches && deleteSubmittingTaskProjectId !== project.id ? "text-[#ffb0b0]" : "text-[#6a6a6a]"
                                }`}
                              >
                                Del
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            </Modal>
          ) : null}

          {mindmapMenuOpen && mindmapMenuAnchor ? (
            <Modal transparent visible={mindmapMenuOpen} animationType="fade" onRequestClose={closeMindmapMenu}>
              <Pressable className="fixed inset-0 z-[998]" onPress={closeMindmapMenu} />
              <View className="fixed z-[1000] w-[360px] rounded-xl bg-[#171717] p-2" style={{ left: mindmapMenuAnchor.left, top: mindmapMenuAnchor.top }}>
                <View className="mb-2 border-b border-[#262626] px-2 pb-2 pt-1" style={rowStyle}>
                  <View className="min-w-0 flex flex-1 gap-2" style={rowStyle}>
                    <Text className="text-[#a0a0a0] text-xs">All mindmaps</Text>
                    <Pressable
                      className="rounded-md"
                      style={plusButtonStyle}
                      onPress={(event: any) => {
                        event?.stopPropagation?.();
                        setIsCreatingMindmap(true);
                        setNewMindmapName("New Mindmap");
                      }}
                    >
                      <Text className="text-[#d8d8d8] text-[16px] leading-none">+</Text>
                    </Pressable>
                  </View>
                </View>
                <View className="max-h-[260px] overflow-y-auto">
                  {isCreatingMindmap ? (
                    <View className="mb-2 rounded-lg border border-[#2a2a2a] bg-[#1b1b1b] px-2 py-2" style={rowStyle}>
                      <TextInput
                        autoFocus
                        value={newMindmapName}
                        onChangeText={setNewMindmapName}
                        onKeyDown={(event: any) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void submitCreateMindmap();
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setIsCreatingMindmap(false);
                          }
                        }}
                        className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[13px] text-[#e5e5e5] outline-none"
                      />
                      <View className="ml-1" style={rowStyle}>
                        <Pressable className="rounded-md hover:bg-[#2b2b2b]" style={iconButtonStyle} onPress={() => void submitCreateMindmap()}>
                          <Text className="text-[14px] leading-none text-[#d8d8d8]">✓</Text>
                        </Pressable>
                        <Pressable
                          className="rounded-md hover:bg-[#2b2b2b]"
                          style={iconButtonStyle}
                          onPress={() => {
                            setIsCreatingMindmap(false);
                            setNewMindmapName("New Mindmap");
                          }}
                        >
                          <Text className="text-[14px] leading-none text-[#d8d8d8]">×</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}

                  {mindmaps.length === 0 ? (
                    <View className="px-3 py-2">
                      <Text className="text-[13px] text-[#8f8f8f]">No mindmaps yet.</Text>
                    </View>
                  ) : null}

                  {mindmaps.map((mindmap) => {
                    const isActiveMindmap = selectedMindmapId === mindmap.id;
                    const isDeleteOpen = deleteCandidateMindmapId === mindmap.id;
                    const deleteMatches = deleteMindmapInput.trim() === mindmap.name.trim();
                    return (
                      <View
                        key={mindmap.id}
                        className={`rounded-lg px-3 py-2 ${isActiveMindmap ? "bg-[#242424]" : "bg-transparent hover:bg-[#1f1f1f]"}`}
                      >
                        <Pressable
                          onPress={() => {
                            setSelectedMindmapId(mindmap.id);
                            writeStoredActiveMindmap(selectedWorkspaceId, mindmap.id);
                            dispatchMindmapSelectMap(mindmap.id, mindmap.name);
                            closeMindmapMenu();
                          }}
                        >
                          <View style={itemRowStyle}>
                            <View style={itemNameWrapStyle}>
                              <Text
                                as="div"
                                className={`${isActiveMindmap ? "text-white" : "text-[#d9d9d9]"} text-[14px]`}
                                style={{ lineHeight: "28px" }}
                                numberOfLines={1}
                              >
                                {mindmap.name}
                              </Text>
                            </View>
                            <View className="shrink-0" style={itemActionsStyle}>
                              <Pressable
                                className="rounded-md hover:bg-[#2b2b2b]"
                                style={iconButtonStyle}
                                onPress={(event: any) => {
                                  event?.stopPropagation?.();
                                }}
                              >
                                <Icon name="settings" size={13} color="#d8d8d8" />
                              </Pressable>
                              <Pressable
                                className="rounded-md hover:bg-[#2b2b2b]"
                                style={iconButtonStyle}
                                onPress={(event: any) => {
                                  event?.stopPropagation?.();
                                  if (isDeleteOpen) {
                                    cancelMindmapDeleteIntent();
                                  } else {
                                    setDeleteCandidateMindmapId(mindmap.id);
                                    setDeleteMindmapInput("");
                                  }
                                }}
                              >
                                <Icon name="trash-2" size={13} color="#ffb0b0" />
                              </Pressable>
                            </View>
                          </View>
                        </Pressable>

                        <View
                          style={{
                            ...deleteRevealBaseStyle,
                            maxHeight: isDeleteOpen ? 116 : 0,
                            opacity: isDeleteOpen ? 1 : 0,
                            transform: isDeleteOpen ? "translateY(0)" : "translateY(-4px)",
                            marginTop: isDeleteOpen ? 8 : 0,
                          }}
                        >
                          <Text className="text-[11px] text-[#9a9a9a]">
                            Retype <Text className="font-semibold text-[#d9d9d9]">{mindmap.name}</Text> to delete this mindmap.
                          </Text>
                          <View className="mt-2" style={rowStyle}>
                            <TextInput
                              value={deleteMindmapInput}
                              onChangeText={setDeleteMindmapInput}
                              onKeyDown={(event: any) => {
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  cancelMindmapDeleteIntent();
                                }
                                if (event.key === "Enter" && deleteMatches && deleteSubmittingMindmapId !== mindmap.id) {
                                  event.preventDefault();
                                  void removeMindmap(mindmap.id);
                                }
                              }}
                              placeholder={mindmap.name}
                              className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[12px] text-[#e5e5e5] outline-none"
                            />
                            <Pressable className="ml-1 rounded-md hover:bg-[#2b2b2b]" style={iconButtonStyle} onPress={cancelMindmapDeleteIntent}>
                              <Text className="text-[12px] leading-none text-[#d0d0d0]">×</Text>
                            </Pressable>
                            <Pressable
                              className="ml-1 rounded-md"
                              style={iconButtonStyle}
                              onPress={() => void removeMindmap(mindmap.id)}
                              aria-disabled={!deleteMatches || deleteSubmittingMindmapId === mindmap.id}
                            >
                              <Text
                                className={`text-[11px] font-semibold leading-none ${
                                  deleteMatches && deleteSubmittingMindmapId !== mindmap.id ? "text-[#ffb0b0]" : "text-[#6a6a6a]"
                                }`}
                              >
                                Del
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            </Modal>
          ) : null}

          {brainstormMenuOpen && brainstormMenuAnchor ? (
            <Modal transparent visible={brainstormMenuOpen} animationType="fade" onRequestClose={closeBrainstormMenu}>
              <Pressable className="fixed inset-0 z-[998]" onPress={closeBrainstormMenu} />
              <View className="fixed z-[1000] w-[360px] rounded-xl bg-[#171717] p-2" style={{ left: brainstormMenuAnchor.left, top: brainstormMenuAnchor.top }}>
                <View className="mb-2 border-b border-[#262626] px-2 pb-2 pt-1" style={rowStyle}>
                  <View className="min-w-0 flex flex-1 gap-2" style={rowStyle}>
                    <Text className="text-[#a0a0a0] text-xs">All sessions</Text>
                    <Pressable
                      className="rounded-md"
                      style={plusButtonStyle}
                      onPress={(event: any) => {
                        event?.stopPropagation?.();
                        setIsCreatingBrainstorm(true);
                        setNewBrainstormName("New Brainstorm");
                      }}
                    >
                      <Text className="text-[#d8d8d8] text-[16px] leading-none">+</Text>
                    </Pressable>
                  </View>
                </View>
                <View className="max-h-[260px] overflow-y-auto">
                  {isCreatingBrainstorm ? (
                    <View className="mb-2 rounded-lg border border-[#2a2a2a] bg-[#1b1b1b] px-2 py-2" style={rowStyle}>
                      <TextInput
                        autoFocus
                        value={newBrainstormName}
                        onChangeText={setNewBrainstormName}
                        onKeyDown={(event: any) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void submitCreateBrainstorm();
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setIsCreatingBrainstorm(false);
                          }
                        }}
                        className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[13px] text-[#e5e5e5] outline-none"
                      />
                      <View className="ml-1" style={rowStyle}>
                        <Pressable className="rounded-md hover:bg-[#2b2b2b]" style={iconButtonStyle} onPress={() => void submitCreateBrainstorm()}>
                          <Text className="text-[14px] leading-none text-[#d8d8d8]">✓</Text>
                        </Pressable>
                        <Pressable
                          className="rounded-md hover:bg-[#2b2b2b]"
                          style={iconButtonStyle}
                          onPress={() => {
                            setIsCreatingBrainstorm(false);
                            setNewBrainstormName("New Brainstorm");
                          }}
                        >
                          <Text className="text-[14px] leading-none text-[#d8d8d8]">×</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}

                  {brainstorms.length === 0 ? (
                    <View className="px-3 py-2">
                      <Text className="text-[13px] text-[#8f8f8f]">No brainstorm sessions yet.</Text>
                    </View>
                  ) : null}

                  {brainstorms.map((bs) => {
                    const isActive = selectedBrainstormId === bs.id;
                    const isDeleteOpen = deleteCandidateBrainstormId === bs.id;
                    const deleteMatches = deleteBrainstormInput.trim() === bs.name.trim();
                    return (
                      <View
                        key={bs.id}
                        className={`rounded-lg px-3 py-2 ${isActive ? "bg-[#242424]" : "bg-transparent hover:bg-[#1f1f1f]"}`}
                      >
                        <Pressable
                          onPress={() => {
                            setSelectedBrainstormId(bs.id);
                            writeStoredActiveBrainstorm(selectedWorkspaceId, bs.id);
                            dispatchBrainstormSelectView(bs.id, bs.name);
                            closeBrainstormMenu();
                          }}
                        >
                          <View style={itemRowStyle}>
                            <View style={itemNameWrapStyle}>
                              <Text
                                as="div"
                                className={`${isActive ? "text-white" : "text-[#d9d9d9]"} text-[14px]`}
                                style={{ lineHeight: "28px" }}
                                numberOfLines={1}
                              >
                                {bs.name}
                              </Text>
                            </View>
                            <View className="shrink-0" style={itemActionsStyle}>
                              <Pressable
                                className="rounded-md hover:bg-[#2b2b2b]"
                                style={iconButtonStyle}
                                onPress={(event: any) => {
                                  event?.stopPropagation?.();
                                }}
                              >
                                <Icon name="settings" size={13} color="#d8d8d8" />
                              </Pressable>
                              <Pressable
                                className="rounded-md hover:bg-[#2b2b2b]"
                                style={iconButtonStyle}
                                onPress={(event: any) => {
                                  event?.stopPropagation?.();
                                  if (isDeleteOpen) {
                                    cancelBrainstormDeleteIntent();
                                  } else {
                                    setDeleteCandidateBrainstormId(bs.id);
                                    setDeleteBrainstormInput("");
                                  }
                                }}
                              >
                                <Icon name="trash-2" size={13} color="#ffb0b0" />
                              </Pressable>
                            </View>
                          </View>
                        </Pressable>

                        <View
                          style={{
                            ...deleteRevealBaseStyle,
                            maxHeight: isDeleteOpen ? 116 : 0,
                            opacity: isDeleteOpen ? 1 : 0,
                            transform: isDeleteOpen ? "translateY(0)" : "translateY(-4px)",
                            marginTop: isDeleteOpen ? 8 : 0,
                          }}
                        >
                          <Text className="text-[11px] text-[#9a9a9a]">
                            Retype <Text className="font-semibold text-[#d9d9d9]">{bs.name}</Text> to delete this session.
                          </Text>
                          <View className="mt-2" style={rowStyle}>
                            <TextInput
                              value={deleteBrainstormInput}
                              onChangeText={setDeleteBrainstormInput}
                              onKeyDown={(event: any) => {
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  cancelBrainstormDeleteIntent();
                                }
                                if (event.key === "Enter" && deleteMatches && deleteSubmittingBrainstormId !== bs.id) {
                                  event.preventDefault();
                                  void removeBrainstorm(bs.id);
                                }
                              }}
                              placeholder={bs.name}
                              className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[12px] text-[#e5e5e5] outline-none"
                            />
                            <Pressable className="ml-1 rounded-md hover:bg-[#2b2b2b]" style={iconButtonStyle} onPress={cancelBrainstormDeleteIntent}>
                              <Text className="text-[12px] leading-none text-[#d0d0d0]">×</Text>
                            </Pressable>
                            <Pressable
                              className="ml-1 rounded-md"
                              style={iconButtonStyle}
                              onPress={() => void removeBrainstorm(bs.id)}
                              aria-disabled={!deleteMatches || deleteSubmittingBrainstormId === bs.id}
                            >
                              <Text
                                className={`text-[11px] font-semibold leading-none ${
                                  deleteMatches && deleteSubmittingBrainstormId !== bs.id ? "text-[#ffb0b0]" : "text-[#6a6a6a]"
                                }`}
                              >
                                Del
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            </Modal>
          ) : null}

          <View className="min-w-[120px] flex flex-row items-center justify-end gap-2">
            <Pressable className="flex h-8 w-8 items-center justify-center rounded-md bg-transparent hover:bg-[#151515]" onPress={() => {}}>
              <Icon name="search" size={14} color="#9a9a9a" />
            </Pressable>
            <Pressable className="flex h-8 w-8 items-center justify-center rounded-md bg-transparent hover:bg-[#151515]" onPress={() => {}}>
              <Icon name="clock" size={14} color="#9a9a9a" />
            </Pressable>
            <NotificationCenter />
            <UserMenu avatarDataUrl={avatarDataUrl} profileInitial={derivedInitial} />
          </View>
        </View>
      </View>

      <View className="flex-1 min-h-0 overflow-hidden">
        <Outlet />
      </View>

      <View className="px-5 py-2 bg-[#0C0C0C]">
        <View className="flex flex-row items-center justify-between">
          <Pressable className="flex h-9 w-9 items-center justify-center rounded-none border-0 bg-transparent" onPress={toggleLeftPanel}>
            {currentPanels.left ? (
              <ChevronsLeft size={16} className="text-[#9a9a9a]" />
            ) : (
              <ChevronsRight size={16} className="text-[#9a9a9a]" />
            )}
          </Pressable>
          <Pressable className="flex h-9 w-9 items-center justify-center rounded-none border-0 bg-transparent" onPress={toggleRightPanel}>
            {currentPanels.right ? (
              <ChevronsRight size={16} className="text-[#9a9a9a]" />
            ) : (
              <ChevronsLeft size={16} className="text-[#9a9a9a]" />
            )}
          </Pressable>
        </View>
      </View>

      <WorkspaceSettingsModal visible={workspaceSettingsOpen} onClose={() => setWorkspaceSettingsOpen(false)} />
    </View>
  );
}
