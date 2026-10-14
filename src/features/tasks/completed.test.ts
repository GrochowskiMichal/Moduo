// TV-U1 · U1-3 — completed tasks hidden by default, "N completed" counts,
// the 7-day window, and a just-checked task staying in place.

import { describe, expect, it } from "@rstest/core";
import {
  completedLabel,
  completedWithin,
  type JustCompleted,
  partitionCompleted,
  trackJustCompleted,
  trackOpened,
} from "./completed";
import type { TaskStatus } from "./model";

const NOW = new Date("2026-10-09T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

type T = { id: string; status: TaskStatus; updatedAt: string };
const t = (id: string, status: TaskStatus = "todo", updatedAt = daysAgo(0)): T => ({
  id,
  status,
  updatedAt,
});

const never = () => false;

describe("partitionCompleted", () => {
  const tasks = [
    t("open"),
    t("doing", "in_progress"),
    t("done-today", "done", daysAgo(0)),
    t("done-6d", "done", daysAgo(6)),
    t("done-8d", "done", daysAgo(8)),
  ];
  const ids = (list: T[]) => list.map((x) => x.id);

  it("hides every completed task by default and keeps the order of the rest", () => {
    const { shown, hidden } = partitionCompleted(tasks, { mode: "hidden", now: NOW, keep: never });
    expect(ids(shown)).toEqual(["open", "doing"]);
    expect(ids(hidden)).toEqual(["done-today", "done-6d", "done-8d"]);
  });

  it('"7 days" keeps the ones completed within the week', () => {
    const { shown, hidden } = partitionCompleted(tasks, { mode: "week", now: NOW, keep: never });
    expect(ids(shown)).toEqual(["open", "doing", "done-today", "done-6d"]);
    expect(ids(hidden)).toEqual(["done-8d"]);
  });

  it('"All" hides nothing', () => {
    const { shown, hidden } = partitionCompleted(tasks, { mode: "all", now: NOW, keep: never });
    expect(ids(shown)).toEqual(ids(tasks));
    expect(hidden).toEqual([]);
  });

  it("keeps a done task the caller names (just checked off, a parent with open subtasks)", () => {
    const { shown, hidden } = partitionCompleted(tasks, {
      mode: "hidden",
      now: NOW,
      keep: (x) => x.id === "done-8d",
    });
    expect(ids(shown)).toEqual(["open", "doing", "done-8d"]);
    expect(ids(hidden)).toEqual(["done-today", "done-6d"]);
  });

  it("the line reads like the comp", () => {
    expect(completedLabel(5)).toBe("5 completed");
  });
});

describe("completedWithin", () => {
  it("measures from the last update (completion time isn't stored)", () => {
    expect(completedWithin(t("a", "done", daysAgo(7)), NOW, 7)).toBe(true);
    expect(completedWithin(t("a", "done", daysAgo(7.01)), NOW, 7)).toBe(false);
    expect(completedWithin(t("a", "done", "not a date"), NOW, 7)).toBe(false);
  });
});

describe("trackJustCompleted (a checked-off task stays until the scope changes)", () => {
  it("starts empty, and a task already done when the scope opens isn't 'just' completed", () => {
    const r = trackJustCompleted(null, "inbox", [t("a"), t("b", "done")]);
    expect([...r.ids]).toEqual([]);
  });

  it("records a task seen open and then done", () => {
    let r = trackJustCompleted(null, "inbox", [t("a"), t("b")]);
    r = trackJustCompleted(r, "inbox", [t("a", "done"), t("b")]);
    expect([...r.ids]).toEqual(["a"]);
  });

  it("returns the same record when nothing changed (safe to store during render)", () => {
    const first = trackJustCompleted(null, "inbox", [t("a")]);
    expect(trackJustCompleted(first, "inbox", [t("a")])).toBe(first);
  });

  it("a task that arrives already done (loaded later, a teammate's) isn't kept", () => {
    let r = trackJustCompleted(null, "inbox", []);
    r = trackJustCompleted(r, "inbox", [t("late", "done")]);
    expect([...r.ids]).toEqual([]);
  });

  it("keeps it through a reopen-and-done again, and forgets everything on a scope change", () => {
    let r: JustCompleted = trackJustCompleted(null, "inbox", [t("a")]);
    r = trackJustCompleted(r, "inbox", [t("a", "done")]);
    r = trackJustCompleted(r, "inbox", [t("a")]);
    r = trackJustCompleted(r, "inbox", [t("a", "done")]);
    expect([...r.ids]).toEqual(["a"]);
    r = trackJustCompleted(r, "bucket-2", [t("a", "done")]);
    expect([...r.ids]).toEqual([]);
  });
});

describe("trackOpened (a task opened here stays until the scope changes)", () => {
  it("records the selected task and its parent, and keeps them as the selection moves", () => {
    let r = trackOpened(null, "inbox", { id: "c", parentId: "p" });
    expect([...r.ids].sort()).toEqual(["c", "p"]);
    r = trackOpened(r, "inbox", { id: "a", parentId: null });
    expect([...r.ids].sort()).toEqual(["a", "c", "p"]);
    r = trackOpened(r, "inbox", null);
    expect(r.ids.has("c")).toBe(true);
  });

  it("returns the same record when nothing new was opened", () => {
    const r = trackOpened(null, "inbox", { id: "a", parentId: null });
    expect(trackOpened(r, "inbox", { id: "a", parentId: null })).toBe(r);
    expect(trackOpened(r, "inbox", null)).toBe(r);
  });

  it("starts over in a new scope", () => {
    const r = trackOpened(null, "inbox", { id: "a", parentId: null });
    expect([...trackOpened(r, "b2", null).ids]).toEqual([]);
  });
});
