// DF-1 — /tasks URL selection: param validation + pure inbound-target
// resolution (task id → select in its bucket scope; bucket/"project" id →
// scope only; unknown → none, so the page degrades without a crash).

import { describe, expect, it } from "@rstest/core";
import {
  resolveTasksDeepLink,
  takeSearchTokens,
  taskMatchesQuery,
  validateTasksSearch,
} from "./search";

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

  it("handles a missing inbox (no crash on a fresh workspace)", () => {
    expect(
      resolveTasksDeepLink("t1", { tasks: ctx.tasks, buckets: ctx.buckets, inboxId: null }),
    ).toEqual({ kind: "task", taskId: "t1", scope: "b1" });
  });
});

// TV-U2 · U2-4 — `/` search over title + description; `#tag` and `@name`
// become filter chips.
describe("taskMatchesQuery", () => {
  const task = { title: "Fix the Capture modal", description: "Assignee picker is too big" };

  it("matches the title or the description, ignoring case", () => {
    expect(taskMatchesQuery(task, "capture")).toBe(true);
    expect(taskMatchesQuery(task, "PICKER")).toBe(true);
    expect(taskMatchesQuery(task, "calendar")).toBe(false);
  });

  it("needs every word, wherever it is", () => {
    expect(taskMatchesQuery(task, "modal big")).toBe(true);
    expect(taskMatchesQuery(task, "modal small")).toBe(false);
  });

  it("an empty query matches everything", () => {
    expect(taskMatchesQuery(task, "")).toBe(true);
    expect(taskMatchesQuery(task, "   ")).toBe(true);
  });
});

describe("takeSearchTokens", () => {
  const ctx = {
    tags: [
      { id: "t1", name: "design" },
      { id: "t2", name: "Bug" },
      { id: "t3", name: "backend" },
    ],
    people: [
      { userId: "u1", name: "Me", isMe: true },
      { userId: "u2", name: "Mike Grochowski" },
      { userId: "u3", name: "Ola" },
    ],
  };

  it("a finished #tag word becomes a Tag value and leaves the query", () => {
    expect(takeSearchTokens("modal #design ", ctx)).toEqual({
      query: "modal ",
      tokens: [{ dimension: "tag", value: "t1" }],
    });
    expect(takeSearchTokens("#bug ", ctx)).toEqual({
      query: "",
      tokens: [{ dimension: "tag", value: "t2" }],
    });
  });

  it("waits while the word is still being typed; Enter finishes it", () => {
    expect(takeSearchTokens("#des", ctx)).toEqual({ query: "#des", tokens: [] });
    expect(takeSearchTokens("fix #des", ctx, true)).toEqual({
      query: "fix",
      tokens: [{ dimension: "tag", value: "t1" }],
    });
  });

  it("@name becomes an Assignee value: @me, a first name, a unique prefix", () => {
    expect(takeSearchTokens("@me ", ctx).tokens).toEqual([{ dimension: "assignee", value: "u1" }]);
    expect(takeSearchTokens("@mike ", ctx).tokens).toEqual([
      { dimension: "assignee", value: "u2" },
    ]);
    expect(takeSearchTokens("@ol ", ctx).tokens).toEqual([{ dimension: "assignee", value: "u3" }]);
  });

  it("several at once", () => {
    expect(takeSearchTokens("#design @ola notes ", ctx)).toEqual({
      query: "notes ",
      tokens: [
        { dimension: "tag", value: "t1" },
        { dimension: "assignee", value: "u3" },
      ],
    });
  });

  it("no match, or more than one, stays text; so do #123 and C#", () => {
    expect(takeSearchTokens("#b ", ctx)).toEqual({ query: "#b ", tokens: [] });
    expect(takeSearchTokens("#123 ", ctx)).toEqual({ query: "#123 ", tokens: [] });
    expect(takeSearchTokens("C# ", ctx)).toEqual({ query: "C# ", tokens: [] });
    expect(takeSearchTokens("@nobody ", ctx)).toEqual({ query: "@nobody ", tokens: [] });
  });
});
