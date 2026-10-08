// TV-T1 — one workspace tag store feeds every surface (T1-1), and a tag can be
// created by name and attached in one step before its task exists (T1-2).
// Runs the real Tasks hook and the hub tag-row hook over an in-memory server
// whose writes can be held, to show what each surface renders before the
// server answers.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

type ToastOpts = {
  action?: { onClick: () => void };
  onAutoClose?: () => void;
  onDismiss?: () => void;
};
const toastMock = rs.hoisted(() => {
  let n = 0;
  const fn = rs.fn((..._args: unknown[]) => `toast-${++n}`);
  return Object.assign(fn, { dismiss: rs.fn(), error: rs.fn(), message: rs.fn() });
});
rs.mock("sonner", () => ({ toast: toastMock }));

import type { ModuoRuntime } from "../../lib/runtime.types";
import { makeTask } from "../tasks/helpers";
import { useTasksModule } from "../tasks/hooks/use-tasks-module";
import type { Bucket, Tag, TagLink, Task } from "../tasks/model";
import { useEntityTags } from "./hooks/use-entity-tags";
import {
  attachTagUser,
  createOrAttachByName,
  deleteTag,
  getTagView,
  resetTagStore,
  seedTags,
  type TagContext,
  tagsOf,
  toggleTag,
} from "./store";

const WS = "ws-tags";
const NOW = "2026-10-08T12:00:00.000Z";

const INBOX: Bucket = {
  id: "b1",
  workspaceId: WS,
  ownerId: "u1",
  name: "Inbox",
  isSystem: true,
  group: null,
  position: "a",
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};

function task(id: string): Task {
  return {
    ...makeTask({ workspaceId: WS, bucketId: "b1", title: id, position: id }),
    id,
    creatorId: "u1",
    assigneeId: "u1",
  };
}

