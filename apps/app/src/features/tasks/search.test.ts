// DF-1 — /tasks URL selection: param validation + pure inbound-target
// resolution (task id → select in its bucket scope; bucket/"project" id →
// scope only; unknown → none, so the page degrades without a crash).

import { describe, expect, it } from "@rstest/core";
import { taskLinkId } from "../../lib/task-handle";
import {
  descriptionWords,
  handleLinkStep,
  lookupHandleLink,
  resolveTasksDeepLink,
  takeSearchTokens,
  taskIdForHandle,
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
  });

  it("keeps a place the sidebar opens and drops any other", () => {
    const uuid = "9d1c3a7e-1111-4222-8333-444455556666";
    expect(validateTasksSearch({ place: "upcoming" })).toEqual({ place: "upcoming" });
    for (const place of ["inbox", "today", "mine", "all", "trash", uuid, `view:${uuid}`]) {
      expect(validateTasksSearch({ place })).toEqual({ place });
    }
    expect(validateTasksSearch({ place: `tmp-${uuid}` })).toEqual({ place: `tmp-${uuid}` });
    expect(validateTasksSearch({ place: "view:all" })).toEqual({});
    expect(validateTasksSearch({ place: `${uuid}'` })).toEqual({});
    // The task comes last, so the address bar ends with it (MOD-28).
    expect(Object.keys(validateTasksSearch({ id: "t1", place: "mine" }))).toEqual(["place", "id"]);
    expect(validateTasksSearch({ place: "settings" })).toEqual({});
    expect(validateTasksSearch({ place: 3 })).toEqual({});
    expect(validateTasksSearch({ id: 42 })).toEqual({});
    expect(validateTasksSearch({ id: ["a"] })).toEqual({});
  });

  it("drops unknown params", () => {
    expect(validateTasksSearch({ id: "t1", junk: "x" })).toEqual({ id: "t1" });
  });

  it("keeps a saved view's id (TV-U8), and only an id", () => {
    const id = "0b6a7c64-1111-4222-8333-944455556666";
    expect(validateTasksSearch({ view: id })).toEqual({ view: id });
    expect(validateTasksSearch({ id: "t1", view: id })).toEqual({ id: "t1", view: id });
    expect(validateTasksSearch({ view: "all" })).toEqual({});
    expect(validateTasksSearch({ view: `${id}'` })).toEqual({});
    expect(validateTasksSearch({ view: 7 })).toEqual({});
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

  it("finds a task by the key it was imported under (TV-D16, AC3.6)", () => {
    const imported = { ...task, importedFrom: { source: "linear", key: "ENG-123" } };
    expect(taskMatchesQuery(imported, "eng-123")).toBe(true);
    expect(taskMatchesQuery(imported, "ENG-123 capture")).toBe(true);
    expect(taskMatchesQuery(task, "ENG-123")).toBe(false);
  });

  it("finds a task by its own handle, however it's typed (MOD-126)", () => {
    const numbered = { ...task, number: 99 };
    for (const query of ["mod-99", "MOD-99", "Mod-99", "mod 99", "MOD-99 capture"]) {
      expect(taskMatchesQuery(numbered, query, "MOD")).toBe(true);
    }
    expect(taskMatchesQuery(numbered, "mod-98", "MOD")).toBe(false);
    expect(taskMatchesQuery(numbered, "eng-99", "MOD")).toBe(false);
    expect(taskMatchesQuery(numbered, "MOD-99 calendar", "MOD")).toBe(false);
    // No key (a workspace without one) or no number yet (unsaved): no handle.
    expect(taskMatchesQuery(numbered, "mod-99")).toBe(false);
    expect(taskMatchesQuery(task, "mod-99", "MOD")).toBe(false);
  });

  it("only a whole handle counts: its key or a digit alone doesn't find every task", () => {
    const seventeen = { ...task, number: 17 };
    expect(taskMatchesQuery(seventeen, "mod-1", "MOD")).toBe(false);
    expect(taskMatchesQuery(seventeen, "mod-170", "MOD")).toBe(false);
    expect(taskMatchesQuery(seventeen, "7", "MOD")).toBe(false);
    expect(taskMatchesQuery(seventeen, "mod 1", "MOD")).toBe(false);
    // "mod" alone is a word like any other: "Fix the Capture modal" has it.
    expect(taskMatchesQuery(seventeen, "mod", "MOD")).toBe(true);
    expect(taskMatchesQuery({ ...seventeen, title: "Plan Q3" }, "mod", "MOD")).toBe(false);
  });

  it("an empty query matches everything", () => {
    expect(taskMatchesQuery(task, "")).toBe(true);
    expect(taskMatchesQuery(task, "   ")).toBe(true);
  });

  it("reads a description's words, never its HTML", () => {
    const rich = {
      title: "Plan the offsite",
      description:
        '<p dir="ltr"><span style="white-space: pre-wrap;">Book the venue &amp; the bus</span></p>',
    };
    expect(taskMatchesQuery(rich, "venue")).toBe(true);
    expect(taskMatchesQuery(rich, "venue & bus")).toBe(true);
    for (const markup of ["span", "style", "pre-wrap", "dir", "ltr"]) {
      expect(taskMatchesQuery(rich, markup)).toBe(false);
    }
    // Plain text is read as it is, angle brackets included.
    expect(taskMatchesQuery({ title: "x", description: "a <b> c" }, "<b>")).toBe(true);
  });

  it("never matches the title an older reference chip stored (RF-1)", () => {
    const withChip = {
      title: "Weekly sync",
      description:
        '<p>See <span data-lexical-entity-ref="true" data-entity-type="task" data-entity-id="t1">Acquire Northwind</span> first</p>',
    };
    expect(taskMatchesQuery(withChip, "northwind")).toBe(false);
    expect(taskMatchesQuery(withChip, "first")).toBe(true);
  });

  it("reads a Markdown description's words, never its symbols or a reference's address (call #15)", () => {
    const md = {
      title: "Dogfood board",
      description:
        "**Adding an issue**\n- Put it in *Triage*\n- [x] snake_case `code`\n\nSee [task](moduo://task/11111111-1111-4111-8111-111111111111) by [Oct 17](moduo://date/2026-10-17), [the docs](https://example.com).",
    };
    expect(taskMatchesQuery(md, "adding issue")).toBe(true);
    expect(taskMatchesQuery(md, "triage snake_case code")).toBe(true);
    expect(taskMatchesQuery(md, "oct 17")).toBe(true);
    expect(taskMatchesQuery(md, "the docs")).toBe(true);
    for (const markup of ["**", "moduo", "11111111", "example.com", "[x]"]) {
      expect(taskMatchesQuery(md, markup)).toBe(false);
    }
  });

  it("finds the same words in a description whichever way it's stored", () => {
    const html = {
      title: "x",
      description:
        '<p class="mb-2 last:mb-0"><b><strong class="font-semibold" style="white-space: pre-wrap;">Book</strong></b><span style="white-space: pre-wrap;"> the venue</span></p>',
    };
    const markdown = { title: "x", description: "**Book** the venue" };
    for (const task of [html, markdown]) {
      expect(taskMatchesQuery(task, "book the venue")).toBe(true);
      expect(taskMatchesQuery(task, "strong")).toBe(false);
    }
    expect(descriptionWords(html.description).trim()).toBe(
      descriptionWords(markdown.description).trim(),
    );
  });
});

