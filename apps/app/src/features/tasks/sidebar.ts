// The Tasks sidebar's project rules (TV-U6, specs/tasks-v3.md §3 + §15):
// colour dots, areas and their projects, each person's own project order
// (MOD-38), archived projects,
// what deleting a project will do, and what it shows before the server
// answers. Pure, no React or IO.

import { isClosedTask } from "@contracts/vocabularies";

import {
  DEFAULT_LABEL_COLOR,
  LABEL_COLORS,
  type LabelColor,
  normalizeLabelColor,
} from "../../components/tag-colors";
import { endPosition } from "./helpers";
import type { Area, Bucket, Task } from "./model";

// ── colours ──────────────────────────────────────────────────────────────────

/** The sidebar dot's hue: the project's (or area's) colour, else neutral gray. */
export function bucketDotColor(item: { color?: string | null }): LabelColor {
  return normalizeLabelColor(item.color);
}

/** What a Colour pick stores: neutral is "no colour" (null), so it follows the default. */
export function storedBucketColor(color: LabelColor): string | null {
  return color === DEFAULT_LABEL_COLOR ? null : color;
}

/** The Colour menu: neutral first (the default), then the label hues. */
export const BUCKET_COLOR_OPTIONS: ReadonlyArray<{ value: LabelColor; label: string }> = [
  { value: DEFAULT_LABEL_COLOR, label: "Neutral" },
  ...LABEL_COLORS.filter((c) => c !== DEFAULT_LABEL_COLOR).map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
  })),
];

// ── areas and their projects (REPLAN 14–15) ──────────────────────────────────

const byPosition = <T extends { position: string }>(a: T, b: T) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
const byAreaPosition = (a: Area, b: Area) => a.position - b.position || (a.id < b.id ? -1 : 1);

/** The project's area, when it is one of the live areas the reader holds. */
function areaKey(project: Pick<Bucket, "areaId">, areaIds: ReadonlySet<string>): string | null {
  const id = project.areaId ?? null;
  return id && areaIds.has(id) ? id : null;
}

export type SidebarArea = { area: Area; projects: Bucket[] };

/**
 * Projects in one person's own order (MOD-38, like Slack's channels): the
 * ones they've placed, as they placed them, then the rest in the workspace's
 * order (so a project made since lands at the end of its area). Without an
 * order of their own, the workspace's.
 */
export function orderProjects<T extends Pick<Bucket, "id" | "position">>(
  projects: ReadonlyArray<T>,
  order: readonly string[] = [],
): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return projects.slice().sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return byPosition(a, b);
  });
}

/**
 * The workspace block's project rows: projects without an area first, then
 * each live area in its order with its projects (REPLAN 14's sidebar), each
 * list in the reader's own order (MOD-38). A project filed under an area the
 * reader doesn't hold (deleted, or not visible) shows with the area-less
 * ones. An area with no project still shows (it was made on purpose).
 */
export function sidebarGroups(
  projects: ReadonlyArray<Bucket>,
  areas: ReadonlyArray<Area>,
  order: readonly string[] = [],
): { loose: Bucket[]; areas: SidebarArea[] } {
  const live = areas.slice().sort(byAreaPosition);
  const ids = new Set(live.map((a) => a.id));
  const sorted = orderProjects(
    projects.filter((p) => !p.isSystem),
    order,
  );
  return {
    loose: sorted.filter((p) => areaKey(p, ids) === null),
    areas: live.map((area) => ({
      area,
      projects: sorted.filter((p) => areaKey(p, ids) === area.id),
    })),
  };
}

/** The projects top to bottom as the reader's sidebar lists them (MOD-38):
 *  area-less first, then each area's; Filter → Project offers them so (MOD-141). */
export function sidebarProjects(
  projects: ReadonlyArray<Bucket>,
  areas: ReadonlyArray<Area>,
  order: readonly string[] = [],
): Bucket[] {
  const groups = sidebarGroups(projects, areas, order);
  return [...groups.loose, ...groups.areas.flatMap((g) => g.projects)];
}

/**
 * A project dropped on another one in the sidebar (MOD-38): the reader's new
 * order of every project, as the sidebar shows them, with the dragged one
 * after the target when moving down within the same area and before it
 * otherwise (the order a sortable list shows while dragging), and the area it
 * lands in (the target's). Only the order is the reader's own; a new area is
 * the workspace's, so a drop into another area needs `canEdit` (the caller
 * files it there). Null when nothing would change, or the drop isn't allowed.
 */
