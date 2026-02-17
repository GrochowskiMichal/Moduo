import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { tasksLocalDB, getTasksMetaValue, setTasksMetaValue } from "../db/local-db";
import { resolveTaskConflict } from "./conflict";
import { sortOutboxByCreatedAt } from "./outbox";
import type {
  Task,
  TaskComment,
  TaskMovePayload,
  TaskOutboxEntry,
  TaskOutboxOp,
  TaskProject,
  TasksSyncStatus,
  TaskWorkflowState,
} from "../types";

type StatusListener = (status: TasksSyncStatus) => void;
type ChangeListener = () => void;

type RemoteProject = {
  id: string;
  workspace_id: string;
  owner_id: string;
  name: string;
  description: string;
  position: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type RemoteState = {
  id: string;
  workspace_id: string;
  owner_id: string;
  project_id: string;
  name: string;
  kind: TaskWorkflowState["kind"];
  color: string | null;
  position: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type RemoteTask = {
  id: string;
  workspace_id: string;
  owner_id: string;
  project_id: string;
  parent_task_id: string | null;
  state_id: string;
  assignee_id: string | null;
  title: string;
  description: string;
  tags: string[];
  priority: number;
  due_date: string | null;
  position: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type RemoteComment = {
  id: string;
  workspace_id: string;
  owner_id: string;
  task_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

const BOOTSTRAP_LIMIT = 1000;
const MAX_BOOTSTRAP_PAGES = 10;
const RECONCILE_INTERVAL_MS = 15_000;
const FLUSH_DEBOUNCE_MS = 450;

function nowIso(): string {
  return new Date().toISOString();
}

function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mapProject(row: RemoteProject): TaskProject {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toRemoteProject(row: TaskProject): RemoteProject {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    owner_id: row.ownerId,
    name: row.name,
    description: row.description,
    position: row.position,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
  };
}

function mapState(row: RemoteState): TaskWorkflowState {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    name: row.name,
    kind: row.kind,
    color: row.color,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toRemoteState(row: TaskWorkflowState): RemoteState {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    owner_id: row.ownerId,
    project_id: row.projectId,
    name: row.name,
    kind: row.kind,
    color: row.color,
    position: row.position,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
  };
}

function mapTask(row: RemoteTask): Task {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    parentTaskId: row.parent_task_id,
    stateId: row.state_id,
    assigneeId: row.assignee_id,
    title: row.title,
    description: row.description,
    tags: Array.isArray(row.tags) ? row.tags : [],
    priority: Math.max(0, Math.min(4, Number(row.priority ?? 2))) as Task["priority"],
    dueDate: row.due_date,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toRemoteTask(row: Task): RemoteTask {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    owner_id: row.ownerId,
    project_id: row.projectId,
    parent_task_id: row.parentTaskId,
    state_id: row.stateId,
    assignee_id: row.assigneeId,
    title: row.title,
    description: row.description,
    tags: row.tags,
    priority: row.priority,
    due_date: row.dueDate,
    position: row.position,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
  };
}

function mapComment(row: RemoteComment): TaskComment {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerId: row.owner_id,
    taskId: row.task_id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toRemoteComment(row: TaskComment): RemoteComment {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    owner_id: row.ownerId,
    task_id: row.taskId,
    body: row.body,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
  };
}

function cursorKey(scopeKey: string, entity: string): string {
  return `tasks_cursor:${scopeKey}:${entity}`;
}

async function pullProjects(supabase: SupabaseClient, workspaceId: string, scopeKey: string): Promise<boolean> {
  let changed = false;
  let after = await getTasksMetaValue(cursorKey(scopeKey, "projects"));

  for (let page = 0; page < MAX_BOOTSTRAP_PAGES; page += 1) {
    const { data, error } = await supabase.rpc("task_projects_bootstrap", {
      p_workspace_id: workspaceId,
      p_after_updated_at: after,
      p_limit: BOOTSTRAP_LIMIT,
    });
    if (error) throw error;

    const rows = (Array.isArray(data) ? data : []) as RemoteProject[];
    if (!rows.length) break;

    await tasksLocalDB.projects.bulkPut(rows.map(mapProject));
    changed = true;

    const latest = rows[rows.length - 1]?.updated_at;
    if (latest) {
      after = latest;
      await setTasksMetaValue(cursorKey(scopeKey, "projects"), latest);
    }

    if (rows.length < BOOTSTRAP_LIMIT) break;
  }

  return changed;
}

async function pullStates(supabase: SupabaseClient, workspaceId: string, scopeKey: string): Promise<boolean> {
  let changed = false;
  let after = await getTasksMetaValue(cursorKey(scopeKey, "states"));

  for (let page = 0; page < MAX_BOOTSTRAP_PAGES; page += 1) {
    const { data, error } = await supabase.rpc("task_workflow_states_bootstrap", {
      p_workspace_id: workspaceId,
      p_after_updated_at: after,
      p_limit: BOOTSTRAP_LIMIT,
    });
    if (error) throw error;

    const rows = (Array.isArray(data) ? data : []) as RemoteState[];
    if (!rows.length) break;

    await tasksLocalDB.states.bulkPut(rows.map(mapState));
    changed = true;

    const latest = rows[rows.length - 1]?.updated_at;
    if (latest) {
      after = latest;
      await setTasksMetaValue(cursorKey(scopeKey, "states"), latest);
    }

    if (rows.length < BOOTSTRAP_LIMIT) break;
  }

  return changed;
}

async function pullTasks(supabase: SupabaseClient, workspaceId: string, scopeKey: string): Promise<boolean> {
  let changed = false;
  let after = await getTasksMetaValue(cursorKey(scopeKey, "tasks"));

  for (let page = 0; page < MAX_BOOTSTRAP_PAGES; page += 1) {
    const { data, error } = await supabase.rpc("tasks_bootstrap", {
      p_workspace_id: workspaceId,
      p_after_updated_at: after,
      p_limit: BOOTSTRAP_LIMIT,
    });
    if (error) throw error;

    const rows = (Array.isArray(data) ? data : []) as RemoteTask[];
    if (!rows.length) break;

    await tasksLocalDB.tasks.bulkPut(rows.map(mapTask));
    changed = true;

    const latest = rows[rows.length - 1]?.updated_at;
    if (latest) {
      after = latest;
      await setTasksMetaValue(cursorKey(scopeKey, "tasks"), latest);
    }

    if (rows.length < BOOTSTRAP_LIMIT) break;
  }

  return changed;
}

async function pullComments(supabase: SupabaseClient, workspaceId: string, scopeKey: string): Promise<boolean> {
  let changed = false;
  let after = await getTasksMetaValue(cursorKey(scopeKey, "comments"));

  for (let page = 0; page < MAX_BOOTSTRAP_PAGES; page += 1) {
    const { data, error } = await supabase.rpc("task_comments_bootstrap", {
      p_workspace_id: workspaceId,
      p_after_updated_at: after,
      p_limit: BOOTSTRAP_LIMIT,
    });
    if (error) throw error;

    const rows = (Array.isArray(data) ? data : []) as RemoteComment[];
    if (!rows.length) break;

    await tasksLocalDB.comments.bulkPut(rows.map(mapComment));
    changed = true;

    const latest = rows[rows.length - 1]?.updated_at;
    if (latest) {
      after = latest;
      await setTasksMetaValue(cursorKey(scopeKey, "comments"), latest);
    }

    if (rows.length < BOOTSTRAP_LIMIT) break;
  }

  return changed;
}

export class TasksSyncEngine {
  private readonly clientId = safeId();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly changeListeners = new Set<ChangeListener>();
  private onlineHandler?: () => void;
  private offlineHandler?: () => void;
  private isOnline = typeof navigator === "undefined" ? true : navigator.onLine;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private realtimeChannel: RealtimeChannel | null = null;
  private started = false;
  private destroyed = false;
  private reconciling = false;
  private readonly scopeKey: string;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly userId: string,
    private readonly workspaceId: string
  ) {
    this.scopeKey = `${userId}:${workspaceId}`;
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onChange(listener: ChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private emitStatus(status: TasksSyncStatus): void {
    for (const listener of this.statusListeners) listener(status);
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) listener();
  }

  async start(): Promise<void> {
    if (this.started || this.destroyed) return;
    this.started = true;

    if (typeof window !== "undefined") {
      this.onlineHandler = () => {
        this.isOnline = true;
        this.requestSync();
      };
      this.offlineHandler = () => {
        this.isOnline = false;
        this.emitStatus("offline");
      };
      window.addEventListener("online", this.onlineHandler);
      window.addEventListener("offline", this.offlineHandler);
    }

    await this.subscribeRealtime();
    await this.reconcile();

    this.reconcileTimer = setInterval(() => {
      void this.reconcile();
    }, RECONCILE_INTERVAL_MS);
  }

  destroy(): void {
    this.destroyed = true;
    this.started = false;
    if (this.onlineHandler && typeof window !== "undefined") {
      window.removeEventListener("online", this.onlineHandler);
    }
    if (this.offlineHandler && typeof window !== "undefined") {
      window.removeEventListener("offline", this.offlineHandler);
    }
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.realtimeChannel) {
      void this.supabase.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }
  }

  async enqueue(op: TaskOutboxOp, payload: unknown): Promise<void> {
    await tasksLocalDB.outbox.put({
      id: `${this.clientId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      scopeKey: this.scopeKey,
      workspaceId: this.workspaceId,
      ownerId: this.userId,
      op,
      payload,
      createdAt: nowIso(),
    });

    this.requestSync();
  }

  requestSync(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      void this.reconcile();
    }, FLUSH_DEBOUNCE_MS);
  }

  private async subscribeRealtime(): Promise<void> {
    if (this.realtimeChannel || this.destroyed) return;

    const applyRealtime = async (table: "task_projects" | "task_workflow_states" | "tasks" | "task_comments", payload: any) => {
      if (this.destroyed) return;
      const type = payload.eventType as "INSERT" | "UPDATE" | "DELETE";

      if (type === "DELETE") {
        const oldRow = payload.old as { id?: string };
        if (!oldRow?.id) return;
        if (table === "task_projects") await tasksLocalDB.projects.delete(oldRow.id);
        if (table === "task_workflow_states") await tasksLocalDB.states.delete(oldRow.id);
        if (table === "tasks") await tasksLocalDB.tasks.delete(oldRow.id);
        if (table === "task_comments") await tasksLocalDB.comments.delete(oldRow.id);
        this.emitChange();
        return;
      }

      const row = payload.new;
      if (!row) return;

      if (table === "task_projects") await tasksLocalDB.projects.put(mapProject(row as RemoteProject));
      if (table === "task_workflow_states") await tasksLocalDB.states.put(mapState(row as RemoteState));
      if (table === "tasks") {
        const remoteTask = mapTask(row as RemoteTask);
        const currentTask = await tasksLocalDB.tasks.get(remoteTask.id);
        await tasksLocalDB.tasks.put(currentTask ? resolveTaskConflict(currentTask, remoteTask) : remoteTask);
      }
      if (table === "task_comments") await tasksLocalDB.comments.put(mapComment(row as RemoteComment));
      this.emitChange();
    };

    this.realtimeChannel = this.supabase
      .channel(`tasks-sync-${this.workspaceId}-${this.clientId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_projects",
          filter: `workspace_id=eq.${this.workspaceId}`,
        },
        (payload) => {
          void applyRealtime("task_projects", payload);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_workflow_states",
          filter: `workspace_id=eq.${this.workspaceId}`,
        },
        (payload) => {
          void applyRealtime("task_workflow_states", payload);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `workspace_id=eq.${this.workspaceId}`,
        },
        (payload) => {
          void applyRealtime("tasks", payload);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_comments",
          filter: `workspace_id=eq.${this.workspaceId}`,
        },
        (payload) => {
          void applyRealtime("task_comments", payload);
        }
      )
      .subscribe();
  }

  private async applyOutboxEntry(entry: TaskOutboxEntry): Promise<void> {
    switch (entry.op) {
      case "upsert_project": {
        const project = entry.payload as TaskProject;
        const { error } = await this.supabase
          .from("task_projects")
          .upsert(toRemoteProject(project), { onConflict: "id" });
        if (error) throw error;
        return;
      }
      case "upsert_state": {
        const state = entry.payload as TaskWorkflowState;
        const { error } = await this.supabase
          .from("task_workflow_states")
          .upsert(toRemoteState(state), { onConflict: "id" });
        if (error) throw error;
        return;
      }
      case "upsert_task": {
        const task = entry.payload as Task;
        const { error } = await this.supabase
          .from("tasks")
          .upsert(toRemoteTask(task), { onConflict: "id" });
        if (error) throw error;
        return;
      }
      case "delete_task": {
        const payload = entry.payload as { taskId: string; deletedAt: string };
        const { error } = await this.supabase
          .from("tasks")
          .update({ deleted_at: payload.deletedAt })
          .eq("id", payload.taskId)
          .eq("workspace_id", this.workspaceId);
        if (error) throw error;
        return;
      }
      case "move_task": {
        const payload = entry.payload as TaskMovePayload;
        const { error } = await this.supabase.rpc("tasks_move", {
          p_workspace_id: this.workspaceId,
          p_task_id: payload.taskId,
          p_new_parent_task_id: payload.newParentTaskId,
          p_new_state_id: payload.newStateId,
          p_new_position: payload.newPosition,
        });
        if (error) throw error;
        return;
      }
      case "upsert_comment": {
        const comment = entry.payload as TaskComment;
        const { error } = await this.supabase
          .from("task_comments")
          .upsert(toRemoteComment(comment), { onConflict: "id" });
        if (error) throw error;
        return;
      }
      case "delete_comment": {
        const payload = entry.payload as { commentId: string; deletedAt: string };
        const { error } = await this.supabase
          .from("task_comments")
          .update({ deleted_at: payload.deletedAt })
          .eq("id", payload.commentId)
          .eq("workspace_id", this.workspaceId);
        if (error) throw error;
        return;
      }
      default:
        return;
    }
  }

  private async flushOutbox(): Promise<boolean> {
    const pending = sortOutboxByCreatedAt(
      await tasksLocalDB.outbox.where("scopeKey").equals(this.scopeKey).toArray()
    );
    if (!pending.length) return false;

    let changed = false;

    for (const entry of pending) {
      await this.applyOutboxEntry(entry);
      await tasksLocalDB.outbox.delete(entry.id);
      changed = true;
    }

    return changed;
  }

  async reconcile(): Promise<void> {
    if (this.destroyed || this.reconciling) return;
    this.reconciling = true;

    if (!this.isOnline) {
      this.emitStatus("offline");
      this.reconciling = false;
      return;
    }

    this.emitStatus("syncing");

    try {
      let changed = false;
      changed = (await this.flushOutbox()) || changed;
      changed = (await pullProjects(this.supabase, this.workspaceId, this.scopeKey)) || changed;
      changed = (await pullStates(this.supabase, this.workspaceId, this.scopeKey)) || changed;
      changed = (await pullTasks(this.supabase, this.workspaceId, this.scopeKey)) || changed;
      changed = (await pullComments(this.supabase, this.workspaceId, this.scopeKey)) || changed;
      if (changed) this.emitChange();
      this.emitStatus("synced");
    } catch {
      this.emitStatus("error");
    } finally {
      this.reconciling = false;
    }
  }
}
