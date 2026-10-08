// "Duplicate" in the detail panel's ⋯ menu (tasks-v2 §9): a fresh, open copy of
// a task's plan, not of its history. Kept: title, description, bucket, parent,
// assignee, priority, energy, dates, estimate and repeat rule (and, by the
// caller, its tags). Left behind: status (the copy is open), tracked time,
// queue places, subtasks, blockers, links, comments and attachments. Pure.

import type { NewTaskFields } from "./helpers";
import type { Task } from "./model";

export function duplicateFields(task: Task): Omit<NewTaskFields, "workspaceId" | "position"> {
  return {
    bucketId: task.bucketId,
    parentId: task.parentId,
    title: task.title,
    description: task.description,
    assigneeId: task.assigneeId,
    priority: task.priority,
    energyLevel: task.energyLevel,
    dueDate: task.dueDate,
    scheduledAt: task.scheduledAt,
    durationMinutes: task.durationMinutes,
    recurrence: task.recurrence,
  };
}