describe("taskIdForHandle — `?id=MOD-142` (RF-1)", () => {
  const tasks = [
    { id: "a", number: 142 },
    { id: "b", number: 7 },
  ];
  it("finds the loaded task by its number under the current key, any case", () => {
    expect(taskIdForHandle("MOD-142", tasks, "MOD")).toBe("a");
    expect(taskIdForHandle("mod-7", tasks, "MOD")).toBe("b");
  });
  it("leaves another key, an unknown number or no key to the server", () => {
    expect(taskIdForHandle("ML-142", tasks, "MOD")).toBeNull();
    expect(taskIdForHandle("MOD-9", tasks, "MOD")).toBeNull();
    expect(taskIdForHandle("MOD-142", tasks, null)).toBeNull();
  });
  it("reads a space as the hyphen, as typed in ⌘K (MOD-144)", () => {
    expect(taskIdForHandle("mod 142", tasks, "MOD")).toBe("a");
    expect(taskIdForHandle(" MOD  7 ", tasks, "MOD")).toBe("b");
    // A key alone, a number alone or more words name no task.
    expect(taskIdForHandle("mod", tasks, "MOD")).toBeNull();
    expect(taskIdForHandle("142", tasks, "MOD")).toBeNull();
    expect(taskIdForHandle("mod 142 copy", tasks, "MOD")).toBeNull();
  });
});

