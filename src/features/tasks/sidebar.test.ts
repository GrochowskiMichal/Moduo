// TV-U6 — the sidebar's project rules: colours, areas and their projects,
// reorder positions, what a delete or an archive will do (REPLAN 78), archive
// filtering, pending project changes, and remembered collapse.

import { describe, expect, it } from "@rstest/core";

import { changesFor } from "./hidden-buckets";
import type { Area, Bucket, Task } from "./model";
import {
  areaMoveAfter,
  BUCKET_COLOR_OPTIONS,
  bucketDotColor,
  partitionBuckets,
  placeTasks,
  projectDeleteSummary,
  projectDropPatch,
  projectOpenWork,
  sidebarGroups,
  storedBucketColor,
} from "./sidebar";
import { parseCollapsedSections } from "./ui/bucket-rail";

const NOW = "2026-10-01T00:00:00.000Z";
function bucket(id: string, position: string, extra: Partial<Bucket> = {}): Bucket {
  return {
    id,
    workspaceId: "w",
    ownerId: "u",
    name: id,
    isSystem: false,
    group: null,
    position,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...extra,
  };
}
function task(id: string, bucketId: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    workspaceId: "w",
    creatorId: "u",
    creatorUnknown: false,
    assigneeId: "u",
    bucketId,
    parentId: null,
    title: id,
    description: "",
    dueDate: null,
    scheduledAt: null,
    durationMinutes: null,
    timeSpentSeconds: 0,
    recurrence: null,
    energyLevel: null,
    priority: null,
    status: "todo",
    committedFor: null,
    commitOrder: null,
    rescheduleCount: 0,
    position: id,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...extra,
  };
}

