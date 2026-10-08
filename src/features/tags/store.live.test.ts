import { beforeEach, describe, expect, it, rs } from "@rstest/core";

rs.mock("sonner", () => ({ toast: Object.assign(rs.fn(), { error: rs.fn() }) }));

import type { ModuoRuntime } from "../../lib/runtime.types";
import type { LiveChange } from "../tasks/live";
import type { Tag, TagLink } from "../tasks/model";
import { applyLiveTags, getTagView, resetTagStore, seedTags, tagsOf, toggleTag } from "./store";

// TV-D5 (D5-1, D5-2) in the workspace tag store: a teammate's tag and link
// changes show up; my own pending tag write is never flicked back by a change.

const WS = "ws-live";
const TASK = { entityType: "task", entityId: "t1" };

function tag(over: Partial<Tag> = {}): Tag {
  return {
    id: "g1",
    workspaceId: WS,
    ownerId: "u1",
    name: "Ops",
    color: "blue",
    createdAt: "2026-10-08T10:00:00Z",
    updatedAt: "2026-10-08T10:00:00Z",
    deletedAt: null,
    ...over,
  };
}

function link(over: Partial<TagLink> = {}): TagLink {
  return {
    id: "l1",
    workspaceId: WS,
    tagId: "g1",
    entityType: "task",
    entityId: "t1",
    createdAt: "2026-10-08T10:00:00Z",
    ...over,
  };
}

const upTag = (t: Tag): LiveChange => ({ table: "tags", kind: "upsert", row: t });
const upLink = (l: TagLink): LiveChange => ({ table: "tag_links", kind: "upsert", row: l });

function seed(tags: Tag[], links: TagLink[] = []) {
  seedTags(WS, { tags, links, scope: { kind: "all" }, at: Date.now() });
}

describe("applyLiveTags", () => {
  beforeEach(() => {
    resetTagStore();
  });

  it("does nothing before the workspace's first read", () => {
    applyLiveTags(WS, [upTag(tag())]);
    expect(getTagView(WS).tags).toEqual([]);
  });

  it("shows a teammate's new tag, rename, link and unlink", () => {
    seed([]);
    applyLiveTags(WS, [upTag(tag()), upLink(link())]);
    expect(tagsOf(getTagView(WS), TASK).map((t) => t.name)).toEqual(["Ops"]);

    applyLiveTags(WS, [upTag(tag({ name: "Ops 2", updatedAt: "2026-10-08T10:00:05Z" }))]);
    expect(getTagView(WS).tags.map((t) => t.name)).toEqual(["Ops 2"]);
    // An older version (a late echo) doesn't win.
    applyLiveTags(WS, [upTag(tag({ name: "Ops", updatedAt: "2026-10-08T10:00:01Z" }))]);
    expect(getTagView(WS).tags.map((t) => t.name)).toEqual(["Ops 2"]);

    applyLiveTags(WS, [{ table: "tag_links", kind: "delete", id: "l1" }]);
    expect(tagsOf(getTagView(WS), TASK)).toEqual([]);

    applyLiveTags(WS, [
      upTag(tag({ deletedAt: "2026-10-08T10:01:00Z", updatedAt: "2026-10-08T10:01:00Z" })),
    ]);
    expect(getTagView(WS).tags).toEqual([]);
  });

  it("never lets a change undo my tag write while it is still saving", async () => {
    seed([tag()]);
    let finish!: (l: TagLink) => void;
    const runtime = {
      tasks: {
        attachTag: () =>
          new Promise<TagLink>((r) => {
            finish = r;
          }),
      },
    } as unknown as ModuoRuntime;
    toggleTag({ runtime, workspaceId: WS }, TASK, "g1");
    expect(tagsOf(getTagView(WS), TASK).map((t) => t.id)).toEqual(["g1"]);

    // An unrelated delete for an id we don't hold changes nothing visible.
    applyLiveTags(WS, [{ table: "tag_links", kind: "delete", id: "someone-elses" }]);
    expect(tagsOf(getTagView(WS), TASK).map((t) => t.id)).toEqual(["g1"]);

    // The attach saves; its echo then lands and the link stays.
    await new Promise((r) => setTimeout(r, 0));
    finish(link({ id: "l9" }));
    await new Promise((r) => setTimeout(r, 0));
    applyLiveTags(WS, [upLink(link({ id: "l9" }))]);
    expect(tagsOf(getTagView(WS), TASK).map((t) => t.id)).toEqual(["g1"]);

    // A teammate removes it afterwards: the saved op gives way.
    applyLiveTags(WS, [{ table: "tag_links", kind: "delete", id: "l9" }]);
    expect(tagsOf(getTagView(WS), TASK)).toEqual([]);
  });
});

/** Let the clock move on a little (stamps are compared by Date.now()). */
const tick = () => new Promise((r) => setTimeout(r, 3));

describe("applyLiveTags against reads in flight", () => {
  beforeEach(() => {
    resetTagStore();
  });

  it("an older read can't take back my saved attach once its echo landed", async () => {
    seed([tag()]);
    await tick();
    const hubReadStarted = Date.now();
    await tick();
    let finish!: (l: TagLink) => void;
    const runtime = {
      tasks: {
        attachTag: () =>
          new Promise<TagLink>((r) => {
            finish = r;
          }),
      },
    } as unknown as ModuoRuntime;
    toggleTag({ runtime, workspaceId: WS }, TASK, "g1");
    await new Promise((r) => setTimeout(r, 0));
    finish(link({ id: "l9" }));
    await new Promise((r) => setTimeout(r, 0));
    applyLiveTags(WS, [upLink(link({ id: "l9" }))]);
    // The hub read for t1 started before all that and lands now, without the link.
    seedTags(WS, {
      tags: [tag()],
      links: [],
      scope: { kind: "entity", ...TASK },
      at: hubReadStarted,
    });
    expect(tagsOf(getTagView(WS), TASK).map((t) => t.id)).toEqual(["g1"]);
  });

  it("an older read can't put back what a teammate changed live", async () => {
    seed([tag()], [link()]);
    await tick();
    const readStarted = Date.now();
    await tick();
    applyLiveTags(WS, [
      { table: "tag_links", kind: "delete", id: "l1" },
      upTag(tag({ name: "Renamed", updatedAt: "2026-10-08T10:00:09Z" })),
      upTag(tag({ id: "g2", name: "New" })),
    ]);
    seedTags(WS, { tags: [tag()], links: [link()], scope: { kind: "all" }, at: readStarted });
    const view = getTagView(WS);
    expect(tagsOf(view, TASK)).toEqual([]);
    expect(view.tags.map((t) => t.name)).toEqual(["New", "Renamed"]);
  });

  it("a read that started after the change replaces it as usual", () => {
    seed([tag()], [link()]);
    applyLiveTags(WS, [{ table: "tag_links", kind: "delete", id: "l1" }]);
    seedTags(WS, {
      tags: [tag()],
      links: [link({ id: "l2" })],
      scope: { kind: "all" },
      at: Date.now() + 1,
    });
    expect(tagsOf(getTagView(WS), TASK).map((t) => t.id)).toEqual(["g1"]);
  });
});
