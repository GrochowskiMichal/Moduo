import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import {
  dispatchGridSceneChange,
  readStoredGridActiveScene,
  writeStoredGridActiveScene,
} from "../../features/dashboard/ui/layout-events";
import {
  DEFAULT_GRID_SCENE,
  deleteGridSceneLayout,
  ensureGridSceneLayout,
  listGridScenes,
  readPersistedGridActiveScene,
  saveGridScenes,
  writePersistedGridActiveScene,
  type GridSceneOption,
} from "../../features/dashboard/storage/dashboard-view-storage";
import { NotificationCenter } from "../notification-center";
import { WorkspaceSwitcher } from "../workspace-switcher";
import { WorkspaceSettingsModal } from "../workspace-settings-modal";
import { IntegrationsModal } from "../integrations-modal";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import moduoFavicon from "../../../assets/moduo_favicon.png";
import { UserMenu } from "../user-menu";
import {
  PROFILE_UPDATED_EVENT,
  readStoredAvatar,
} from "../../features/profile/profile-storage";
import { baseModulesNavItems, normalizeTaskProject, nowIso, safeId } from "./app-chrome-constants";
import { AppChromeMenus } from "./app-chrome-menus";
import type { MenuAnchor, TaskProjectOption } from "./app-chrome-types";

