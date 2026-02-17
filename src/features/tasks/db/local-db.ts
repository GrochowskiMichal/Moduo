import Dexie, { type Table } from "dexie";
import type {
  Task,
  TaskComment,
  TaskOutboxEntry,
  TaskProject,
  TaskWorkflowState,
} from "../types";

type LocalMetaKV = {
  key: string;
  value: string;
};

export class TasksLocalDB extends Dexie {
  projects!: Table<TaskProject, string>;
  states!: Table<TaskWorkflowState, string>;
  tasks!: Table<Task, string>;
  comments!: Table<TaskComment, string>;
  outbox!: Table<TaskOutboxEntry, string>;
  meta!: Table<LocalMetaKV, string>;

  constructor() {
    super("moduo_tasks_v1");

    this.version(1).stores({
      projects: "id, ownerId, position, updatedAt, deletedAt",
      states: "id, ownerId, projectId, [projectId+position], kind, updatedAt, deletedAt",
      tasks:
        "id, ownerId, projectId, parentTaskId, stateId, [projectId+parentTaskId], [projectId+stateId], position, updatedAt, deletedAt, dueDate, priority",
      comments: "id, ownerId, taskId, [taskId+createdAt], updatedAt, deletedAt",
      outbox: "id, ownerId, op, createdAt",
      meta: "key",
    });

    this.version(2).stores({
      projects: "id, workspaceId, ownerId, position, updatedAt, deletedAt",
      states: "id, workspaceId, ownerId, projectId, [workspaceId+projectId], [projectId+position], kind, updatedAt, deletedAt",
      tasks:
        "id, workspaceId, ownerId, projectId, parentTaskId, stateId, [projectId+parentTaskId], [projectId+stateId], [workspaceId+projectId], assigneeId, position, updatedAt, deletedAt, dueDate, priority",
      comments: "id, workspaceId, ownerId, taskId, [taskId+createdAt], [workspaceId+taskId], updatedAt, deletedAt",
      outbox: "id, scopeKey, workspaceId, ownerId, op, createdAt",
      meta: "key",
    });
  }
}

export const tasksLocalDB = new TasksLocalDB();

export async function getTasksMetaValue(key: string): Promise<string | null> {
  const row = await tasksLocalDB.meta.get(key);
  return row?.value ?? null;
}

export async function setTasksMetaValue(key: string, value: string): Promise<void> {
  await tasksLocalDB.meta.put({ key, value });
}

export async function removeTasksMetaValue(key: string): Promise<void> {
  await tasksLocalDB.meta.delete(key);
}
