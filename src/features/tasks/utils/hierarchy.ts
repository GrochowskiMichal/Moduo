import type { Task, TaskTreeNode } from "../types";

export function sortByPosition<T extends { position: string }>(a: T, b: T): number {
  return a.position.localeCompare(b.position);
}

export function buildTaskTree(tasks: Task[]): TaskTreeNode[] {
  const byParent = new Map<string | null, Task[]>();
  const active = tasks.filter((task) => !task.deletedAt);

  for (const task of active) {
    const list = byParent.get(task.parentTaskId) ?? [];
    list.push(task);
    byParent.set(task.parentTaskId, list);
  }

  for (const list of byParent.values()) {
    list.sort(sortByPosition);
  }

  const visit = (parentId: string | null, depth: number): TaskTreeNode[] => {
    const list = byParent.get(parentId) ?? [];
    return list.map((task) => ({
      ...task,
      depth,
      children: visit(task.id, depth + 1),
    }));
  };

  return visit(null, 0);
}

export function flattenTaskTree(tree: TaskTreeNode[]): TaskTreeNode[] {
  const flat: TaskTreeNode[] = [];
  const walk = (nodes: TaskTreeNode[]) => {
    for (const node of nodes) {
      flat.push(node);
      walk(node.children);
    }
  };
  walk(tree);
  return flat;
}