export function AppChrome({ profileInitial }: { profileInitial: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const { runtime, userEmail, userId } = useAuth();
  const { loading, modulePermissions, selectedWorkspaceId } = useWorkspace();
  const currentFeature = routeToFeatureLayout(pathname);
  const isGridRoute = pathname === "/" || pathname.startsWith("/grid");
  const isTasksRoute = pathname.startsWith("/tasks") || pathname.startsWith("/ground");
  const isMindmapRoute = pathname.startsWith("/mindmap");
  const isBrainstormRoute = pathname.startsWith("/brainstorm");
  const isEmailRoute = pathname.startsWith("/email");
  const isSettingsRoute = pathname.startsWith("/settings");
  const canEditTasks = modulePermissions.tasks === "edit" || modulePermissions.tasks === "admin";

  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [featurePanels, setFeaturePanels] = useState(() => readPanelsMap());
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [gridScenes, setGridScenes] = useState<GridSceneOption[]>([DEFAULT_GRID_SCENE]);
  const [activeGridSceneId, setActiveGridSceneId] = useState<string>(DEFAULT_GRID_SCENE.id);
  const [gridMenuOpen, setGridMenuOpen] = useState(false);
  const [isCreatingGridScene, setIsCreatingGridScene] = useState(false);
  const [newGridSceneName, setNewGridSceneName] = useState("New Scene");
  const [deleteCandidateGridSceneId, setDeleteCandidateGridSceneId] = useState<string | null>(null);
  const [deleteGridSceneInput, setDeleteGridSceneInput] = useState("");
  const [deleteSubmittingGridSceneId, setDeleteSubmittingGridSceneId] = useState<string | null>(null);
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
  const [gridMenuAnchor, setGridMenuAnchor] = useState<MenuAnchor | null>(null);
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
  const gridControlRef = useRef<HTMLDivElement | null>(null);
  const tasksControlRef = useRef<HTMLDivElement | null>(null);
  const mindmapControlRef = useRef<HTMLDivElement | null>(null);
  const brainstormControlRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!runtime || typeof window === "undefined") return;

    const isMac =
      typeof navigator !== "undefined" &&
      (navigator.platform?.toLowerCase().includes("mac") ||
        navigator.userAgent?.toLowerCase().includes("mac os"));

    const isEditableTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      if ((el as any).isContentEditable) return true;
      const tag = el.tagName?.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select";
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();
      const shouldToggle =
        (isMac && event.metaKey && event.ctrlKey && key === "f") ||
        (!isMac && key === "f11");

      if (!shouldToggle) return;
      event.preventDefault();
      void runtime.window.toggleFullscreen();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [runtime]);

  const modulesNavItems = useMemo(
    () =>
      baseModulesNavItems.filter((tab) => {
        if (tab.module === "notes") return modulePermissions.notes !== "none";
        if (tab.module === "tasks") return modulePermissions.tasks !== "none";
        return true;
      }),
    [modulePermissions.notes, modulePermissions.tasks]
  );

  const activeGridSceneName =
    gridScenes.find((scene) => scene.id === activeGridSceneId)?.name ?? DEFAULT_GRID_SCENE.name;
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
    if (!isSettingsRoute && !modulesNavItems.some((tab) => tab.href === pathname)) {
      void navigate({ to: modulesNavItems[0]?.href ?? "/grid", replace: true });
    }
  }, [isSettingsRoute, navigate, pathname, modulesNavItems]);

  useEffect(() => {
    writePanelsMap(featurePanels);
  }, [featurePanels]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSetPanels = (event: Event) => {
      const detail = (event as CustomEvent<LayoutPanelsApplyDetail>).detail;
      if (!detail?.feature) return;
      setFeaturePanels((current) => {
        const existing = current[detail.feature];
        if (existing && existing.left === detail.left && existing.right === detail.right) return current;
        return {
          ...current,
          [detail.feature]: { left: detail.left, right: detail.right },
        };
      });
    };
    window.addEventListener(LAYOUT_PANELS_SET_EVENT, onSetPanels);
    return () => window.removeEventListener(LAYOUT_PANELS_SET_EVENT, onSetPanels);
  }, []);

  const currentPanels = featurePanels[currentFeature];
  useEffect(() => {
    dispatchLayoutPanelsApply({
      feature: currentFeature,
      left: currentPanels.left,
      right: currentPanels.right,
    });
  }, [currentFeature, currentPanels.left, currentPanels.right]);

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
    setGridMenuOpen(false);
    setTasksMenuOpen(false);
    setMindmapMenuOpen(false);
    setIsCreatingGridScene(false);
    setIsCreatingTaskProject(false);
    setIsCreatingMindmap(false);
    setDeleteCandidateGridSceneId(null);
    setDeleteGridSceneInput("");
    setDeleteSubmittingGridSceneId(null);
    setDeleteCandidateMindmapId(null);
    setDeleteMindmapInput("");
    setDeleteSubmittingMindmapId(null);
    setBrainstormMenuOpen(false);
    setIsCreatingBrainstorm(false);
    setDeleteCandidateBrainstormId(null);
    setDeleteBrainstormInput("");
    setDeleteSubmittingBrainstormId(null);
  }, [pathname, selectedWorkspaceId]);

  const loadGridScenes = useCallback(
    async (preferredSceneId?: string | null) => {
      if (!runtime || !selectedWorkspaceId) {
        setGridScenes([DEFAULT_GRID_SCENE]);
        setActiveGridSceneId(DEFAULT_GRID_SCENE.id);
        return;
      }

      try {
        const scenes = await listGridScenes(runtime, selectedWorkspaceId);
        const storedActive = await readPersistedGridActiveScene(runtime, selectedWorkspaceId);
        setGridScenes(scenes);
        setActiveGridSceneId((current) => {
          const preferred = preferredSceneId ?? storedActive ?? readStoredGridActiveScene(selectedWorkspaceId) ?? current;
          const resolved =
            (preferred && scenes.some((scene) => scene.id === preferred) ? preferred : null) ?? scenes[0]?.id ?? DEFAULT_GRID_SCENE.id;
          writeStoredGridActiveScene(selectedWorkspaceId, resolved);
          dispatchGridSceneChange(resolved, scenes.find((scene) => scene.id === resolved)?.name);
          void writePersistedGridActiveScene(runtime, selectedWorkspaceId, resolved).catch(console.error);
          return resolved;
        });
      } catch (error) {
        console.error(error);
        setGridScenes([DEFAULT_GRID_SCENE]);
        setActiveGridSceneId(DEFAULT_GRID_SCENE.id);
      }
    },
    [runtime, selectedWorkspaceId]
  );

  useEffect(() => {
    void loadGridScenes();
  }, [loadGridScenes]);

  const setActiveGridScene = useCallback(
    (sceneId: string) => {
      const scene = gridScenes.find((entry) => entry.id === sceneId);
      if (!scene || !runtime || !selectedWorkspaceId) return;
      setActiveGridSceneId(sceneId);
      writeStoredGridActiveScene(selectedWorkspaceId, sceneId);
      dispatchGridSceneChange(sceneId, scene.name);
      void writePersistedGridActiveScene(runtime, selectedWorkspaceId, sceneId).catch(console.error);
    },
    [gridScenes, runtime, selectedWorkspaceId]
  );

  const closeGridMenu = useCallback(() => {
    setGridMenuOpen(false);
    setIsCreatingGridScene(false);
    setNewGridSceneName("New Scene");
    setDeleteCandidateGridSceneId(null);
    setDeleteGridSceneInput("");
    setDeleteSubmittingGridSceneId(null);
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

  const submitCreateGridScene = useCallback(async () => {
    if (!runtime || !selectedWorkspaceId) return;
    const name = newGridSceneName.trim() || "New Scene";
    const nextScene = { id: safeId(), name };
    const nextScenes = [...gridScenes, nextScene];
    try {
      await saveGridScenes(runtime, selectedWorkspaceId, nextScenes);
      await ensureGridSceneLayout(runtime, selectedWorkspaceId, nextScene.id);
      await writePersistedGridActiveScene(runtime, selectedWorkspaceId, nextScene.id);
      setGridScenes(nextScenes);
      setActiveGridSceneId(nextScene.id);
      writeStoredGridActiveScene(selectedWorkspaceId, nextScene.id);
      dispatchGridSceneChange(nextScene.id, nextScene.name);
      closeGridMenu();
    } catch (error) {
      console.error(error);
    }
  }, [closeGridMenu, gridScenes, newGridSceneName, runtime, selectedWorkspaceId]);

  const removeGridScene = useCallback(
    async (sceneId: string) => {
      if (!runtime || !selectedWorkspaceId) return;
      if (gridScenes.length <= 1) return;
      const target = gridScenes.find((scene) => scene.id === sceneId);
      if (!target) return;
      if (deleteCandidateGridSceneId !== sceneId) return;
      if (deleteGridSceneInput.trim() !== target.name.trim()) return;
      if (deleteSubmittingGridSceneId === sceneId) return;
      setDeleteSubmittingGridSceneId(sceneId);
      try {
        const nextScenes = gridScenes.filter((scene) => scene.id !== sceneId);
        await saveGridScenes(runtime, selectedWorkspaceId, nextScenes);
        await deleteGridSceneLayout(runtime, selectedWorkspaceId, sceneId);
        setGridScenes(nextScenes);
        if (activeGridSceneId === sceneId) {
          const fallback = nextScenes[0]?.id ?? DEFAULT_GRID_SCENE.id;
          setActiveGridScene(fallback);
        }
        closeGridMenu();
      } finally {
        setDeleteSubmittingGridSceneId(null);
      }
    },
    [
      activeGridSceneId,
      closeGridMenu,
      gridScenes,
      deleteCandidateGridSceneId,
      deleteGridSceneInput,
      deleteSubmittingGridSceneId,
      runtime,
      selectedWorkspaceId,
      setActiveGridScene,
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

  const updateGridMenuAnchor = useCallback(() => {
    if (typeof window === "undefined") return;
    const rect = gridControlRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - 372));
    setGridMenuAnchor({ left, top: rect.bottom + 8 });
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

  const toggleGridMenu = useCallback(() => {
    closeTasksMenu();
    closeMindmapMenu();
    closeBrainstormMenu();
    if (gridMenuOpen) {
      closeGridMenu();
      return;
    }
    updateGridMenuAnchor();
    setGridMenuOpen(true);
  }, [closeBrainstormMenu, closeGridMenu, closeMindmapMenu, closeTasksMenu, gridMenuOpen, updateGridMenuAnchor]);

  const toggleTasksMenu = useCallback(() => {
    closeGridMenu();
    closeMindmapMenu();
    closeBrainstormMenu();
    if (tasksMenuOpen) {
      closeTasksMenu();
      return;
    }
    updateTasksMenuAnchor();
    setTasksMenuOpen(true);
  }, [closeBrainstormMenu, closeGridMenu, closeMindmapMenu, closeTasksMenu, tasksMenuOpen, updateTasksMenuAnchor]);

  const toggleMindmapMenu = useCallback(() => {
    closeGridMenu();
    closeTasksMenu();
    closeBrainstormMenu();
    if (mindmapMenuOpen) {
      closeMindmapMenu();
      return;
    }
    updateMindmapMenuAnchor();
    setMindmapMenuOpen(true);
  }, [closeBrainstormMenu, closeGridMenu, closeMindmapMenu, closeTasksMenu, mindmapMenuOpen, updateMindmapMenuAnchor]);

  const toggleBrainstormMenu = useCallback(() => {
    closeGridMenu();
    closeTasksMenu();
    closeMindmapMenu();
    if (brainstormMenuOpen) {
      closeBrainstormMenu();
      return;
    }
    updateBrainstormMenuAnchor();
    setBrainstormMenuOpen(true);
  }, [closeBrainstormMenu, closeGridMenu, closeMindmapMenu, closeTasksMenu, brainstormMenuOpen, updateBrainstormMenuAnchor]);

  useEffect(() => {
    if (typeof window === "undefined" || (!gridMenuOpen && !tasksMenuOpen && !mindmapMenuOpen && !brainstormMenuOpen)) return;
    const onReposition = () => {
      if (gridMenuOpen) updateGridMenuAnchor();
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
  }, [brainstormMenuOpen, gridMenuOpen, mindmapMenuOpen, tasksMenuOpen, updateBrainstormMenuAnchor, updateGridMenuAnchor, updateMindmapMenuAnchor, updateTasksMenuAnchor]);

  const setPanelsForFeature = useCallback((feature: FeatureLayoutKey, left: boolean, right: boolean) => {
    setFeaturePanels((current) => {
      const existing = current[feature];
      if (existing && existing.left === left && existing.right === right) return current;
      return {
        ...current,
        [feature]: { left, right },
      };
    });
  }, []);

  useEffect(() => {
    if (currentFeature !== "settings") return;
    setPanelsForFeature("settings", true, false);
  }, [currentFeature, setPanelsForFeature]);

  if (loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-muted-foreground text-sm">Loading workspace...</Text>
      </View>
    );
  }

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
  const moduleNavLeadStyle = currentPanels.left
    ? {
        width: currentPanels.right
          ? "calc((100vw - 64px) * 0.2)"
          : "calc((100vw - 48px) * 0.2)",
        minWidth: 0,
      }
    : undefined;

  return (
    <View className="flex h-screen min-h-screen flex-col overflow-hidden bg-background">
      <View
        className="relative px-5 pt-4 pb-2 bg-card border-b border-border"
        style={{ zIndex: "var(--z-header)" }}
      >
        <View className="relative z-[1] flex flex-row items-center justify-between gap-3">
          <View className={`${currentPanels.left ? "min-w-0" : "min-w-[260px]"} flex flex-row items-center gap-3`} style={moduleNavLeadStyle}>
            <Image source={moduoFavicon} className="h-8 w-8 shrink-0" contentFit="contain" />
            <WorkspaceSwitcher onOpenSettings={() => setWorkspaceSettingsOpen(true)} />
          </View>

          <View className="min-w-0 flex-1 overflow-x-auto overflow-y-visible">
            <View className="flex min-w-max flex-row items-center gap-2 pr-2">
              {modulesNavItems.map((tab) => {
                const active = pathname === tab.href || (tab.href !== "/" && pathname.startsWith(tab.href));
                const isGridTab = tab.href === "/grid";
                const isMindmapTab = tab.href === "/mindmap";
                const isBrainstormTab = tab.href === "/brainstorm";
                return (
                  <View key={tab.href} className="relative flex flex-row items-center">
                    <Pressable
                      className={`flex flex-row items-center gap-2 rounded-md px-3 py-2 ${active ? "bg-accent text-foreground" : "bg-transparent text-muted-foreground hover:bg-accent/60"}`}
                      onPress={() => void navigate({ to: tab.href })}
                    >
                      <Icon name={tab.iconName} size={14} />
                      <Text className="text-sm">{tab.label}</Text>
                    </Pressable>

                    {isGridTab && isGridRoute ? (
                      <View ref={gridControlRef} className="relative ml-1 overflow-visible shrink-0" style={{ zIndex: "var(--z-sticky)" }}>
                        <Pressable className="flex h-8 flex-row items-center gap-2 rounded-md bg-popover px-3 hover:bg-accent" onPress={toggleGridMenu}>
                          <Text className="text-sm text-foreground">{activeGridSceneName}</Text>
                          <Text className="text-xs text-muted-foreground">▾</Text>
                        </Pressable>
                      </View>
                    ) : null}

                    {isMindmapTab && isMindmapRoute ? (
                      <View ref={mindmapControlRef} className="relative ml-1 overflow-visible shrink-0" style={{ zIndex: "var(--z-sticky)" }}>
                        <Pressable className="flex h-8 flex-row items-center gap-2 rounded-md bg-popover px-3 hover:bg-accent" onPress={toggleMindmapMenu}>
                          <Text className="text-sm text-foreground">{selectedMindmapLabel}</Text>
                          <Text className="text-xs text-muted-foreground">▾</Text>
                        </Pressable>
                      </View>
                    ) : null}

                    {isBrainstormTab && isBrainstormRoute ? (
                      <View ref={brainstormControlRef} className="relative ml-1 overflow-visible shrink-0" style={{ zIndex: "var(--z-sticky)" }}>
                        <Pressable className="flex h-8 flex-row items-center gap-2 rounded-md bg-popover px-3 hover:bg-accent" onPress={toggleBrainstormMenu}>
                          <Text className="text-sm text-foreground">{selectedBrainstormLabel}</Text>
                          <Text className="text-xs text-muted-foreground">▾</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>

          <AppChromeMenus
            grid={{
              open: gridMenuOpen,
              anchor: gridMenuAnchor,
              scenes: gridScenes,
              activeSceneId: activeGridSceneId,
              isCreating: isCreatingGridScene,
              newName: newGridSceneName,
              deleteCandidateId: deleteCandidateGridSceneId,
              deleteInput: deleteGridSceneInput,
              deleteSubmittingId: deleteSubmittingGridSceneId,
              closeMenu: closeGridMenu,
              setActiveScene: setActiveGridScene,
              setIsCreating: setIsCreatingGridScene,
              setNewName: setNewGridSceneName,
              submitCreate: submitCreateGridScene,
              removeScene: (sceneId) => {
                void removeGridScene(sceneId);
              },
              setDeleteCandidateId: setDeleteCandidateGridSceneId,
              setDeleteInput: setDeleteGridSceneInput,
              setDeleteSubmittingId: setDeleteSubmittingGridSceneId,
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
            <Tooltip>
              <TooltipTrigger
                className="flex h-8 w-8 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                aria-label="Search"
              >
                <Icon name="search" size={14} />
              </TooltipTrigger>
              <TooltipContent>Search</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                className="flex h-8 w-8 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                aria-label="Recent activity"
              >
                <Icon name="clock" size={14} />
              </TooltipTrigger>
              <TooltipContent>Recent activity</TooltipContent>
            </Tooltip>
            <NotificationCenter />
            <UserMenu
              avatarDataUrl={avatarDataUrl}
              profileInitial={derivedInitial}
              onOpenSettings={() => {
                void navigate({ to: "/settings" });
              }}
              onOpenIntegrations={() => { void navigate({ to: "/settings", search: { section: "integrations" } }); }}
            />
          </View>
        </View>
      </View>

      <View className="flex-1 min-h-0 overflow-hidden">
        <Outlet />
      </View>

      <View className="px-5 py-2 bg-background">
        <View className="flex flex-row items-center justify-between">
          <Tooltip>
            <TooltipTrigger
              className="flex h-9 w-9 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                onClick={toggleLeftPanel}
              aria-label={currentPanels.left ? "Collapse left panel" : "Expand left panel"}
            >
              {currentPanels.left ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
            </TooltipTrigger>
            <TooltipContent>{currentPanels.left ? "Collapse left panel" : "Expand left panel"}</TooltipContent>
          </Tooltip>
          {!isSettingsRoute ? (
            <Tooltip>
              <TooltipTrigger
                className="flex h-9 w-9 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                onClick={toggleRightPanel}
                aria-label={currentPanels.right ? "Collapse right panel" : "Expand right panel"}
              >
                {currentPanels.right ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
              </TooltipTrigger>
              <TooltipContent>{currentPanels.right ? "Collapse right panel" : "Expand right panel"}</TooltipContent>
            </Tooltip>
          ) : (
            <View className="h-9 w-9" />
          )}
        </View>
      </View>

      <WorkspaceSettingsModal visible={workspaceSettingsOpen} onClose={() => setWorkspaceSettingsOpen(false)} />
      <IntegrationsModal visible={integrationsOpen} onClose={() => setIntegrationsOpen(false)} />
    </View>
  );
}
