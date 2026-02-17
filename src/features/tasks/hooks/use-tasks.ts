import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { tasksLocalDB } from "../db/local-db";
import { TasksSyncEngine } from "../sync/sync-engine";
import { extractMentionedUserIds } from "../../workspaces/utils/mentions";
import type {
  Task,
  TaskComment,
  TaskPriority,
  TaskProject,
  TasksSyncStatus,
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

const workflowKindRank: Record<TaskWorkflowKind, number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  in_review: 3,
  done: 4,
  canceled: 5,
  custom: 6,
};

function sortStates(states: TaskWorkflowState[]): TaskWorkflowState[] {
  return [...states].sort(
    (a, b) =>
      (workflowKindRank[a.kind] ?? 99) - (workflowKindRank[b.kind] ?? 99) ||
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

function normalizeTask(task: Task): Task {
  return {
    ...task,
    tags: Array.isArray(task.tags) ? task.tags : [],
  };
}

function sortComments(comments: TaskComment[]): TaskComment[] {
  return [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
  selectedProjectId: string | null;
  selectedTaskId: string | null;
  viewMode: TaskViewMode;
  loading: boolean;
  canEdit: boolean;
  syncStatus: TasksSyncStatus;
  setViewMode: (mode: TaskViewMode) => void;
  setSelectedProjectId: (projectId: string | null) => void;
  setSelectedTaskId: (taskId: string | null) => void;
  createProject: (name?: string) => Promise<string | null>;
  createWorkflowState: (projectId: string, name: string, kind?: TaskWorkflowKind) => Promise<string | null>;
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
  syncEngine: TasksSyncEngine | null;
};

type UseTasksParams = {
  userId: string | null;
  workspaceId: string | null;
  modulePermission?: "none" | "view" | "edit" | "admin";
};

export function useTasks(supabase: SupabaseClient | null, params: UseTasksParams): UseTasksState {
  const { userId, workspaceId, modulePermission = "none" } = params;
  const canRead = modulePermission !== "none";
  const canEdit = modulePermission === "edit" || modulePermission === "admin";

  const [projects, setProjects] = useState<TaskProject[]>([]);
  const [states, setStates] = useState<TaskWorkflowState[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<TaskViewMode>("board");
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<TasksSyncStatus>("synced");

  const syncEngine = useMemo(() => {
    if (!supabase || !userId || !workspaceId || !canRead) return null;
    return new TasksSyncEngine(supabase, userId, workspaceId);
  }, [canRead, supabase, userId, workspaceId]);

  const loadLocal = useCallback(async () => {
    if (!workspaceId) return;

    const [projectRows, stateRows, taskRows, commentRows] = await Promise.all([
      tasksLocalDB.projects.where("workspaceId").equals(workspaceId).toArray(),
      tasksLocalDB.states.where("workspaceId").equals(workspaceId).toArray(),
      tasksLocalDB.tasks.where("workspaceId").equals(workspaceId).toArray(),
      tasksLocalDB.comments.where("workspaceId").equals(workspaceId).toArray(),
    ]);

    const nextProjects = sortProjects(projectRows);
    const nextStates = sortStates(stateRows);
    const normalizedTaskRows = taskRows.map((task) => normalizeTask(task as Task));
    const nextTasks = sortTasks(normalizedTaskRows);
    const nextComments = sortComments(commentRows);

    if (normalizedTaskRows.some((task, index) => !Array.isArray((taskRows[index] as Task).tags))) {
      await tasksLocalDB.tasks.bulkPut(normalizedTaskRows);
    }

    setProjects(nextProjects);
    setStates(nextStates);
    setTasks(nextTasks);
    setComments(nextComments);

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
  }, [workspaceId]);

  useEffect(() => {
    if (!syncEngine || !workspaceId || !canRead) {
      setProjects([]);
      setStates([]);
      setTasks([]);
      setComments([]);
      setSelectedProjectId(null);
      setSelectedTaskId(null);
      setLoading(false);
      return;
    }

    let active = true;

    const stopStatus = syncEngine.onStatus(setSyncStatus);
    const stopChange = syncEngine.onChange(() => {
      void loadLocal();
    });

    const run = async () => {
      setLoading(true);
      try {
        await loadLocal();
        await syncEngine.start();
        await loadLocal();
      } finally {
        if (active) setLoading(false);
      }
    };

    void run();

    return () => {
      active = false;
      stopStatus();
      stopChange();
      syncEngine.destroy();
    };
  }, [canRead, loadLocal, syncEngine, workspaceId]);

  const createProject = useCallback(
    async (name = "New Project") => {
      if (!userId || !workspaceId || !syncEngine || !canEdit) return null;

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
        position,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      };

      setProjects((current) => sortProjects([...current, project]));
      setSelectedProjectId(project.id);
      await tasksLocalDB.projects.put(project);
      await syncEngine.enqueue("upsert_project", project);
      return project.id;
    },
    [canEdit, projects, syncEngine, userId, workspaceId]
  );

  const createWorkflowState = useCallback(
    async (projectId: string, name: string, kind: TaskWorkflowKind = "custom") => {
      if (!userId || !workspaceId || !syncEngine || !canEdit) return null;

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
        color: null,
        position: kind === "custom" ? `z${suffix}` : `${kind}-${suffix}`,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        deletedAt: null,
      };

      setStates((current) => sortStates([...current, state]));
      await tasksLocalDB.states.put(state);
      await syncEngine.enqueue("upsert_state", state);
      return state.id;
    },
    [canEdit, states, syncEngine, userId, workspaceId]
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
      if (!userId || !workspaceId || !syncEngine || !canEdit) return null;

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

      setTasks((current) => sortTasks([...current, task]));
      setSelectedTaskId(task.id);
      await tasksLocalDB.tasks.put(task);
      await syncEngine.enqueue("upsert_task", task);
      const mentionedUserIds = extractMentionedUserIds(task.title);
      if (mentionedUserIds.length > 0 && supabase && workspaceId) {
        void supabase.rpc("workspace_emit_mentions", {
          p_workspace_id: workspaceId,
          p_module: "tasks",
          p_resource_type: "task",
          p_resource_id: task.id,
          p_mentioned_user_ids: mentionedUserIds,
          p_payload: { context: "task_title" },
          p_dedupe_seed: `${task.id}:task_title:${Date.now()}`,
        });
      }
      return task.id;
    },
    [canEdit, selectedProjectId, states, supabase, syncEngine, tasks, userId, workspaceId]
  );

  const updateTask = useCallback(
    async (
      taskId: string,
      patch: Partial<Pick<Task, "title" | "description" | "tags" | "priority" | "dueDate" | "stateId" | "parentTaskId" | "assigneeId">>
    ) => {
      if (!syncEngine || !canEdit) return;
      const current = tasks.find((task) => task.id === taskId);
      if (!current) return;

      const updated: Task = normalizeTask({
        ...current,
        ...patch,
        updatedAt: nowIso(),
      });

      setTasks((list) => sortTasks(list.map((task) => (task.id === taskId ? updated : normalizeTask(task)))));
      await tasksLocalDB.tasks.put(updated);
      await syncEngine.enqueue("upsert_task", updated);

      const mentionSource = `${updated.title}\\n${updated.description}`;
      const mentionedUserIds = extractMentionedUserIds(mentionSource);
      if (mentionedUserIds.length > 0 && supabase && workspaceId) {
        void supabase.rpc("workspace_emit_mentions", {
          p_workspace_id: workspaceId,
          p_module: "tasks",
          p_resource_type: "task",
          p_resource_id: updated.id,
          p_mentioned_user_ids: mentionedUserIds,
          p_payload: { context: "task_update" },
          p_dedupe_seed: `${updated.id}:task_update:${Date.now()}`,
        });
      }
    },
    [canEdit, supabase, syncEngine, tasks, workspaceId]
  );

  const moveTask = useCallback(
    async (taskId: string, newParentTaskId: string | null, newStateId: string, beforeTaskId: string | null = null) => {
      if (!syncEngine || !canEdit) return;
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

      const updated: Task = {
        ...task,
        parentTaskId: newParentTaskId,
        stateId: newStateId,
        position,
        updatedAt: nowIso(),
      };

      setTasks((list) => sortTasks(list.map((entry) => (entry.id === taskId ? updated : entry))));
      await tasksLocalDB.tasks.put(updated);
      await syncEngine.enqueue("move_task", {
        taskId,
        newParentTaskId,
        newStateId,
        newPosition: position,
      });
    },
    [canEdit, syncEngine, tasks]
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      if (!syncEngine || !canEdit) return;
      const task = tasks.find((entry) => entry.id === taskId);
      if (!task) return;

      const deletedAt = nowIso();
      const updated = { ...task, deletedAt, updatedAt: deletedAt };
      setTasks((list) => sortTasks(list.map((entry) => (entry.id === taskId ? updated : entry))));
      if (selectedTaskId === taskId) setSelectedTaskId(null);
      await tasksLocalDB.tasks.put(updated);
      await syncEngine.enqueue("delete_task", { taskId, deletedAt });
    },
    [canEdit, selectedTaskId, syncEngine, tasks]
  );

  const addComment = useCallback(
    async (taskId: string, body: string) => {
      if (!userId || !workspaceId || !syncEngine || !canEdit) return null;
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

      setComments((current) => sortComments([...current, comment]));
      await tasksLocalDB.comments.put(comment);
      await syncEngine.enqueue("upsert_comment", comment);
      const mentionedUserIds = extractMentionedUserIds(trimmed);
      if (mentionedUserIds.length > 0 && supabase && workspaceId) {
        void supabase.rpc("workspace_emit_mentions", {
          p_workspace_id: workspaceId,
          p_module: "tasks",
          p_resource_type: "task",
          p_resource_id: taskId,
          p_mentioned_user_ids: mentionedUserIds,
          p_payload: { context: "task_comment", comment_id: comment.id },
          p_dedupe_seed: `${taskId}:task_comment:${comment.id}`,
        });
      }
      return comment.id;
    },
    [canEdit, supabase, syncEngine, userId, workspaceId]
  );

  const deleteComment = useCallback(
    async (commentId: string) => {
      if (!syncEngine || !canEdit) return;
      const comment = comments.find((entry) => entry.id === commentId);
      if (!comment) return;

      const deletedAt = nowIso();
      const updated = { ...comment, deletedAt, updatedAt: deletedAt };
      setComments((list) => sortComments(list.map((entry) => (entry.id === commentId ? updated : entry))));
      await tasksLocalDB.comments.put(updated);
      await syncEngine.enqueue("delete_comment", { commentId, deletedAt });
    },
    [canEdit, comments, syncEngine]
  );

  return {
    currentUserId: userId,
    projects,
    states,
    tasks,
    comments,
    selectedProjectId,
    selectedTaskId,
    viewMode,
    loading,
    canEdit,
    syncStatus,
    setViewMode,
    setSelectedProjectId,
    setSelectedTaskId,
    createProject,
    createWorkflowState,
    createTask,
    updateTask,
    moveTask,
    deleteTask,
    addComment,
    deleteComment,
    syncEngine,
  };
}
