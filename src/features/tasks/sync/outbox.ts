import type { TaskOutboxEntry } from "../types";

export function sortOutboxByCreatedAt(entries: TaskOutboxEntry[]): TaskOutboxEntry[] {
  return [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