export function projectOrderDrop(
  projects: ReadonlyArray<Bucket>,
  areas: ReadonlyArray<Area>,
  order: readonly string[],
  activeId: string,
  overId: string,
  canEdit: boolean,
): { order: string[]; areaId: string | null; areaChanged: boolean } | null {
  if (activeId === overId) return null;
  const groups = sidebarGroups(projects, areas, order);
  const lists = [groups.loose, ...groups.areas.map((g) => g.projects)];
  const listOf = (id: string) => lists.findIndex((list) => list.some((b) => b.id === id));
  const from = listOf(activeId);
  const to = listOf(overId);
  if (from === -1 || to === -1 || (from !== to && !canEdit)) return null;
  const shown = lists.flat().map((b) => b.id);
  const after = from === to && shown.indexOf(activeId) < shown.indexOf(overId);
  const rest = shown.filter((id) => id !== activeId);
  const at = rest.indexOf(overId) + (after ? 1 : 0);
  const ids = new Set(areas.map((a) => a.id));
  const over = projects.find((b) => b.id === overId);
  return {
    order: [...rest.slice(0, at), activeId, ...rest.slice(at)],
    areaId: over ? areaKey(over, ids) : null,
    areaChanged: from !== to,
  };
}

/** A position after every project the reader holds (a move into an area
 *  lands last in it). */
export function projectEndPosition(projects: ReadonlyArray<Bucket>): string {
  return endPosition(projects.filter((p) => !p.isSystem && !p.deletedAt));
}

/** The area right before / after this one, for "Move up" / "Move down"; the
 *  op takes the area to follow (null = first). Undefined when it can't move. */
export function areaMoveAfter(
  areas: ReadonlyArray<Area>,
  areaId: string,
  direction: "up" | "down",
): string | null | undefined {
  const list = areas.slice().sort(byAreaPosition);
  const i = list.findIndex((a) => a.id === areaId);
  if (i < 0) return undefined;
  if (direction === "up") {
    if (i === 0) return undefined;
    return i >= 2 ? (list[i - 2]?.id ?? null) : null;
  }
  if (i === list.length - 1) return undefined;
  return list[i + 1]?.id ?? null;
}

// ── what deleting or archiving a project will do (REPLAN 78) ────────────────

/** Each task of a project with the top of its tree (a subtask whose parent
 *  sits elsewhere is its own top), as the server's delete plans it. */
function trees(tasks: ReadonlyArray<Task>, projectId: string) {
  const inProject = tasks.filter((t) => t.bucketId === projectId && !t.deletedAt);
  const ids = new Set(inProject.map((t) => t.id));
  const rootOf = (t: Task) => (t.parentId && ids.has(t.parentId) ? t.parentId : t.id);
  const open = new Set<string>();
  for (const t of inProject) if (!isClosedTask(t)) open.add(rootOf(t));
  const byId = new Map(inProject.map((t) => [t.id, t]));
  return { inProject, rootOf, open, byId };
}

export type ProjectDeleteSummary = {
  /** Tasks that go to an Inbox (every task in a tree with open work). */
  moving: number;
  /** …of which land in yours (unassigned, or yours). */
  toYou: number;
  /** Finished tasks that go to Recently deleted with the project. */
  finished: number;
};

/** What a delete will do, as the confirm says it (the server decides, with
 *  the same rule; "yours" can't know who lost the right to work on tasks). */
export function projectDeleteSummary(
  tasks: ReadonlyArray<Task>,
  projectId: string,
  userId: string | null,
): ProjectDeleteSummary {
  const { inProject, rootOf, open, byId } = trees(tasks, projectId);
  let moving = 0;
  let toYou = 0;
  for (const t of inProject) {
    const root = rootOf(t);
    if (!open.has(root)) continue;
    moving += 1;
    const owner = byId.get(root)?.assigneeId ?? null;
    if (owner === null || owner === userId) toYou += 1;
  }
  return { moving, toYou, finished: inProject.length - moving };
}

/**
 * The open work an archive asks about ("4 open tasks — Won't do · Move ·
 * Keep"): every task that isn't finished (Backlog too), and the ones to move
 * (a moved task takes its subtasks along, so only the tops of the open ones).
 */
export function projectOpenWork(
  tasks: ReadonlyArray<Task>,
  projectId: string,
): { open: Task[]; tops: Task[] } {
  const { inProject } = trees(tasks, projectId);
  const open = inProject.filter((t) => !isClosedTask(t));
  const openIds = new Set(open.map((t) => t.id));
  const tops = open.filter((t) => !(t.parentId && openIds.has(t.parentId)));
  return { open, tops };
}

// ── delete, as shown before the server answers ──────────────────────────────

/**
 * What a project's delete does to the tasks you see, shown the moment it's
 * made (the store's overlay, TV-D11a): an open tree whose top task is yours
 * or unassigned lands in your Inbox (out of any section); every other task
 * leaves (a teammate's Inbox, or Recently deleted). The server applies the
 * same rule (REPLAN 78) and its answer replaces this.
 */
export function projectDeletePlan(
  tasks: ReadonlyArray<Task>,
  projectId: string,
  opts: { inboxId: string | null; userId: string | null },
): { toInbox: string[]; gone: string[] } {
  const { inProject, rootOf, open, byId } = trees(tasks, projectId);
  const toInbox: string[] = [];
  const gone: string[] = [];
  for (const t of inProject) {
    const root = rootOf(t);
    const owner = byId.get(root)?.assigneeId ?? null;
    if (open.has(root) && opts.inboxId && (owner === null || owner === opts.userId)) {
      toInbox.push(t.id);
    } else {
      gone.push(t.id);
    }
  }
  return { toInbox, gone };
}