function area(id: string, position: number): Area {
  return {
    id,
    workspaceId: "w",
    name: id,
    color: null,
    position,
    shared: true,
    createdBy: "u",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("colours (U6-1)", () => {
  it("shows a project's hue, and neutral gray for none or an unknown name", () => {
    expect(bucketDotColor({ color: "teal" })).toBe("teal");
    expect(bucketDotColor({ color: null })).toBe("gray");
    expect(bucketDotColor({})).toBe("gray");
    expect(bucketDotColor({ color: "chartreuse" })).toBe("gray");
  });

  it("stores neutral as no colour, so it follows the default", () => {
    expect(storedBucketColor("gray")).toBeNull();
    expect(storedBucketColor("violet")).toBe("violet");
  });

  it("offers the label hues, neutral first", () => {
    expect(BUCKET_COLOR_OPTIONS[0]).toEqual({ value: "gray", label: "Neutral" });
    expect(BUCKET_COLOR_OPTIONS.map((o) => o.value)).toContain("blue");
    expect(BUCKET_COLOR_OPTIONS[1]?.label).toBe("Blue");
  });
});

describe("areas and their projects (REPLAN 14)", () => {
  const product = area("product", 1);
  const clients = area("clients", 2);
  const a = bucket("a", "0000000100");
  const x = bucket("x", "0000000150", { areaId: "clients" });
  const b = bucket("b", "0000000200", { areaId: "product" });
  const lost = bucket("lost", "0000000250", { areaId: "deleted-area" });
  const inbox = bucket("inbox", "a0", { isSystem: true });

  it("projects without an area first, then each area in order with its projects", () => {
    const g = sidebarGroups([inbox, a, x, b, lost], [clients, product]);
    expect(g.loose.map((p) => p.id)).toEqual(["a", "lost"]);
    expect(g.areas.map((e) => [e.area.id, e.projects.map((p) => p.id)])).toEqual([
      ["product", ["b"]],
      ["clients", ["x"]],
    ]);
  });

  it("an empty area still shows (it was made on purpose)", () => {
    expect(sidebarGroups([], [product]).areas).toHaveLength(1);
  });

  it("moves an area one place up or down (the op takes the area to follow)", () => {
    const school = area("school", 3);
    const list = [product, clients, school];
    expect(areaMoveAfter(list, "clients", "up")).toBeNull();
    expect(areaMoveAfter(list, "school", "up")).toBe("product");
    expect(areaMoveAfter(list, "product", "down")).toBe("clients");
    expect(areaMoveAfter(list, "product", "up")).toBeUndefined();
    expect(areaMoveAfter(list, "school", "down")).toBeUndefined();
  });
});

describe("reorder positions (U6-1)", () => {
  const areas = [area("clients", 1)];
  const a = bucket("a", "0000000100");
  const b = bucket("b", "0000000200");
  const c = bucket("c", "0000000300");
  const x = bucket("x", "0000000150", { areaId: "clients" });
  const y = bucket("y", "0000000250", { areaId: "clients" });
  const list = [a, x, b, y, c];
  const sorted = (ids: Bucket[]) => ids.slice().sort((p, q) => (p.position < q.position ? -1 : 1));

  it("moving down places it after the target", () => {
    const patch = projectDropPatch(list, areas, "a", "b");
    expect(patch?.areaId).toBeNull();
    const moved = sorted([{ ...a, position: patch!.position }, b, c]).map((r) => r.id);
    expect(moved).toEqual(["b", "a", "c"]);
  });

  it("moving up places it before the target", () => {
    const patch = projectDropPatch(list, areas, "c", "a");
    const moved = sorted([a, b, { ...c, position: patch!.position }]).map((r) => r.id);
    expect(moved).toEqual(["c", "a", "b"]);
  });

  it("dropping on a project in another area moves it into that area, before it", () => {
    const patch = projectDropPatch(list, areas, "b", "y");
    expect(patch?.areaId).toBe("clients");
    const clients = sorted([x, { ...b, position: patch!.position }, y]).map((r) => r.id);
    expect(clients).toEqual(["x", "b", "y"]);
  });

  it("dropping on itself or an unknown project changes nothing", () => {
    expect(projectDropPatch(list, areas, "a", "a")).toBeNull();
    expect(projectDropPatch(list, areas, "a", "nope")).toBeNull();
  });
});

describe("what deleting or archiving a project does (REPLAN 78)", () => {
  const tasks = [
    task("open-mine", "p", { assigneeId: "me" }),
    task("open-free", "p", { assigneeId: null }),
    task("open-anna", "p", { assigneeId: "anna" }),
    task("step-done", "p", { assigneeId: "bob", parentId: "open-anna", status: "done" }),
    task("done", "p", { status: "done" }),
    task("wont", "p", { status: "archived" }),
    task("done-parent", "p", { status: "done", assigneeId: "anna" }),
    task("open-step", "p", { parentId: "done-parent" }),
    task("elsewhere", "q"),
  ];

  it("counts the open trees (with their steps) and the finished ones", () => {
    expect(projectDeleteSummary(tasks, "p", "me")).toEqual({ moving: 6, toYou: 2, finished: 2 });
  });

  it("an empty project has nothing to move or delete", () => {
    expect(projectDeleteSummary(tasks, "empty", "me")).toEqual({
      moving: 0,
      toYou: 0,
      finished: 0,
    });
  });

  it("the archive prompt counts every unfinished task and moves only the tops", () => {
    const work = projectOpenWork(tasks, "p");
    expect(work.open.map((t) => t.id).sort()).toEqual(
      ["open-anna", "open-free", "open-mine", "open-step"].sort(),
    );
    // open-step's parent is finished, so it moves on its own.
    expect(work.tops.map((t) => t.id).sort()).toEqual(
      ["open-anna", "open-free", "open-mine", "open-step"].sort(),
    );
    const nested = projectOpenWork([task("top", "p"), task("sub", "p", { parentId: "top" })], "p");
    expect(nested.tops.map((t) => t.id)).toEqual(["top"]);
  });
});

describe("archive filtering (U6-4)", () => {
  const inbox = bucket("inbox", "a0", { isSystem: true });
  const live = bucket("live", "1");
  const archived = bucket("arch", "2", { archivedAt: NOW });
  const deleted = bucket("gone", "3", { deletedAt: NOW });

  it("splits live from archived; deleted projects are in neither", () => {
    const p = partitionBuckets([inbox, live, archived, deleted], new Map());
    expect(p.live.map((b) => b.id)).toEqual(["inbox", "live"]);
    expect(p.archived.map((b) => b.id)).toEqual(["arch"]);
  });

  it("applies pending changes: archived, deleted, never the Inbox", () => {
    const changes = new Map([
      ["live", "archived" as const],
      ["arch", "deleted" as const],
      ["inbox", "archived" as const],
    ]);
    const p = partitionBuckets([inbox, live, archived], changes);
    expect(p.live.map((b) => b.id)).toEqual(["inbox"]);
    expect(p.archived.map((b) => b.id)).toEqual(["live"]);
  });

  it("while a delete is on its way, shows only the open work that lands in your Inbox", () => {
    const tasks = [
      task("t-live", "live"),
      task("t-arch", "arch"),
      task("mine", "d", { assigneeId: "me", sectionId: "s1" }),
      task("free", "d", { assigneeId: null }),
      task("annas", "d", { assigneeId: "anna" }),
      task("finished", "d", { assigneeId: "me", status: "done" }),
      task("t-deleted", "live", { deletedAt: NOW }),
    ];
    const placed = placeTasks(tasks, {
      archivedBucketIds: new Set(["arch"]),
      changes: new Map([["d", "deleted" as const]]),
      inboxId: "inbox",
      userId: "me",
    });
    expect(placed.live.map((t) => [t.id, t.bucketId, t.sectionId ?? null])).toEqual([
      ["t-live", "live", null],
      ["mine", "inbox", null],
      ["free", "inbox", null],
    ]);
    expect(placed.archived.map((t) => t.id)).toEqual(["t-arch"]);
  });
});

describe("pending changes per bundle (hidden-buckets)", () => {
  it("applies in-flight changes everywhere, and confirmed ones only to bundles read before", () => {
    const all = new Map([
      ["pending", { change: "deleted" as const, confirmedAt: null }],
      ["done", { change: "archived" as const, confirmedAt: 1000 }],
    ]);
    expect([...changesFor(all, 0).keys()]).toEqual(["pending", "done"]);
    expect([...changesFor(all, 999).keys()]).toEqual(["pending", "done"]);
    // A bundle read after the server confirmed already shows the server.
    expect([...changesFor(all, 1001).keys()]).toEqual(["pending"]);
  });
});

describe("collapse persistence (REPLAN 29e)", () => {
  it("reads the remembered collapsed groups, and anything unreadable as none", () => {
    expect([...parseCollapsedSections(JSON.stringify(["area:a1", "pinned"]))]).toEqual([
      "area:a1",
      "pinned",
    ]);
    expect(parseCollapsedSections("{").size).toBe(0);
    expect(parseCollapsedSections(null).size).toBe(0);
  });
});
