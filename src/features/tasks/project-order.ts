// Each person's own project order (MOD-38): a sidebar drop written into
// their synced preferences (`tasksSidebar.projectOrder[workspace]`), and
// taken back when the area move it came with is refused, so a failed move
// never leaves an order that puts the project somewhere it isn't.

import { currentPreferences, updatePreferences } from "../../lib/preferences";

/** A drop as `projectOrderDrop` (sidebar.ts) answers it. */
export type ProjectDrop = { order: string[]; areaId: string | null; areaChanged: boolean };

/** This person's order in a workspace, or none (the workspace's order). */
function writeOrder(workspaceId: string, ids: readonly string[] | undefined): void {
  const now = currentPreferences().tasksSidebar;
  const projectOrder = { ...now.projectOrder };
  if (ids && ids.length > 0) projectOrder[workspaceId] = [...ids];
  else delete projectOrder[workspaceId];
  updatePreferences({ tasksSidebar: { ...now, projectOrder } });
}

const sameIds = (a: readonly string[] | undefined, b: readonly string[]) =>
  !!a && a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Writes the drop's order at once (the row stays where it was dropped). A
 * drop into another area also files the project there for everyone
 * (`moveToArea`); when that's refused, the order from before the drop comes
 * back, unless a newer drop has replaced it since. Answers whether the drop
 * stood.
 */
export function commitProjectDrop(
  workspaceId: string,
  drop: ProjectDrop,
  moveToArea: (areaId: string | null) => Promise<boolean>,
): Promise<boolean> {
  const before = currentPreferences().tasksSidebar.projectOrder[workspaceId];
  writeOrder(workspaceId, drop.order);
  if (!drop.areaChanged) return Promise.resolve(true);
  const putBack = () => {
    const now = currentPreferences().tasksSidebar.projectOrder[workspaceId];
    if (sameIds(now, drop.order)) writeOrder(workspaceId, before);
    return false;
  };
  return moveToArea(drop.areaId).then((moved) => moved || putBack(), putBack);
}
