export type TaskPriority = 0 | 1 | 2 | 3 | 4;

export type TaskViewMode = "board" | "list";

export type TasksSyncStatus = "offline" | "syncing" | "synced" | "error";

export type TaskWorkflowKind =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "canceled"
  | "custom";

export type TaskProject = {
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

export type TaskWorkflowState = {
  id: string;
  workspaceId: string;
  ownerId: string;
  projectId: string;
  name: string;
  kind: TaskWorkflowKind;
  color: string | null;
  position: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type Task = {
  id: string;
  workspaceId: string;
  ownerId: string;
  projectId: string;
  parentTaskId: string | null;
  stateId: string;
  assigneeId: string | null;
  title: string;
  description: string;
  tags: string[];
  priority: TaskPriority;
  dueDate: string | null;
  position: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type TaskComment = {
  id: string;
  workspaceId: string;
  ownerId: string;
  taskId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type TaskTreeNode = Task & {
  depth: number;
  children: TaskTreeNode[];
};

export type TaskOutboxOp =
  | "upsert_project"
  | "upsert_state"
  | "upsert_task"
  | "delete_task"
  | "move_task"
  | "upsert_comment"
  | "delete_comment";

export type TaskOutboxEntry = {
  id: string;
  scopeKey: string;
  workspaceId: string;
  ownerId: string;
  op: TaskOutboxOp;
  payload: unknown;
  createdAt: string;
};

export type TaskMovePayload = {
  taskId: string;
  newParentTaskId: string | null;
  newStateId: string;
  newPosition: string;
};
