// Connective-tissue spine — the Tasks ↔ entity_links bridge (block CT-7, AC13).
//
// Tasks' blocker→blocked dependencies are mirrored into the spine as `blocks`
// edges (see 20260627130000_tasks_relations_to_links.sql). This pure converter
// projects those `entity_links` rows back into the `TaskRelation` shape the
// existing blocked-by helpers (blockedTaskIds / frontierTasks / wouldCreateCycle)
// already consume — so the SAME computation works whether its edges come from
// `task_relations` (the shipped read path) or from `entity_links` (the spine).
// That equivalence is what AC13's "blocked-by still works via entity_links"
// asserts; the dual-path holds because the data is identical, only the source
// table differs.

import type { EntityLink } from "../../lib/entity-links";
import type { TaskRelation } from "./model";

/**
 * Project live `blocks` edges between two tasks into `TaskRelation`s
 * (source=blocker → target=blocked). Ignores tombstoned edges, non-`blocks`
 * kinds, and any edge whose endpoints aren't both tasks — so a contact↔company
 * `works-at` link or a deleted edge can never masquerade as a dependency.
 */
export function blocksLinksToRelations(links: EntityLink[]): TaskRelation[] {
  const out: TaskRelation[] = [];
  for (const link of links) {
    if (link.relationKind !== "blocks") continue;
    if (link.deletedAt) continue;
    if (link.sourceType !== "task" || link.targetType !== "task") continue;
    out.push({
      id: link.id,
      workspaceId: link.workspaceId,
      blockerTaskId: link.sourceId,
      blockedTaskId: link.targetId,
      createdAt: link.createdAt,
    });
  }
  return out;
}
