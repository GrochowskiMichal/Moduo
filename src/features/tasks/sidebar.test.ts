// tasks-v2 U6-1, U6-4 — the rail's bucket rules: colours, reorder positions,
// archive filtering, pending bucket changes, and remembered section collapse.

import { describe, expect, it } from "@rstest/core";

import { changesFor } from "./hidden-buckets";
import type { Bucket, Task } from "./model";
import {
  BUCKET_COLOR_OPTIONS,
  bucketDotColor,
  bucketDropPatch,
  partitionBuckets,
  placeTasks,
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

describe("colours (U6-1)", () => {
  it("shows a bucket's hue, and neutral gray for none or an unknown name", () => {
    expect(bucketDotColor({ color: "teal" })).toBe("teal");
    expect(bucketDotColor({ color: null })).toBe("gray");
    expect(bucketDotColor({})).toBe("gray");
    expect(bucketDotColor({ color: "chartreuse" })).toBe("gray");
  });

  it("stores neutral as no colour, so it follows the default", () => {
    expect(storedBucketColor("gray")).toBeNull();
    expect(storedBucketColor("violet")).toBe("violet");
  });

  it("offers the 8 label hues, neutral first", () => {
    expect(BUCKET_COLOR_OPTIONS.map((o) => o.value)).toEqual([
      "gray",
      "blue",
      "green",
      "amber",
      "red",
      "violet",
      "teal",
      "pink",
    ]);
    expect(BUCKET_COLOR_OPTIONS[0]?.label).toBe("Neutral");
    expect(BUCKET_COLOR_OPTIONS[1]?.label).toBe("Blue");
  });
});

describe("reorder positions (U6-1)", () => {
  const a = bucket("a", "0000000100");
  const b = bucket("b", "0000000200");
  const c = bucket("c", "0000000300");
  const x = bucket("x", "0000000150", { group: "Clients" });
  const y = bucket("y", "0000000250", { group: "Clients" });
  const list = [a, x, b, y, c];
  const sorted = (ids: Bucket[]) => ids.slice().sort((p, q) => (p.position < q.position ? -1 : 1));

  it("moving down places it after the target", () => {
    const patch = bucketDropPatch(list, "a", "b");
    expect(patch?.group).toBeNull();
    const moved = sorted([{ ...a, position: patch!.position }, b, c]).map((r) => r.id);
    expect(moved).toEqual(["b", "a", "c"]);
  });

  it("moving up places it before the target", () => {
    const patch = bucketDropPatch(list, "c", "a");
    const moved = sorted([a, b, { ...c, position: patch!.position }]).map((r) => r.id);
    expect(moved).toEqual(["c", "a", "b"]);
  });

  it("moving onto the last bucket lands at the end", () => {
    const patch = bucketDropPatch(list, "a", "c");
    const moved = sorted([{ ...a, position: patch!.position }, b, c]).map((r) => r.id);
    expect(moved).toEqual(["b", "c", "a"]);
  });

  it("dropping on a bucket in another section moves it into that section, before it", () => {
    const patch = bucketDropPatch(list, "b", "y");
    expect(patch?.group).toBe("Clients");
    const clients = sorted([x, { ...b, position: patch!.position }, y]).map((r) => r.id);
    expect(clients).toEqual(["x", "b", "y"]);
  });

  it("dropping on itself or an unknown bucket changes nothing", () => {
    expect(bucketDropPatch(list, "a", "a")).toBeNull();
    expect(bucketDropPatch(list, "a", "nope")).toBeNull();
  });
});

describe("archive filtering (U6-4)", () => {
  const inbox = bucket("inbox", "a0", { isSystem: true });
  const live = bucket("live", "1");
  const archived = bucket("arch", "2", { archivedAt: NOW });
  const deleted = bucket("gone", "3", { deletedAt: NOW });

  it("splits live from archived; deleted buckets are in neither", () => {
    const p = partitionBuckets([inbox, live, archived, deleted], new Map());
    expect(p.live.map((b) => b.id)).toEqual(["inbox", "live"]);
    expect(p.archived.map((b) => b.id)).toEqual(["arch"]);
  });

  it("applies pending changes: archived, deleted (either way), never the Inbox", () => {
    const changes = new Map([
      ["live", "archived" as const],
      ["arch", "move" as const],
      ["inbox", "archived" as const],
    ]);
    const p = partitionBuckets([inbox, live, archived], changes);
    expect(p.live.map((b) => b.id)).toEqual(["inbox"]);
    expect(p.archived.map((b) => b.id)).toEqual(["live"]);
  });

  it("hides archived buckets' tasks from every list, moves a pending move's tasks to Inbox, drops a pending delete-with-tasks", () => {
    const tasks = [
      task("t-live", "live"),
      task("t-arch", "arch"),
      task("t-move", "m"),
      task("t-drop", "d"),
      task("t-deleted", "live", { deletedAt: NOW }),
    ];
    const placed = placeTasks(tasks, {
      archivedBucketIds: new Set(["arch"]),
      changes: new Map([
        ["m", "move" as const],
        ["d", "drop" as const],
      ]),
      inboxId: "inbox",
    });
    expect(placed.live.map((t) => [t.id, t.bucketId])).toEqual([
      ["t-live", "live"],
      ["t-move", "inbox"],
    ]);
    expect(placed.archived.map((t) => t.id)).toEqual(["t-arch"]);
  });
});

describe("pending changes per bundle (hidden-buckets)", () => {
  it("applies in-flight changes everywhere, and confirmed ones only to bundles read before", () => {
    const all = new Map([
      ["pending", { change: "move" as const, confirmedAt: null }],
      ["done", { change: "drop" as const, confirmedAt: 1000 }],
    ]);
    expect([...changesFor(all, 0).keys()]).toEqual(["pending", "done"]);
    expect([...changesFor(all, 999).keys()]).toEqual(["pending", "done"]);
    // A bundle read after the server confirmed already shows the server.
    expect([...changesFor(all, 1001).keys()]).toEqual(["pending"]);
  });
});

describe("collapse persistence (U6-1)", () => {
  it("reads the remembered collapsed sections, and anything unreadable as none", () => {
    expect([...parseCollapsedSections(JSON.stringify(["Clients"]))]).toEqual(["Clients"]);
    expect(parseCollapsedSections("{").size).toBe(0);
    expect(parseCollapsedSections(null).size).toBe(0);
  });
});
