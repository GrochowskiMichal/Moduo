import { describe, expect, it, vi } from "vitest";
import type { EntityLink, EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import {
  persistMention,
  refCommandType,
  REF_COMMAND_NAMES,
  resolveMentionAction,
  triggerRelation,
  type MentionAction,
} from "./mention";

const FOCUS: EntityRef = { type: "note", id: "n1" };
const TASK: EntityRef = { type: "task", id: "t1" };

function fakeLink(over: Partial<EntityLink> = {}): EntityLink {
  return {
    id: "l1",
    workspaceId: "w1",
    sourceType: FOCUS.type,
    sourceId: FOCUS.id,
    targetType: TASK.type,
    targetId: TASK.id,
    relationKind: "mentions",
    origin: "mention",
    createdBy: "u1",
    createdAt: "2026-06-26T00:00:00Z",
    deletedAt: null,
    ...over,
  };
}

/** A runtime whose `spine.createLink` is a spy; everything else throws if touched. */
function runtimeWithCreateLink(impl = vi.fn(async () => fakeLink())) {
  return {
    spine: { createLink: impl },
  } as unknown as ModuoRuntime & { spine: { createLink: typeof impl } };
}

describe("triggerRelation", () => {
  it("maps @ to mentions/mention and /ref to references/ref (AC8)", () => {
    expect(triggerRelation("mention")).toEqual({ relationKind: "mentions", origin: "mention" });
    expect(triggerRelation("ref")).toEqual({ relationKind: "references", origin: "ref" });
  });
});

describe("refCommandType", () => {
  it("scopes /task /note /contact to their entity types, case-insensitively", () => {
    expect(refCommandType("task")).toBe("task");
    expect(refCommandType("NOTE")).toBe("note");
    expect(refCommandType("contact")).toBe("contact");
    expect(REF_COMMAND_NAMES).toEqual(["task", "note", "contact"]);
  });

  it("returns null for an unknown command", () => {
    expect(refCommandType("bogus")).toBeNull();
  });
});

describe("resolveMentionAction — @ vs /ref vs person branch (AC8)", () => {
  it("@ on an entity → link-entity with kind=mentions, origin=mention", () => {
    const action = resolveMentionAction("mention", {
      kind: "entity",
      ref: TASK,
      label: "Ship CT-4",
      icon: null,
    });
    expect(action).toEqual<MentionAction>({
      type: "link-entity",
      ref: TASK,
      label: "Ship CT-4",
      icon: null,
      relationKind: "mentions",
      origin: "mention",
    });
  });

  it("/ref on an entity → link-entity with kind=references, origin=ref", () => {
    const action = resolveMentionAction("ref", {
      kind: "entity",
      ref: TASK,
      label: "Ship CT-4",
    });
    expect(action).toMatchObject({
      type: "link-entity",
      relationKind: "references",
      origin: "ref",
      icon: null,
    });
  });

  it("a person pick → mention-person, regardless of trigger", () => {
    const pick = { kind: "person", userId: "u9", name: "Ada" } as const;
    expect(resolveMentionAction("mention", pick)).toEqual({
      type: "mention-person",
      userId: "u9",
      name: "Ada",
    });
    // Even if reached via a /ref surface, a person is never a link target.
    expect(resolveMentionAction("ref", pick)).toEqual({
      type: "mention-person",
      userId: "u9",
      name: "Ada",
    });
  });

  it("a no-match create pick → create-and-link carrying the trigger's kind", () => {
    expect(
      resolveMentionAction("ref", { kind: "create", entityType: "task", label: "Foo" }),
    ).toEqual({
      type: "create-and-link",
      entityType: "task",
      label: "Foo",
      relationKind: "references",
      origin: "ref",
    });
    expect(
      resolveMentionAction("mention", { kind: "create", entityType: "task", label: "Foo" }),
    ).toMatchObject({ type: "create-and-link", relationKind: "mentions", origin: "mention" });
  });
});

describe("persistMention", () => {
  it("link-entity writes focus → target with the kind/origin + seeds the registry label", async () => {
    const createLink = vi.fn(async () => fakeLink());
    const runtime = runtimeWithCreateLink(createLink);
    const result = await persistMention({
      runtime,
      workspaceId: "w1",
      focus: FOCUS,
      action: {
        type: "link-entity",
        ref: TASK,
        label: "Ship CT-4",
        icon: "task",
        relationKind: "mentions",
        origin: "mention",
      },
    });

    expect(createLink).toHaveBeenCalledWith({
      workspaceId: "w1",
      source: FOCUS,
      target: TASK,
      relationKind: "mentions",
      origin: "mention",
      targetLabel: "Ship CT-4",
      targetIcon: "task",
    });
    expect(result).toMatchObject({ kind: "entity", ref: TASK, link: { id: "l1" } });
  });

  it("create-and-link creates the entity first, then links it (no-match path)", async () => {
    const created: EntityRef = { type: "task", id: "new-task" };
    const createEntity = vi.fn(async () => created);
    const createLink = vi.fn(async () => fakeLink({ targetId: "new-task", relationKind: "references" }));
    const runtime = runtimeWithCreateLink(createLink);

    const result = await persistMention({
      runtime,
      workspaceId: "w1",
      focus: FOCUS,
      action: {
        type: "create-and-link",
        entityType: "task",
        label: "Foo",
        relationKind: "references",
        origin: "ref",
      },
      createEntity,
    });

    expect(createEntity).toHaveBeenCalledWith("task", "Foo");
    expect(createLink).toHaveBeenCalledWith(
      expect.objectContaining({ source: FOCUS, target: created, relationKind: "references", origin: "ref" }),
    );
    expect(result).toMatchObject({ kind: "entity", ref: created });
  });

  it("create-and-link without a creator rejects rather than writing a dangling link", async () => {
    const createLink = vi.fn(async () => fakeLink());
    const runtime = runtimeWithCreateLink(createLink);
    await expect(
      persistMention({
        runtime,
        workspaceId: "w1",
        focus: FOCUS,
        action: {
          type: "create-and-link",
          entityType: "task",
          label: "Foo",
          relationKind: "references",
          origin: "ref",
        },
      }),
    ).rejects.toThrow(/no creator/i);
    expect(createLink).not.toHaveBeenCalled();
  });

  it("mention-person routes to the person handler and writes no link", async () => {
    const onMentionPerson = vi.fn(async () => {});
    const createLink = vi.fn(async () => fakeLink());
    const runtime = runtimeWithCreateLink(createLink);

    const result = await persistMention({
      runtime,
      workspaceId: "w1",
      focus: FOCUS,
      action: { type: "mention-person", userId: "u9", name: "Ada" },
      onMentionPerson,
    });

    expect(onMentionPerson).toHaveBeenCalledWith("u9", "Ada");
    expect(createLink).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "person", userId: "u9", name: "Ada" });
  });
});
