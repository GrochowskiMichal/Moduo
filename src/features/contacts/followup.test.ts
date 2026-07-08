// AC4 proof: "Add follow-up" builds an ordinary task + a follow-up link — never a
// new "deal" object. (The two writes themselves are the page's job; here we prove
// the shapes.)

import { describe, expect, it } from "vitest";

import { buildFollowupTask, followupLinkArgs, followupTitle } from "./followup";
import type { EntityRef } from "../../lib/entity-links";

describe("followupTitle", () => {
  it("names the contact, with a bare fallback", () => {
    expect(followupTitle("Dana Lee")).toBe("Follow up with Dana Lee");
    expect(followupTitle("  ")).toBe("Follow up");
  });
});

describe("buildFollowupTask", () => {
  it("is a plain todo task in the given bucket — no deal fields, backend-minted id", () => {
    const task = buildFollowupTask({
      workspaceId: "w",
      bucketId: "inbox",
      contactName: "Dana Lee",
      dueDate: "2026-07-01",
    });
    expect(task.title).toBe("Follow up with Dana Lee");
    expect(task.status).toBe("todo");
    expect(task.bucketId).toBe("inbox");
    expect(task.dueDate).toBe("2026-07-01");
    expect(task.id).toBe(""); // runtime mints it on upsert
    expect(task.position).not.toBe(""); // a valid order key
  });

  it("defaults a missing due date to null", () => {
    expect(buildFollowupTask({ workspaceId: "w", bucketId: "inbox", contactName: "X" }).dueDate).toBeNull();
  });
});

describe("followupLinkArgs", () => {
  it("links the task back to the contact as a follow-up", () => {
    const contact: EntityRef = { type: "contact", id: "c1" };
    expect(followupLinkArgs(contact, "t1")).toEqual({
      contact,
      target: { type: "task", id: "t1" },
      relationKind: "follow-up",
      origin: "manual",
    });
  });
});