function tag(id: string, name: string, color = "blue"): Tag {
  return {
    id,
    workspaceId: WS,
    ownerId: "u1",
    name,
    color,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

function link(tagId: string, entityType: string, entityId: string): TagLink {
  return {
    id: `l-${tagId}-${entityId}`,
    workspaceId: WS,
    tagId,
    entityType,
    entityId,
    createdAt: NOW,
  };
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** An in-memory server. `hold()` makes every write wait until released. */
function fakeServer(init: { tasks?: Task[]; tags?: Tag[]; links?: TagLink[] } = {}) {
  const db = {
    tasks: [...(init.tasks ?? [])],
    tags: [...(init.tags ?? [])],
    links: [...(init.links ?? [])],
  };
  let gate: Promise<void> | null = null;
  const calls: string[] = [];
  const write = async (name: string) => {
    calls.push(`${name}:start`);
    if (gate) await gate;
  };
  const live = () => db.tags.filter((t) => !t.deletedAt);
  let n = 0;
  const api = {
    list: rs.fn(async () => ({
      buckets: [INBOX],
      tasks: db.tasks,
      tags: live(),
      tagLinks: db.links,
      taskRelations: [],
      truncated: [],
    })),
    getTimeBlocks: rs.fn(async () => ({})),
    opCatchUp: rs.fn(async () => []),
    upsertTask: rs.fn(async (t: Task) => {
      await write("upsertTask");
      const saved = { ...t, id: `task-${++n}` };
      db.tasks.push(saved);
      return saved;
    }),
    upsertTag: rs.fn(async (t: Tag) => {
      await write("upsertTag");
      const row = { ...t, updatedAt: NOW };
      db.tags = [...db.tags.filter((x) => x.id !== t.id), row];
      calls.push("upsertTag:done");
      return row;
    }),
    deleteTag: rs.fn(async ({ tagId }: { tagId: string }) => {
      await write("deleteTag");
      db.links = db.links.filter((l) => l.tagId !== tagId);
      db.tags = db.tags.map((t) => (t.id === tagId ? { ...t, deletedAt: NOW } : t));
    }),
    attachTag: rs.fn(
      async (input: {
        workspaceId: string;
        tagId: string;
        entityType: string;
        entityId: string;
      }) => {
        await write("attachTag");
        // tag_links.tag_id references tags(id): the tag's row must exist first.
        if (!live().some((t) => t.id === input.tagId)) throw new Error("tag_links_tag_id_fkey");
        const row = { id: `link-${++n}`, ...input, createdAt: NOW };
        db.links.push(row);
        calls.push("attachTag:done");
        return row;
      },
    ),
    detachTag: rs.fn(async (input: { tagId: string; entityType: string; entityId: string }) => {
      await write("detachTag");
      db.links = db.links.filter(
        (l) =>
          !(
            l.tagId === input.tagId &&
            l.entityType === input.entityType &&
            l.entityId === input.entityId
          ),
      );
      calls.push("detachTag:done");
    }),
    listEntityTags: rs.fn(async (input: { entityType: string; entityId: string }) => ({
      tags: live(),
      links: db.links.filter(
        (l) => l.entityType === input.entityType && l.entityId === input.entityId,
      ),
    })),
  };
  return {
    db,
    api,
    calls,
    runtime: { tasks: api } as unknown as ModuoRuntime,
    hold() {
      const d = deferred();
      gate = d.promise;
      return () => {
        gate = null;
        d.release();
      };
    },
  };
}

/** One `useTasksModule`, as the Tasks, Calendar, Notes or Email page runs it. */
async function mountTasks(runtime: ModuoRuntime) {
  const hook = renderHook(() =>
    useTasksModule(runtime, { userId: "u1", workspaceId: WS, modulePermission: "edit" }),
  );
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

const names = (tags: { name: string }[] | undefined) => (tags ?? []).map((t) => t.name);

beforeEach(() => {
  resetTagStore();
  toastMock.mockClear();
  toastMock.error.mockClear();
});

afterEach(() => cleanup());

describe("T1-1 · one tag store feeds every surface", () => {
  it("a tag added on a task shows on every surface hosting it before the server answers", async () => {
    const server = fakeServer({ tasks: [task("t1")], tags: [tag("g1", "design")] });
    const tasksPage = await mountTasks(server.runtime);
    const calendarPage = await mountTasks(server.runtime);

    const release = server.hold();
    act(() => tasksPage.result.current.toggleTaskTag("t1", "g1"));

    expect(names(tasksPage.result.current.tagsByTask.get("t1"))).toEqual(["design"]);
    expect(names(calendarPage.result.current.tagsByTask.get("t1"))).toEqual(["design"]);
    expect(server.db.links).toHaveLength(0);

    await act(async () => release());
    await waitFor(() => expect(server.db.links).toHaveLength(1));
    expect(names(calendarPage.result.current.tagsByTask.get("t1"))).toEqual(["design"]);
    // Removing it, from the other surface, shows everywhere too.
    act(() => calendarPage.result.current.toggleTaskTag("t1", "g1"));
    expect(tasksPage.result.current.tagsByTask.get("t1")).toBeUndefined();
    await waitFor(() => expect(server.db.links).toHaveLength(0));
  });

  it("a save that fails takes the tag back off everywhere and says so", async () => {
    const server = fakeServer({ tasks: [task("t1")], tags: [tag("g1", "design")] });
    server.api.attachTag.mockRejectedValueOnce(new Error("offline"));
    const tasksPage = await mountTasks(server.runtime);
    const notesPage = await mountTasks(server.runtime);

    act(() => tasksPage.result.current.toggleTaskTag("t1", "g1"));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Couldn’t add the tag", {
        description: "offline",
      }),
    );
    expect(tasksPage.result.current.tagsByTask.get("t1")).toBeUndefined();
    expect(notesPage.result.current.tagsByTask.get("t1")).toBeUndefined();
  });

  it("a tag created on a note's tag row is in Tasks' picker at once; recolor and delete reach every surface", async () => {
    const server = fakeServer({ tasks: [task("t1")], tags: [tag("g1", "design")] });
    const tasksPage = await mountTasks(server.runtime);
    const noteRow = renderHook(() => useEntityTags(server.runtime, WS, { type: "note", id: "n1" }));
    await waitFor(() => expect(server.api.listEntityTags).toHaveBeenCalled());

    const release = server.hold();
    act(() => noteRow.result.current.create("Client"));
    expect(names(tasksPage.result.current.tags)).toEqual(["Client", "design"]);
    expect(names(noteRow.result.current.attached)).toEqual(["Client"]);
    await act(async () => release());
    await waitFor(() => expect(server.db.links).toHaveLength(1));
    const client = server.db.tags.find((t) => t.name === "Client") as Tag;

    act(() => tasksPage.result.current.setTagColor(client.id, "green"));
    expect(noteRow.result.current.attached[0]?.color).toBe("green");

    // Delete from the note's row: gone from Tasks at once; Undo brings it back.
    act(() => noteRow.result.current.remove(client.id));
    expect(names(tasksPage.result.current.tags)).toEqual(["design"]);
    const undoOpts = toastMock.mock.calls.at(-1)?.[1] as ToastOpts;
    act(() => undoOpts.action?.onClick());
    expect(names(tasksPage.result.current.tags)).toEqual(["Client", "design"]);
    expect(server.api.deleteTag).not.toHaveBeenCalled();

    // Deleted again and left to close: the server delete runs then.
    act(() => tasksPage.result.current.deleteTag(client.id));
    expect(names(noteRow.result.current.tags)).toEqual(["design"]);
    expect(noteRow.result.current.attached).toEqual([]);
    const commitOpts = toastMock.mock.calls.at(-1)?.[1] as ToastOpts;
    act(() => commitOpts.onAutoClose?.());
    await waitFor(() =>
      expect(server.api.deleteTag).toHaveBeenCalledWith({ workspaceId: WS, tagId: client.id }),
    );
  });
});

describe("reads seed the store", () => {
  const ctx = (server: ReturnType<typeof fakeServer>): TagContext => ({
    runtime: server.runtime,
    workspaceId: WS,
  });

  it("a read that started before a change was saved can't put it back; a newer one can", async () => {
    const server = fakeServer({ tags: [tag("g1", "design")] });
    seedTags(WS, { tags: server.db.tags, links: [], scope: { kind: "all" }, at: 1 });
    const before = Date.now() - 1;
    toggleTag(ctx(server), { entityType: "task", entityId: "t1" }, "g1");
    await waitFor(() => expect(server.db.links).toHaveLength(1));

    // An old snapshot without the link arrives late.
    seedTags(WS, { tags: server.db.tags, links: [], scope: { kind: "all" }, at: before });
    expect(names(tagsOf(getTagView(WS), { entityType: "task", entityId: "t1" }))).toEqual([
      "design",
    ]);

    // A teammate took it off since: a newer read shows that.
    seedTags(WS, { tags: server.db.tags, links: [], scope: { kind: "all" }, at: Date.now() + 1 });
    expect(tagsOf(getTagView(WS), { entityType: "task", entityId: "t1" })).toEqual([]);
  });

  it("a read replaces only the links it covered", () => {
    const tags = [tag("g1", "design")];
    seedTags(WS, {
      tags,
      links: [link("g1", "task", "t1"), link("g1", "note", "n1")],
      scope: { kind: "all" },
      at: 1,
    });
    seedTags(WS, {
      tags,
      links: [],
      scope: { kind: "entity", entityType: "note", entityId: "n1" },
      at: 2,
    });
    const view = getTagView(WS);
    expect(names(tagsOf(view, { entityType: "task", entityId: "t1" }))).toEqual(["design"]);
    expect(tagsOf(view, { entityType: "note", entityId: "n1" })).toEqual([]);
  });

  it("an older read of everything, arriving after a newer read of one item, keeps that item's links", async () => {
    const server = fakeServer({ tags: [tag("g1", "design")] });
    const note = { entityType: "note", entityId: "n1" };
    seedTags(WS, { tags: server.db.tags, links: [], scope: { kind: "all" }, at: 1 });
    const slowReadStarted = Date.now() - 1;
    toggleTag(ctx(server), note, "g1");
    await waitFor(() => expect(server.db.links).toHaveLength(1));
    // The hub re-reads the note (it has the link), then the slow read lands.
    seedTags(WS, {
      tags: server.db.tags,
      links: server.db.links,
      scope: { kind: "entity", ...note },
      at: Date.now() + 1,
    });
    seedTags(WS, { tags: server.db.tags, links: [], scope: { kind: "all" }, at: slowReadStarted });
    expect(names(tagsOf(getTagView(WS), note))).toEqual(["design"]);
  });

  it("a capped read refreshes tags and links but keeps what a full read of one item loaded", () => {
    seedTags(WS, {
      tags: [tag("g1", "design", "blue")],
      links: [link("g1", "task", "t2")],
      scope: { kind: "all" },
      at: 1,
    });
    seedTags(WS, {
      tags: [tag("g1", "design", "blue")],
      links: [link("g1", "note", "n1")],
      scope: { kind: "entity", entityType: "note", entityId: "n1" },
      at: 2,
    });
    // n1's link is past the cap; t2's was removed; t1's is new; the tag was recolored.
    seedTags(WS, {
      tags: [tag("g1", "design", "red")],
      links: [link("g1", "task", "t1")],
      scope: { kind: "all" },
      at: 3,
      complete: false,
    });
    const view = getTagView(WS);
    expect(names(tagsOf(view, { entityType: "note", entityId: "n1" }))).toEqual(["design"]);
    expect(names(tagsOf(view, { entityType: "task", entityId: "t1" }))).toEqual(["design"]);
    expect(tagsOf(view, { entityType: "task", entityId: "t2" })).toEqual([]);
    expect(view.tags[0]?.color).toBe("red");
  });

  it("a capped read that started before a tag came off can't put it back", async () => {
    const server = fakeServer({
      tags: [tag("g1", "design")],
      links: [link("g1", "note", "n1"), link("g1", "task", "t1")],
    });
    const note = { entityType: "note", entityId: "n1" };
    const task1 = { entityType: "task", entityId: "t1" };
    seedTags(WS, {
      tags: server.db.tags,
      links: server.db.links,
      scope: { kind: "entity", ...note },
      at: 1,
    });
    seedTags(WS, { tags: server.db.tags, links: server.db.links, scope: { kind: "all" }, at: 1 });
    const cappedReadStarted = Date.now() - 1;
    const staleLinks = [...server.db.links];
    toggleTag(ctx(server), note, "g1");
    toggleTag(ctx(server), task1, "g1");
    await waitFor(() => expect(server.db.links).toEqual([]));
    // The hub re-reads the note, then the slow capped read lands.
    seedTags(WS, {
      tags: server.db.tags,
      links: [],
      scope: { kind: "entity", ...note },
      at: Date.now() + 1,
    });
    seedTags(WS, {
      tags: server.db.tags,
      links: staleLinks,
      scope: { kind: "all" },
      at: cappedReadStarted,
      complete: false,
    });
    // Even once the saved ops have expired, nothing brings the tag back.
    const later = Date.now() + 11 * 60_000;
    const clock = rs.spyOn(Date, "now").mockReturnValue(later);
    seedTags(WS, {
      tags: server.db.tags,
      links: [],
      scope: { kind: "entity", entityType: "note", entityId: "n9" },
      at: later,
    });
    clock.mockRestore();
    expect(tagsOf(getTagView(WS), note)).toEqual([]);
    expect(tagsOf(getTagView(WS), task1)).toEqual([]);
  });

  it("a capped read that started after a tag came off shows a teammate putting it back", async () => {
    const server = fakeServer({ tags: [tag("g1", "design")], links: [link("g1", "task", "t1")] });
    const task1 = { entityType: "task", entityId: "t1" };
    seedTags(WS, { tags: server.db.tags, links: server.db.links, scope: { kind: "all" }, at: 1 });
    toggleTag(ctx(server), task1, "g1");
    await waitFor(() => expect(server.db.links).toEqual([]));
    server.db.links.push(link("g1", "task", "t1")); // a teammate tags it again
    seedTags(WS, {
      tags: server.db.tags,
      links: server.db.links,
      scope: { kind: "all" },
      at: Date.now() + 1,
      complete: false,
    });
    expect(names(tagsOf(getTagView(WS), task1))).toEqual(["design"]);
  });

  it("signing in as someone else starts from an empty store; the same person keeps it", () => {
    attachTagUser("u1");
    seedTags(WS, { tags: [tag("g1", "design")], links: [], scope: { kind: "all" }, at: 1 });
    attachTagUser("u1");
    expect(names(getTagView(WS).tags)).toEqual(["design"]);
    attachTagUser("u2");
    expect(getTagView(WS).tags).toEqual([]);
  });

  it("writes to the same tag on the same item reach the server in order", async () => {
    const server = fakeServer({ tags: [tag("g1", "design")] });
    seedTags(WS, { tags: server.db.tags, links: [], scope: { kind: "all" }, at: 1 });
    const release = server.hold();
    const entity = { entityType: "task", entityId: "t1" };
    toggleTag(ctx(server), entity, "g1");
    toggleTag(ctx(server), entity, "g1");
    expect(tagsOf(getTagView(WS), entity)).toEqual([]);
    await act(async () => release());
    await waitFor(() => expect(server.calls).toContain("detachTag:done"));
    expect(server.calls.indexOf("attachTag:done")).toBeLessThan(
      server.calls.indexOf("detachTag:start"),
    );
    expect(server.db.links).toEqual([]);
    expect(tagsOf(getTagView(WS), entity)).toEqual([]);
  });
});

describe("T1-2 · create-or-attach by name", () => {
  it("works before the task exists: the tag shows at once and attaches when the task is saved", async () => {
    const server = fakeServer({ tags: [tag("g1", "design")] });
    const tasksPage = await mountTasks(server.runtime);

    const release = server.hold();
    let created!: Promise<Task | null>;
    act(() => {
      created = tasksPage.result.current.createTask({ bucketId: "b1", title: "Brief" });
      tasksPage.result.current.createTagForTask("Launch", created);
    });
    expect(names(tasksPage.result.current.tags)).toEqual(["design", "Launch"]);
    expect(server.api.attachTag).not.toHaveBeenCalled();

    await act(async () => release());
    const saved = (await created) as Task;
    await waitFor(() => expect(server.db.links).toHaveLength(1));
    expect(server.db.links[0]).toMatchObject({ entityType: "task", entityId: saved.id });
    expect(names(tasksPage.result.current.tagsByTask.get(saved.id))).toEqual(["Launch"]);
  });

  it("attaches an existing tag of that name (any case) instead of making a second", async () => {
    const server = fakeServer({ tags: [tag("g1", "design")] });
    seedTags(WS, { tags: server.db.tags, links: [], scope: { kind: "all" }, at: 1 });
    const got = createOrAttachByName({ runtime: server.runtime, workspaceId: WS }, "  DESIGN ", {
      entityType: "task",
      entityId: Promise.resolve("t1"),
    });
    expect(got?.id).toBe("g1");
    await waitFor(() => expect(server.db.links).toHaveLength(1));
    expect(server.api.upsertTag).not.toHaveBeenCalled();
  });

  it("a new tag is attached only once its row exists", async () => {
    const server = fakeServer();
    seedTags(WS, { tags: [], links: [], scope: { kind: "all" }, at: 1 });
    const release = server.hold();
    const created = createOrAttachByName({ runtime: server.runtime, workspaceId: WS }, "urgent", {
      entityType: "task",
      entityId: "t1",
    });
    expect(names(tagsOf(getTagView(WS), { entityType: "task", entityId: "t1" }))).toEqual([
      "urgent",
    ]);
    await act(async () => release());
    await waitFor(() => expect(server.calls).toContain("attachTag:done"));
    expect(server.calls.indexOf("upsertTag:done")).toBeLessThan(
      server.calls.indexOf("attachTag:start"),
    );
    expect(server.db.links[0]?.tagId).toBe(created?.id);
  });

  it("a tag whose create fails isn't attached when its task is saved, and says so once", async () => {
    const server = fakeServer();
    server.api.upsertTag.mockRejectedValueOnce(new Error("offline"));
    seedTags(WS, { tags: [], links: [], scope: { kind: "all" }, at: 1 });
    let saveTask!: (id: string) => void;
    const taskId = new Promise<string | null>((resolve) => {
      saveTask = resolve;
    });
    createOrAttachByName({ runtime: server.runtime, workspaceId: WS }, "urgent", {
      entityType: "task",
      entityId: taskId,
    });
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(getTagView(WS).tags).toEqual([]);
    saveTask("t1");
    await act(async () => {
      await taskId;
    });
    expect(server.api.attachTag).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledTimes(1);
  });

  it("deleting a tag still being created waits for it; Undo before then keeps it", async () => {
    const server = fakeServer();
    seedTags(WS, { tags: [], links: [], scope: { kind: "all" }, at: 1 });
    const ctx = { runtime: server.runtime, workspaceId: WS };
    const release = server.hold();
    const made = createOrAttachByName(ctx, "later", { entityType: "task", entityId: "t1" }) as Tag;

    const lastToast = () => toastMock.mock.calls.at(-1)?.[1] as ToastOpts;
    deleteTag(ctx, made.id);
    expect(getTagView(WS).tags).toEqual([]);
    lastToast().action?.onClick();
    expect(names(getTagView(WS).tags)).toEqual(["later"]);

    deleteTag(ctx, made.id);
    lastToast().onAutoClose?.();
    await act(async () => release());
    await waitFor(() => expect(server.api.deleteTag).toHaveBeenCalledTimes(1));
    expect(server.calls.indexOf("upsertTag:done")).toBeLessThan(
      server.calls.indexOf("deleteTag:start"),
    );
    expect(getTagView(WS).tags).toEqual([]);
  });

  it("a tag made for a task that never got saved goes again", async () => {
    const server = fakeServer();
    seedTags(WS, { tags: [], links: [], scope: { kind: "all" }, at: 1 });
    const created = createOrAttachByName({ runtime: server.runtime, workspaceId: WS }, "draft", {
      entityType: "task",
      entityId: Promise.resolve(null),
    });
    await waitFor(() =>
      expect(server.api.deleteTag).toHaveBeenCalledWith({ workspaceId: WS, tagId: created?.id }),
    );
    expect(getTagView(WS).tags).toEqual([]);
    expect(server.api.attachTag).not.toHaveBeenCalled();
  });
});
