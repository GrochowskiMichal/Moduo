// TV-U2 · U2-1/U2-2/U2-4/U2-5 — the Tasks toolbar's Filter and search on the
// real pieces: the Filter button's count badge and the sentence chips with
// "N of M · Clear"; `/` search over title + description, where `#tag` and
// `@name` turn into chips; the `/` and `f` keys; and what New pre-fills.

import { afterEach, beforeAll, describe, expect, it } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { FilterCondition } from "../../../components/ui/filter-model";
import { TooltipProvider } from "../../../components/ui/tooltip";
import type { Assignee } from "../assignees";
import { makeTask } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Tag, Task } from "../model";
import { useTasksFilters } from "./use-tasks-filters";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(cleanup);

function task(id: string, title: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "b1", title, position: id }),
    id,
    assigneeId: "u1",
    ...over,
  };
}

const TAGS: Tag[] = [
  {
    id: "t1",
    workspaceId: "w1",
    ownerId: "u1",
    name: "design",
    color: "blue",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  },
];
const ASSIGNEES: Assignee[] = [
  { userId: "u1", name: "Me", fullName: "Me", avatarUrl: null, isMe: true, canTakeTasks: true },
  {
    userId: "u2",
    name: "Mike",
    fullName: "Mike",
    avatarUrl: null,
    isMe: false,
    canTakeTasks: true,
  },
];
const TASKS = [
  task("a", "Toolbar polish", { description: "one control language", priority: "high" }),
  task("b", "Filter chips", { assigneeId: "u2" }),
  task("c", "Search box"),
];
const api = {
  tags: TAGS,
  openTaskCountByTag: new Map([["t1", 1]]),
  tagsByTask: new Map([["b", [TAGS[0]]]]),
  queuedTaskIds: new Set<string>(),
  blockedTaskIds: new Set<string>(),
  subtasksByParent: new Map<string, Task[]>(),
} as unknown as TasksModuleApi;

function Harness({ initial = [] as FilterCondition[] }) {
  const [conditions, setConditions] = useState<FilterCondition[]>(initial);
  const f = useTasksFilters({
    workspaceId: "w1",
    scope: "b1",
    scopeTasks: TASKS,
    conditions,
    onConditionsChange: setConditions,
    api,
    runtime: null,
    assignees: ASSIGNEES,
    enabled: true,
  });
  return (
    <TooltipProvider>
      <div>
        {f.search}
        {f.filter}
      </div>
      {f.activeFilters}
      <ul aria-label="Rows">
        {f.tasks.map((t) => (
          <li key={t.id}>{t.title}</li>
        ))}
      </ul>
      <output data-testid="seed">{JSON.stringify(f.seed)}</output>
      <output data-testid="conditions">{JSON.stringify(conditions)}</output>
    </TooltipProvider>
  );
}

const rows = () => screen.queryAllByRole("listitem").map((li) => li.textContent);

describe("Filter", () => {
  it("chips read as sentences, with a count badge and 'N of M · Clear'", () => {
    render(<Harness initial={[{ dimension: "priority", operator: "is", values: ["high"] }]} />);
    expect(rows()).toEqual(["Toolbar polish"]);
    expect(screen.getByRole("button", { name: "Filter, 1 active" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Priority is High" })).toBeTruthy();
    expect(screen.getByText("1 of 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(rows()).toEqual(["Toolbar polish", "Filter chips", "Search box"]);
    expect(screen.getByRole("button", { name: "Filter" })).toBeTruthy();
  });

  it("an assignee filter reads the member's name; a deleted tag still has a chip", () => {
    render(
      <Harness
        initial={[
          { dimension: "assignee", operator: "is", values: ["u2"] },
          { dimension: "tag", operator: "is_not", values: ["gone"] },
        ]}
      />,
    );
    expect(screen.getByRole("group", { name: "Assignee is Mike" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Tag is not Deleted tag" })).toBeTruthy();
    expect(rows()).toEqual(["Filter chips"]);
  });

  it("New pre-fills what the filter asks for", () => {
    render(
      <Harness
        initial={[
          { dimension: "tag", operator: "is", values: ["t1"] },
          { dimension: "assignee", operator: "is", values: ["u2"] },
        ]}
      />,
    );
    expect(JSON.parse(screen.getByTestId("seed").textContent ?? "")).toEqual({
      tagIds: ["t1"],
      assigneeId: "u2",
    });
  });

  it("f opens the Filter menu; not while typing", () => {
    render(<Harness />);
    act(() => {
      fireEvent.keyDown(document.body, { key: "f" });
    });
    expect(screen.getByRole("combobox", { name: "Filter by" })).toBeTruthy();
  });
});

describe("Search", () => {
  it("/ opens the field; typing filters by title and description", () => {
    render(<Harness />);
    act(() => {
      fireEvent.keyDown(document.body, { key: "/" });
    });
    const box = screen.getByRole("searchbox", { name: "Search tasks" });
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: "language" } });
    expect(rows()).toEqual(["Toolbar polish"]);
    fireEvent.change(box, { target: { value: "box" } });
    expect(rows()).toEqual(["Search box"]);
    // `f` typed into the field is text, not the Filter key.
    fireEvent.keyDown(box, { key: "f" });
    expect(screen.queryByRole("combobox", { name: "Filter by" })).toBeNull();
  });

  it("#tag and @name become chips and leave the query", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const box = screen.getByRole("searchbox", { name: "Search tasks" }) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "#design " } });
    expect(box.value).toBe("");
    expect(screen.getByRole("group", { name: "Tag is design" })).toBeTruthy();
    expect(rows()).toEqual(["Filter chips"]);

    fireEvent.change(box, { target: { value: "@me" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByRole("group", { name: "Assignee is Me" })).toBeTruthy();
    expect(rows()).toEqual([]);
  });

  it("Esc clears, then closes", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const box = screen.getByRole("searchbox", { name: "Search tasks" });
    fireEvent.change(box, { target: { value: "chips" } });
    expect(rows()).toEqual(["Filter chips"]);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(rows()).toHaveLength(3);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
  });
});
