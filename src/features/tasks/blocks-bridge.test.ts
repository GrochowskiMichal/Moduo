// Proves AC13 — blocked-by still works when its edges come from `entity_links`
// (kind='blocks') instead of `task_relations`. The bridge projects blocks edges
// into TaskRelations; the existing blocked-by helpers then compute IDENTICALLY,
// which is the whole point of the dual-path (same data, different source table).

import { describe, expect, it } from "vitest";

import { blocksLinksToRelations } from "./blocks-bridge";
import { blockedTaskIds, frontierTasks, makeTask } from "./helpers";
import type { EntityLink } from "../../lib/entity-links";
import type { Task, TaskStatus } from "./model";

function task(id: string, opts: { status?: TaskStatus } = {}): Task {
  const t = makeTask({ workspaceId: "w", bucketId: "b", title: id.toUpperCase(), position: id });
  t.id = id;
  t.status = opts.status ?? "todo";
  return t;
}

let seq = 0;
function blocksLink(blockerId: string, blockedId: string, over: Partial<EntityLink> = {}): EntityLink {
  seq += 1;
  return {
    id: `lnk-${seq}`,
    workspaceId: "w",
    sourceType: "task",
    sourceId: blockerId,
    targetType: "task",
    targetId: blockedId,
    relationKind: "blocks",
    origin: "manual",
    createdBy: "u1",
    createdAt: "2026-06-27T00:00:00Z",
    deletedAt: null,
    ...over,
  };
}

describe("blocksLinksToRelations", () => {
  it("projects live blocks edges into blocker→blocked TaskRelations", () => {
    const rels = blocksLinksToRelations([blocksLink("a", "b")]);
    expect(rels).toHaveLength(1);
    expect(rels[0]).toMatchObject({ blockerTaskId: "a", blockedTaskId: "b", workspaceId: "w" });
  });

  it("ignores tombstoned, non-blocks, and non-task edges", () => {
    const rels = blocksLinksToRelations([
      blocksLink("a", "b", { deletedAt: "2026-06-27T01:00:00Z" }), // tombstoned
      blocksLink("a", "c", { relationKind: "references" }), // not a dependency
      blocksLink("a", "d", { sourceType: "contact" }), // not both tasks
      blocksLink("a", "e", { targetType: "company" }), // not both tasks
    ]);
    expect(rels).toHaveLength(0);
  });
});

describe("blocked-by computed from entity_links matches task_relations", () => {
  it("marks the same tasks blocked whether edges come from links or relations", () => {
    const tasks = [task("a"), task("b"), task("c")];
    // a blocks b, b blocks c — a chain.
    const links = [blocksLink("a", "b"), blocksLink("b", "c")];
    const relations = blocksLinksToRelations(links);

    const blocked = blockedTaskIds(tasks, relations);
    expect(blocked.has("b")).toBe(true); // blocked by open a
    expect(blocked.has("c")).toBe(true); // blocked by open b
    expect(blocked.has("a")).toBe(false); // nothing blocks the root
  });

  it("a done blocker unblocks via links exactly as via relations", () => {
    const tasks = [task("a", { status: "done" }), task("b")];
    const relations = blocksLinksToRelations([blocksLink("a", "b")]);
    expect(blockedTaskIds(tasks, relations).has("b")).toBe(false);
  });

  it("frontier of a blocked task resolves through link-sourced edges", () => {
    const tasks = [task("a"), task("b"), task("c")];
    const relations = blocksLinksToRelations([blocksLink("a", "b"), blocksLink("b", "c")]);
    // c's nearest open, unblocked frontier is a (via b, which is itself blocked).
    const frontier = frontierTasks("c", tasks, relations).map((t) => t.id);
    expect(frontier).toEqual(["a"]);
  });
});