describe("a task link, either form (MOD-28)", () => {
  const tasks = [
    { id: "f2968388-7a0f-4cd7-9d01-7b9242ebc1ce", number: 142, bucketId: "p1" },
    { id: "b", number: 7, bucketId: "inbox" },
  ];
  const ctx = { tasks, buckets: [{ id: "p1" }], inboxId: "inbox" };
  it("what the app writes (the handle) and an old link (the id) open the same task", () => {
    const written = taskLinkId("MOD", tasks[0]);
    expect(written).toBe("MOD-142");
    const fromHandle = taskIdForHandle(written, tasks, "MOD");
    expect(fromHandle).toBe(tasks[0].id);
    const viaHandle = resolveTasksDeepLink(fromHandle as string, ctx);
    const viaId = resolveTasksDeepLink(tasks[0].id, ctx);
    expect(viaHandle).toEqual({ kind: "task", taskId: tasks[0].id, scope: "p1" });
    expect(viaId).toEqual(viaHandle);
  });
  it("a task without a number yet is linked, and opened, by its id", () => {
    const fresh = { id: "tmp-1", number: null, bucketId: "inbox" };
    expect(taskLinkId("MOD", fresh)).toBe("tmp-1");
    expect(resolveTasksDeepLink("tmp-1", { ...ctx, tasks: [...tasks, fresh] })).toEqual({
      kind: "task",
      taskId: "tmp-1",
      scope: "inbox",
    });
  });
});

describe("a handle link on refresh, back or forward (MOD-28)", () => {
  const live = [{ id: "open", number: 1 }];
  const archived = { id: "arch", number: 2 };
  const done = { id: "done", number: 3 };
  it("opens a loaded task at once, an archived project's too", () => {
    const tasks = [...live, archived];
    expect(handleLinkStep("MOD-1", { tasks, taskKey: "MOD", restLoaded: false })).toEqual({
      kind: "task",
      taskId: "open",
    });
    expect(handleLinkStep("MOD-2", { tasks, taskKey: "MOD", restLoaded: false })).toEqual({
      kind: "task",
      taskId: "arch",
    });
  });
  it("waits for Done, Won't do and Backlog tasks before asking the server", () => {
    expect(handleLinkStep("MOD-3", { tasks: live, taskKey: "MOD", restLoaded: false })).toEqual({
      kind: "wait",
    });
    // Loaded now: the Done task opens here, no lookup.
    expect(
      handleLinkStep("MOD-3", { tasks: [...live, done], taskKey: "MOD", restLoaded: true }),
    ).toEqual({ kind: "task", taskId: "done" });
    // Still not here (an old key, a task not loaded): only then the server.
    expect(handleLinkStep("ML-3", { tasks: live, taskKey: "MOD", restLoaded: true })).toEqual({
      kind: "lookup",
    });
  });
  it("tells the server's 'no such task' from a lookup that couldn't answer (offline)", async () => {
    expect(await lookupHandleLink("MOD-9", async () => "t9")).toEqual({
      kind: "task",
      taskId: "t9",
    });
    expect(await lookupHandleLink("MOD-9", async () => null)).toEqual({ kind: "gone" });
    const offline = async (): Promise<string | null> => {
      throw new TypeError("Failed to fetch");
    };
    expect(await lookupHandleLink("MOD-9", offline)).toEqual({ kind: "failed" });
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
