import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModuoRuntime } from "../../../lib/runtime";
import type {
  Task,
  TaskActivity,
  TaskComment,
  ProjectLabel,
  TaskPriority,
  TaskProject,
  TaskViewMode,
  TaskWorkflowKind,
  TaskWorkflowState,
} from "../types";
import { generatePosition, initialPosition } from "../../notes/utils/position";

function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sortByPosition<T extends { position: string }>(a: T, b: T): number {
  return a.position.localeCompare(b.position);
}

function sortProjects(projects: TaskProject[]): TaskProject[] {
  return [...projects].sort((a, b) => sortByPosition(a, b) || a.name.localeCompare(b.name));
}

function sortStates(states: TaskWorkflowState[]): TaskWorkflowState[] {
  return [...states].sort(
    (a, b) =>
      a.position.localeCompare(b.position) ||
      a.name.localeCompare(b.name)
  );
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      (a.parentTaskId ?? "").localeCompare(b.parentTaskId ?? "") ||
      a.position.localeCompare(b.position) ||
      a.title.localeCompare(b.title)
  );
}

function sortComments(comments: TaskComment[]): TaskComment[] {
  return [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function sortActivities(activities: TaskActivity[]): TaskActivity[] {
  return [...activities].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function normalizeTask(task: any): Task {
  return {
    id: task.id,
    workspaceId: task.workspaceId ?? task.workspace_id,
    ownerId: task.ownerId ?? task.owner_id,
    projectId: task.projectId ?? task.project_id,
    taskCode: task.taskCode ?? task.task_code ?? null,
    parentTaskId: task.parentTaskId ?? task.parent_task_id ?? null,
    stateId: task.stateId ?? task.state_id,
    assigneeId: task.assigneeId ?? task.assignee_id ?? null,
    title: task.title ?? "New Task",
    description: task.description ?? "",
    tags: Array.isArray(task.tags) ? task.tags : [],
    priority: Math.max(0, Math.min(4, Number(task.priority ?? 2))) as TaskPriority,
    dueDate: task.dueDate ?? task.due_date ?? null,
    position: task.position ?? initialPosition(),
    createdAt: task.createdAt ?? task.created_at ?? nowIso(),
    updatedAt: task.updatedAt ?? task.updated_at ?? nowIso(),
    deletedAt: task.deletedAt ?? task.deleted_at ?? null,
  };
}

function normalizeProject(project: any): TaskProject {
  const labels = Array.isArray(project.labels)
    ? project.labels
        .map((label: any): ProjectLabel | null => {
          const name = String(label?.name ?? "").trim();
          const color = String(label?.color ?? "").trim();
          if (!name) return null;
          return { name, color };
        })
        .filter((entry: ProjectLabel | null): entry is ProjectLabel => !!entry)
    : [];
  return {
    id: project.id,
    workspaceId: project.workspaceId ?? project.workspace_id,
    ownerId: project.ownerId ?? project.owner_id,
    name: project.name ?? "New Project",
    description: project.description ?? "",
    logoUrl: project.logoUrl ?? project.logo_url ?? null,
    labels,
    position: project.position ?? initialPosition(),
    createdAt: project.createdAt ?? project.created_at ?? nowIso(),
    updatedAt: project.updatedAt ?? project.updated_at ?? nowIso(),
    deletedAt: project.deletedAt ?? project.deleted_at ?? null,
  };
}

function normalizeState(state: any): TaskWorkflowState {
  return {
    id: state.id,
    workspaceId: state.workspaceId ?? state.workspace_id,
    ownerId: state.ownerId ?? state.owner_id,
    projectId: state.projectId ?? state.project_id,
    name: state.name ?? "State",
    kind: (state.kind ?? "custom") as TaskWorkflowKind,
    icon: state.icon ?? null,
    color: state.color ?? null,
    position: state.position ?? initialPosition(),
    createdAt: state.createdAt ?? state.created_at ?? nowIso(),
    updatedAt: state.updatedAt ?? state.updated_at ?? nowIso(),
    deletedAt: state.deletedAt ?? state.deleted_at ?? null,
  };
}

function normalizeComment(comment: any): TaskComment {
  return {
    id: comment.id,
    workspaceId: comment.workspaceId ?? comment.workspace_id,
    ownerId: comment.ownerId ?? comment.owner_id,
    taskId: comment.taskId ?? comment.task_id,
    body: comment.body ?? "",
    createdAt: comment.createdAt ?? comment.created_at ?? nowIso(),
    updatedAt: comment.updatedAt ?? comment.updated_at ?? nowIso(),
    deletedAt: comment.deletedAt ?? comment.deleted_at ?? null,
  };
}

function normalizeActivity(activity: any): TaskActivity {
  return {
    id: activity.id,
    workspaceId: activity.workspaceId ?? activity.workspace_id,
    taskId: activity.taskId ?? activity.task_id,
    actorUserId: activity.actorUserId ?? activity.actor_user_id,
    action: String(activity.action ?? ""),
    payload: activity.payload ?? {},
    createdAt: activity.createdAt ?? activity.created_at ?? nowIso(),
  };
}

function defaultWorkflowStateName(kind: TaskWorkflowKind): string {
  if (kind === "in_progress") return "In Progress";
  if (kind === "in_review") return "In Review";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export type UseTasksState = {
  currentUserId: string | null;
  projects: TaskProject[];
  states: TaskWorkflowState[];
  tasks: Task[];
  comments: TaskComment[];
  activities: TaskActivity[];
  selectedProjectId: string | null;
  selectedTaskId: string | null;
  viewMode: TaskViewMode;
  loading: boolean;
  canEdit: boolean;
  setViewMode: (mode: TaskViewMode) => void;
  setSelectedProjectId: (projectId: string | null) => void;
  setSelectedTaskId: (taskId: string | null) => void;
  createProject: (name?: string) => Promise<string | null>;
  updateProject: (projectId: string, patch: Partial<Pick<TaskProject, "name" | "description" | "logoUrl" | "labels">>) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  createWorkflowState: (
    projectId: string,
    name: string,
    kind?: TaskWorkflowKind,
    color?: string | null,
    icon?: string | null
  ) => Promise<string | null>;
  createTask: (args?: {
    projectId?: string | null;
    parentTaskId?: string | null;
    stateId?: string | null;
    title?: string;
    description?: string;
    tags?: string[];
    priority?: TaskPriority;
    dueDate?: string | null;
    assigneeId?: string | null;
  }) => Promise<string | null>;
  updateWorkflowState: (stateId: string, patch: Partial<TaskWorkflowState>) => Promise<void>;
  deleteWorkflowState: (stateId: string) => Promise<void>;
  updateTask: (taskId: string, patch: Partial<Pick<Task, "title" | "description" | "tags" | "priority" | "dueDate" | "stateId" | "parentTaskId" | "assigneeId">>) => Promise<void>;
  moveTask: (
    taskId: string,
    newParentTaskId: string | null,
    newStateId: string,
    beforeTaskId?: string | null
  ) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  addComment: (taskId: string, body: string) => Promise<string | null>;
  deleteComment: (commentId: string) => Promise<void>;
  syncEngine: null;
};

type UseTasksParams = {
  userId: string | null;
  workspaceId: string | null;
  modulePermission?: "none" | "view" | "edit" | "admin";
};

export function useTasks(runtime: ModuoRuntime | null, params: UseTasksParams): UseTasksState {
  const { userId, workspaceId, modulePermission = "none" } = params;
  const canRead = modulePermission !== "none";
  const canEdit = modulePermission === "edit" || modulePermission === "admin";

  const [projects, setProjects] = useState<TaskProject[]>([]);
  const [states, setStates] = useState<TaskWorkflowState[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [activities, setActivities] = useState<TaskActivity[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<TaskViewMode>("board");
  const [loading, setLoading] = useState(true);

  const loadBundle = useCallback(async () => {
    if (!runtime || !workspaceId) return;
    const bundle = await runtime.tasks.list(workspaceId);

    const nextProjects = sortProjects((bundle.projects ?? []).map(normalizeProject));
    const nextStates = sortStates((bundle.states ?? []).map(normalizeState));
    const nextTasks = sortTasks((bundle.tasks ?? []).map(normalizeTask));
    const nextComments = sortComments((bundle.comments ?? []).map(normalizeComment));
    const nextActivities = sortActivities((bundle.activities ?? []).map(normalizeActivity));

    setProjects(nextProjects);
    setStates(nextStates);
    setTasks(nextTasks);
    setComments(nextComments);
    setActivities(nextActivities);

    setSelectedProjectId((current) => {
      const activeProjects = nextProjects.filter((project) => !project.deletedAt);
      if (!activeProjects.length) return null;
      if (current && activeProjects.some((project) => project.id === current)) return current;
      return activeProjects[0].id;
    });

    setSelectedTaskId((current) => {
      const activeTasks = nextTasks.filter((task) => !task.deletedAt);
      if (!activeTasks.length) return null;
      if (current && activeTasks.some((task) => task.id === current)) return current;
      return activeTasks[0].id;
    });
  }, [runtime, workspaceId]);

  useEffect(() => {
    if (!runtime || !workspaceId || !canRead) {
      setProjects([]);
      setStates([]);
      setTasks([]);
      setComments([]);
      setActivities([]);
      setSelectedProjectId(null);
      setSelectedTaskId(null);
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

    return () => {
      active = false;
    };
  }, [canRead, loadBundle, runtime, workspaceId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onRefresh = () => {
      void loadBundle();
    };
    window.addEventListener("moduo:data-refresh", onRefresh);
    return () => {
      window.removeEventListener("moduo:data-refresh", onRefresh);
    };
  }, [loadBundle]);

  const createProject = useCallback(
    async (name = "New Project") => {
      if (!userId || !workspaceId || !runtime || !canEdit) return null;

      const visibleProjects = projects.filter((project) => !project.deletedAt).sort(sortByPosition);
      const position = visibleProjects.length
        ? generatePosition(visibleProjects[visibleProjects.length - 1]?.position ?? null, null)
        : initialPosition();

      const timestamp = nowIso();
      const project: TaskProject = {
        id: safeId(),
        workspaceId,
        ownerId: userId,
        name,
        description: "",
        logoUrl: null,
        labels: [],
        position,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      };

      const saved = normalizeProject(await runtime.tasks.upsertProject(project));
      const stateBase = {
        workspaceId,
        ownerId: userId,
        projectId: saved.id,
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
      setSelectedProjectId(saved.id);
      await loadBundle();
      return saved.id;
    },
    [canEdit, loadBundle, projects, runtime, userId, workspaceId]
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      if (!runtime || !canEdit || !workspaceId) return;
      const current = projects.find((project) => project.id === projectId && !project.deletedAt);
      if (!current) return;

      const deletedAt = nowIso();
      const relatedStates = states.filter((state) => state.projectId === projectId && !state.deletedAt);
      const relatedTasks = tasks.filter((task) => task.projectId === projectId && !task.deletedAt);
      const relatedTaskIds = new Set(relatedTasks.map((task) => task.id));
      const relatedComments = comments.filter(
        (comment) => relatedTaskIds.has(comment.taskId) && !comment.deletedAt
      );

      await runtime.tasks.upsertProject({
        ...current,
        updatedAt: deletedAt,
        deletedAt,
      });

      await Promise.all([
        ...relatedStates.map((state) =>
          runtime.tasks.upsertState({
            ...state,
            updatedAt: deletedAt,
            deletedAt,
          })
        ),
        ...relatedTasks.map((task) =>
          runtime.tasks.deleteItem({
            workspaceId,
            taskId: task.id,
            deletedAt,
          })
        ),
        ...relatedComments.map((comment) =>
          runtime.tasks.upsertComment({
            ...comment,
            updatedAt: deletedAt,
            deletedAt,
          })
        ),
      ]);

      if (selectedProjectId === projectId) {
        setSelectedProjectId(null);
      }
      if (selectedTaskId && relatedTaskIds.has(selectedTaskId)) {
        setSelectedTaskId(null);
      }
      await loadBundle();
    },
    [
      canEdit,
      comments,
      loadBundle,
      projects,
      runtime,
      selectedProjectId,
      selectedTaskId,
      states,
      tasks,
      workspaceId,
    ]
  );

  const updateProject = useCallback(
    async (projectId: string, patch: Partial<Pick<TaskProject, "name" | "description" | "logoUrl" | "labels">>) => {
      if (!runtime || !canEdit) return;
      const current = projects.find((project) => project.id === projectId && !project.deletedAt);
      if (!current) return;
      const updated = {
        ...current,
        ...patch,
        updatedAt: nowIso(),
      };
      await runtime.tasks.upsertProject(updated);
      await loadBundle();
    },
    [canEdit, loadBundle, projects, runtime]
  );

  const createWorkflowState = useCallback(
    async (
      projectId: string,
      name: string,
      kind: TaskWorkflowKind = "custom",
      color: string | null = null,
      icon: string | null = null
    ) => {
      if (!userId || !workspaceId || !runtime || !canEdit) return null;

      const projectStates = states
        .filter((state) => state.projectId === projectId && !state.deletedAt)
        .sort(sortByPosition);
      const suffix = `${Math.min(99, projectStates.length + 1)}`.padStart(2, "0");

      const state: TaskWorkflowState = {
        id: safeId(),
        workspaceId,
        ownerId: userId,
        projectId,
        name: name.trim() || defaultWorkflowStateName(kind),
        kind,
        icon,
        color,
        position: kind === "custom" ? `z${suffix}` : `${kind}-${suffix}`,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        deletedAt: null,
      };

      const saved = normalizeState(await runtime.tasks.upsertState(state));
      await loadBundle();
      return saved.id;
    },
    [canEdit, loadBundle, runtime, states, userId, workspaceId]
  );

  const updateWorkflowState = useCallback(
    async (stateId: string, patch: Partial<TaskWorkflowState>) => {
      if (!runtime || !canEdit) return;
      const current = states.find((s) => s.id === stateId);
      if (!current) return;
      const updated = { ...current, ...patch, updatedAt: nowIso() };
      await runtime.tasks.upsertState(updated);
      await loadBundle();
    },
    [canEdit, loadBundle, runtime, states]
  );

  const deleteWorkflowState = useCallback(
    async (stateId: string) => {
      if (!runtime || !canEdit || !workspaceId) return;
      const current = states.find((s) => s.id === stateId);
      if (!current) return;
      const updated = { ...current, deletedAt: nowIso() };
      await runtime.tasks.upsertState(updated);
      await loadBundle();
    },
    [canEdit, loadBundle, runtime, states, workspaceId]
  );

  const createTask = useCallback(
    async (args?: {
      projectId?: string | null;
      parentTaskId?: string | null;
      stateId?: string | null;
      title?: string;
      description?: string;
      tags?: string[];
      priority?: TaskPriority;
      dueDate?: string | null;
      assigneeId?: string | null;
    }) => {
      if (!userId || !workspaceId || !runtime || !canEdit) return null;

      const projectId = args?.projectId ?? selectedProjectId;
      if (!projectId) return null;

      const activeStates = sortStates(states.filter((state) => state.projectId === projectId && !state.deletedAt));
      const stateId = args?.stateId ?? activeStates[0]?.id;
      if (!stateId) return null;

      const parentTaskId = args?.parentTaskId ?? null;
      const siblings = tasks
        .filter(
          (task) =>
            task.projectId === projectId &&
            task.stateId === stateId &&
            task.parentTaskId === parentTaskId &&
            !task.deletedAt
        )
        .sort(sortByPosition);

      const position = siblings.length
        ? generatePosition(siblings[siblings.length - 1]?.position ?? null, null)
        : initialPosition();

      const task: Task = {
        id: safeId(),
        workspaceId,
        ownerId: userId,
        projectId,
        taskCode: null,
        parentTaskId,
        stateId,
        assigneeId: args?.assigneeId ?? userId,
        title: args?.title?.trim() || "New Task",
        description: args?.description?.trim() || "",
        tags: args?.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [],
        priority: Math.max(0, Math.min(4, Number(args?.priority ?? 2))) as TaskPriority,
        dueDate: args?.dueDate ?? null,
        position,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        deletedAt: null,
      };

      const saved = normalizeTask(await runtime.tasks.upsertItem(task));
      setSelectedTaskId(saved.id);
      await loadBundle();
      return saved.id;
    },
    [canEdit, loadBundle, runtime, selectedProjectId, states, tasks, userId, workspaceId]
  );

  const updateTask = useCallback(
    async (
      taskId: string,
      patch: Partial<Pick<Task, "title" | "description" | "tags" | "priority" | "dueDate" | "stateId" | "parentTaskId" | "assigneeId">>
    ) => {
      if (!runtime || !canEdit) return;
      const current = tasks.find((task) => task.id === taskId);
      if (!current) return;

      const updated: Task = {
        ...current,
        ...patch,
        tags: Array.isArray(patch.tags) ? patch.tags : current.tags,
        updatedAt: nowIso(),
      };

      await runtime.tasks.upsertItem(updated);
      await loadBundle();
    },
    [canEdit, loadBundle, runtime, tasks]
  );

  const moveTask = useCallback(
    async (taskId: string, newParentTaskId: string | null, newStateId: string, beforeTaskId: string | null = null) => {
      if (!runtime || !canEdit || !workspaceId) return;
      const task = tasks.find((entry) => entry.id === taskId);
      if (!task) return;

      const siblings = tasks
        .filter(
          (entry) =>
            entry.id !== taskId &&
            entry.projectId === task.projectId &&
            entry.stateId === newStateId &&
            entry.parentTaskId === newParentTaskId &&
            !entry.deletedAt
        )
        .sort(sortByPosition);

      let position = initialPosition();
      if (!beforeTaskId) {
        position = generatePosition(siblings[siblings.length - 1]?.position ?? null, null);
      } else {
        const index = siblings.findIndex((entry) => entry.id === beforeTaskId);
        if (index <= 0) {
          position = generatePosition(null, siblings[0]?.position ?? null);
        } else {
          position = generatePosition(siblings[index - 1]?.position ?? null, siblings[index]?.position ?? null);
        }
      }

      await runtime.tasks.move({
        workspaceId,
        taskId,
        newParentTaskId,
        newStateId,
        newPosition: position,
      });
      await loadBundle();
    },
    [canEdit, loadBundle, runtime, tasks, workspaceId]
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      if (!runtime || !canEdit || !workspaceId) return;
      await runtime.tasks.deleteItem({
        workspaceId,
        taskId,
        deletedAt: nowIso(),
      });
      if (selectedTaskId === taskId) setSelectedTaskId(null);
      await loadBundle();
    },
    [canEdit, loadBundle, runtime, selectedTaskId, workspaceId]
  );

  const addComment = useCallback(
    async (taskId: string, body: string) => {
      if (!userId || !workspaceId || !runtime || !canEdit) return null;
      const trimmed = body.trim();
      if (!trimmed) return null;

      const timestamp = nowIso();
      const comment: TaskComment = {
        id: safeId(),
        workspaceId,
        ownerId: userId,
        taskId,
        body: trimmed,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      };

      const saved = normalizeComment(await runtime.tasks.upsertComment(comment));
      await loadBundle();
      return saved.id;
    },
    [canEdit, loadBundle, runtime, userId, workspaceId]
  );

  const deleteComment = useCallback(
    async (commentId: string) => {
      if (!runtime || !canEdit) return;
      await runtime.tasks.deleteComment(commentId);
      await loadBundle();
    },
    [canEdit, loadBundle, runtime]
  );

  return {
    currentUserId: userId,
    projects,
    states,
    tasks,
    comments,
    activities,
    selectedProjectId,
    selectedTaskId,
    viewMode,
    loading,
    canEdit,
    setViewMode,
    setSelectedProjectId,
    setSelectedTaskId,
    createProject,
    updateProject,
    deleteProject,
    createWorkflowState,
    updateWorkflowState,
    deleteWorkflowState,
    createTask,
    updateTask,
    moveTask,
    deleteTask,
    addComment,
    deleteComment,
    syncEngine: null,
  };
}
