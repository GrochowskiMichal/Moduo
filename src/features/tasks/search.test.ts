// DF-1 — /tasks URL selection: param validation + pure inbound-target
// resolution (task id → select in its bucket scope; bucket/"project" id →
// scope only; unknown → none, so the page degrades without a crash).

import { describe, expect, it } from "@rstest/core";
import { resolveTasksDeepLink, validateTasksSearch } from "./search";

describe("validateTasksSearch", () => {
  it("keeps a non-empty string id", () => {
    expect(validateTasksSearch({ id: "t1" })).toEqual({ id: "t1" });
  });

  it("drops an empty, missing, or non-string id", () => {
    expect(validateTasksSearch({})).toEqual({});
    expect(validateTasksSearch({ id: "" })).toEqual({});
    expect(validateTasksSearch({ id: 42 })).toEqual({});
    expect(validateTasksSearch({ id: ["a"] })).toEqual({});
  });

  it("drops unknown params", () => {
    expect(validateTasksSearch({ id: "t1", junk: "x" })).toEqual({ id: "t1" });
  });
});

describe("resolveTasksDeepLink", () => {
  const inboxId = "b-inbox";
  const ctx = {
    tasks: [
      { id: "t1", bucketId: "b1" },
      { id: "t2", bucketId: inboxId },
      { id: "sub1", bucketId: "b1" },
    ],
    buckets: [{ id: "b1" }, { id: "b2" }],
    inboxId,
  };

  it("resolves a task id to the task, scoped to its bucket", () => {
    expect(resolveTasksDeepLink("t1", ctx)).toEqual({
      kind: "task",
      taskId: "t1",
      scope: "b1",
    });
  });

  it("normalizes an Inbox task's scope to the 'inbox' alias", () => {
    expect(resolveTasksDeepLink("t2", ctx)).toEqual({
      kind: "task",
      taskId: "t2",
      scope: "inbox",
    });
  });

  it("resolves a bucket id (a 'project' deep link) to a scope-only target", () => {
    expect(resolveTasksDeepLink("b2", ctx)).toEqual({ kind: "bucket", scope: "b2" });
    expect(resolveTasksDeepLink(inboxId, ctx)).toEqual({ kind: "bucket", scope: "inbox" });
  });

  it("resolves an unknown/stale id to none (graceful degrade, AC)", () => {
    expect(resolveTasksDeepLink("nope", ctx)).toEqual({ kind: "none" });
  });

  it("a task in a project you can't see opens in All, never Inbox (TV-P0, AC1.10)", () => {
    const withPrivate = {
      ...ctx,
      tasks: [...ctx.tasks, { id: "assigned-to-me", bucketId: "b-someone-elses" }],
    };
    expect(resolveTasksDeepLink("assigned-to-me", withPrivate)).toEqual({
      kind: "task",
      taskId: "assigned-to-me",
      scope: "all",
    });
  });

  it("handles a missing inbox (no crash on a fresh workspace)", () => {
    expect(
      resolveTasksDeepLink("t1", { tasks: ctx.tasks, buckets: ctx.buckets, inboxId: null }),
    ).toEqual({ kind: "task", taskId: "t1", scope: "b1" });
  });
});
