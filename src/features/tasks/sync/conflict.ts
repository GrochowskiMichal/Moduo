import type { Task } from "../types";

export function resolveTaskConflict(local: Task, remote: Task): Task {
  return remote.updatedAt >= local.updatedAt ? remote : local;
}
