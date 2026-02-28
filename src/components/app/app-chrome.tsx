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
import { Image, Pressable, Text, View } from "../../tw";
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
import { Icon } from "../ui/icon";
import moduoFavicon from "../../../assets/moduo_favicon.png";
import { UserMenu } from "../user-menu";
import {
  PROFILE_UPDATED_EVENT,
  readStoredAvatar,
} from "../../features/profile/profile-storage";
import { baseTabs, normalizeTaskProject, nowIso, safeId } from "./app-chrome-constants";
import { AppChromeMenus } from "./app-chrome-menus";
import type { MenuAnchor, TaskProjectOption } from "./app-chrome-types";

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
  const isSettingsRoute = pathname.startsWith("/settings");
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
    if (!isSettingsRoute && !tabs.some((tab) => tab.href === pathname)) {
      void navigate({ to: tabs[0]?.href ?? "/dashboard", replace: true });
    }
  }, [isSettingsRoute, navigate, pathname, tabs]);

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
      const next = await readStoredAvatar(runtime);
      if (active) setAvatarDataUrl(next);
    };
    void readAvatar();
    const onStorage = () => {
      void readAvatar();
    };
    const onProfileUpdated = () => {
      void readAvatar();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(PROFILE_UPDATED_EVENT, onProfileUpdated);
    return () => {
      active = false;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PROFILE_UPDATED_EVENT, onProfileUpdated);
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
    const onProfileUpdated = () => {
      void load();
    };
    if (typeof window !== "undefined") {
      window.addEventListener(PROFILE_UPDATED_EVENT, onProfileUpdated);
    }
    return () => {
      active = false;
      if (typeof window !== "undefined") {
        window.removeEventListener(PROFILE_UPDATED_EVENT, onProfileUpdated);
      }
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
      logoUrl: null,
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
        icon: "◯",
        color: "#C9CED6",
        position: "todo-01",
      }),
      runtime.tasks.upsertState({
        ...stateBase,
        id: safeId(),
        name: "InProgress",
        kind: "in_progress",
        icon: "◔",
        color: "#F5A524",
        position: "in_progress-02",
      }),
      runtime.tasks.upsertState({
        ...stateBase,
        id: safeId(),
        name: "Done",
        kind: "done",
        icon: "◉",
        color: "#2DD4BF",
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

  useEffect(() => {
    if (currentFeature !== "settings") return;
    setPanelsForFeature("settings", true, false);
  }, [currentFeature, setPanelsForFeature]);

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
  const toggleLeftPanel = () => {
    if (isSettingsRoute) return;
    setPanelsForFeature(currentFeature, !currentPanels.left, currentPanels.right);
  };
  const toggleRightPanel = () => {
    if (isSettingsRoute) return;
    setPanelsForFeature(currentFeature, currentPanels.left, !currentPanels.right);
  };

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

          <AppChromeMenus
            dashboard={{
              open: dashboardMenuOpen,
              anchor: dashboardMenuAnchor,
              views: dashboardViews,
              activeViewId: activeDashboardViewId,
              isCreating: isCreatingDashboardView,
              newName: newDashboardViewName,
              deleteCandidateId: deleteCandidateDashboardViewId,
              deleteInput: deleteDashboardViewInput,
              deleteSubmittingId: deleteSubmittingDashboardViewId,
              closeMenu: closeDashboardMenu,
              setActiveView: setActiveDashboardView,
              setIsCreating: setIsCreatingDashboardView,
              setNewName: setNewDashboardViewName,
              submitCreate: submitCreateDashboardView,
              removeView: (viewId) => {
                void removeDashboardView(viewId);
              },
              setDeleteCandidateId: setDeleteCandidateDashboardViewId,
              setDeleteInput: setDeleteDashboardViewInput,
              setDeleteSubmittingId: setDeleteSubmittingDashboardViewId,
            }}
            tasks={{
              open: tasksMenuOpen,
              anchor: tasksMenuAnchor,
              canEditTasks,
              projects: taskProjects,
              selectedProjectId: selectedTaskProjectId,
              isCreating: isCreatingTaskProject,
              newName: newTaskProjectName,
              deleteCandidateId: deleteCandidateTaskProjectId,
              deleteInput: deleteTaskProjectInput,
              deleteSubmittingId: deleteSubmittingTaskProjectId,
              closeMenu: closeTasksMenu,
              setSelectedProjectId: setSelectedTaskProjectId,
              setIsCreating: setIsCreatingTaskProject,
              setNewName: setNewTaskProjectName,
              submitCreate: submitCreateTaskProject,
              removeProject: removeTaskProject,
              cancelDeleteIntent: cancelTaskProjectDeleteIntent,
              setDeleteCandidateId: setDeleteCandidateTaskProjectId,
              setDeleteInput: setDeleteTaskProjectInput,
            }}
            mindmap={{
              open: mindmapMenuOpen,
              anchor: mindmapMenuAnchor,
              mindmaps,
              selectedMindmapId,
              selectedWorkspaceId,
              isCreating: isCreatingMindmap,
              newName: newMindmapName,
              deleteCandidateId: deleteCandidateMindmapId,
              deleteInput: deleteMindmapInput,
              deleteSubmittingId: deleteSubmittingMindmapId,
              closeMenu: closeMindmapMenu,
              setSelectedMindmapId,
              setIsCreating: setIsCreatingMindmap,
              setNewName: setNewMindmapName,
              submitCreate: submitCreateMindmap,
              removeMindmap,
              cancelDeleteIntent: cancelMindmapDeleteIntent,
              setDeleteCandidateId: setDeleteCandidateMindmapId,
              setDeleteInput: setDeleteMindmapInput,
              writeStoredActiveMindmap,
              dispatchMindmapSelectMap,
            }}
            brainstorm={{
              open: brainstormMenuOpen,
              anchor: brainstormMenuAnchor,
              brainstorms,
              selectedBrainstormId,
              selectedWorkspaceId,
              isCreating: isCreatingBrainstorm,
              newName: newBrainstormName,
              deleteCandidateId: deleteCandidateBrainstormId,
              deleteInput: deleteBrainstormInput,
              deleteSubmittingId: deleteSubmittingBrainstormId,
              closeMenu: closeBrainstormMenu,
              setSelectedBrainstormId,
              setIsCreating: setIsCreatingBrainstorm,
              setNewName: setNewBrainstormName,
              submitCreate: submitCreateBrainstorm,
              removeBrainstorm,
              cancelDeleteIntent: cancelBrainstormDeleteIntent,
              setDeleteCandidateId: setDeleteCandidateBrainstormId,
              setDeleteInput: setDeleteBrainstormInput,
              writeStoredActiveBrainstorm,
              dispatchBrainstormSelectView,
            }}
          />

          <View className="min-w-[120px] flex flex-row items-center justify-end gap-2">
            <Pressable className="flex h-8 w-8 items-center justify-center rounded-md bg-transparent hover:bg-[#151515]" onPress={() => {}}>
              <Icon name="search" size={14} color="#9a9a9a" />
            </Pressable>
            <Pressable className="flex h-8 w-8 items-center justify-center rounded-md bg-transparent hover:bg-[#151515]" onPress={() => {}}>
              <Icon name="clock" size={14} color="#9a9a9a" />
            </Pressable>
            <NotificationCenter />
            <UserMenu
              avatarDataUrl={avatarDataUrl}
              profileInitial={derivedInitial}
              onOpenSettings={() => {
                void navigate({ to: "/settings" });
              }}
            />
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
          {!isSettingsRoute ? (
            <Pressable className="flex h-9 w-9 items-center justify-center rounded-none border-0 bg-transparent" onPress={toggleRightPanel}>
              {currentPanels.right ? (
                <ChevronsRight size={16} className="text-[#9a9a9a]" />
              ) : (
                <ChevronsLeft size={16} className="text-[#9a9a9a]" />
              )}
            </Pressable>
          ) : (
            <View className="h-9 w-9" />
          )}
        </View>
      </View>

      <WorkspaceSettingsModal visible={workspaceSettingsOpen} onClose={() => setWorkspaceSettingsOpen(false)} />
    </View>
  );
}
