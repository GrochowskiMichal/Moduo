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
import type { Bucket, Tag, Task } from "../model";
import { type ProjectFilterChoices, useTasksFilters } from "./use-tasks-filters";

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
  {
    userId: "u1",
    name: "You",
    fullName: "Alex Rivera",
    avatarUrl: null,
    isMe: true,
    canTakeTasks: true,
  },
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

function Harness({
  initial = [] as FilterCondition[],
  keep = null as string | null,
  scopeTasks = TASKS,
  projects = null as ProjectFilterChoices | null,
  inboxId = null as string | null,
}) {
  const [conditions, setConditions] = useState<FilterCondition[]>(initial);
  const f = useTasksFilters({
    workspaceId: "w1",
    scope: "b1",
    scopeTasks,
    conditions,
    onConditionsChange: setConditions,
    api,
    runtime: null,
    assignees: ASSIGNEES,
    enabled: true,
    keepTaskId: keep,
    projects,
    inboxId,
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

  it("Status reads To do and Won’t do, the words every surface uses", () => {
    render(
      <Harness
        initial={[
          { dimension: "status", operator: "is", values: ["archived"] },
          { dimension: "priority", operator: "is_not", values: ["low"] },
        ]}
      />,
    );
    expect(screen.getByRole("group", { name: "Status is Won’t do" })).toBeTruthy();
    cleanup();
    render(<Harness initial={[{ dimension: "status", operator: "is_not", values: ["todo"] }]} />);
    expect(screen.getByRole("group", { name: "Status is not To do" })).toBeTruthy();
  });

  it("a deep-linked task stays listed past the filters, which stay as they were", () => {
    const filters: FilterCondition[] = [
      { dimension: "priority", operator: "is", values: ["high"] },
    ];
    render(<Harness initial={filters} keep="b" />);
    // In scope order: the linked task joins the one the filter lets through.
    expect(rows()).toEqual(["Toolbar polish", "Filter chips"]);
    expect(screen.getByTestId("conditions").textContent).toBe(JSON.stringify(filters));
    // Searching (or changing the filters) ends it: they decide again.
    act(() => {
      fireEvent.keyDown(document.body, { key: "/" });
    });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search tasks" }), {
      target: { value: "polish" },
    });
    expect(rows()).toEqual(["Toolbar polish"]);
    cleanup();
    render(<Harness initial={filters} />);
    expect(rows()).toEqual(["Toolbar polish"]);
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

  it("lists you as your name plus (you), and the chip reads You (MOD-137)", () => {
    render(<Harness />);
    act(() => {
      fireEvent.keyDown(document.body, { key: "f" });
    });
    fireEvent.click(screen.getByRole("option", { name: /^Assignee/ }));
    const you = screen.getByRole("option", { name: /Alex Rivera \(you\)$/ });
    expect(screen.queryByRole("option", { name: /^(AR)?Me$/ })).toBeNull();
    fireEvent.click(you);
    expect(screen.getByRole("group", { name: "Assignee is You" })).toBeTruthy();
  });

  it("finds you by typing me", () => {
    render(<Harness />);
    act(() => {
      fireEvent.keyDown(document.body, { key: "f" });
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by" }), {
      target: { value: "me" },
    });
    const names = screen
      .getAllByRole("option")
      .map((o) => o.getAttribute("aria-label") ?? o.textContent);
    expect(names).toContain("Assignee › Alex Rivera (you)");
  });
});

describe("Project (MOD-141)", () => {
  const project = (id: string, name: string): Bucket => ({
    id,
    workspaceId: "w1",
    ownerId: "u1",
    name,
    isSystem: false,
    group: null,
    position: id,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  });
  const LAUNCH = project("p1", "Launch v1");
  const SITE = project("p2", "Website");
  const SPREAD = [
    task("a", "Toolbar polish", { bucketId: "p1" }),
    task("b", "Filter chips", { bucketId: "p2" }),
    task("c", "Search box", { bucketId: "inbox-1" }),
  ];
  const offered = { projects: [SITE, LAUNCH], inbox: true };

  it("names the project, and your Inbox as Inbox", () => {
    render(
      <Harness
        scopeTasks={SPREAD}
        projects={offered}
        inboxId="inbox-1"
        initial={[{ dimension: "project", operator: "any_of", values: ["inbox", "p1"] }]}
      />,
    );
    expect(screen.getByRole("group", { name: "Project is any of Inbox, Launch v1" })).toBeTruthy();
    expect(rows()).toEqual(["Toolbar polish", "Search box"]);
  });

  it("is offered in the menu, the projects in the order given", () => {
    render(<Harness scopeTasks={SPREAD} projects={offered} inboxId="inbox-1" />);
    act(() => {
      fireEvent.keyDown(document.body, { key: "f" });
    });
    fireEvent.click(screen.getByRole("option", { name: /^Project/ }));
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names.slice(0, 3)).toEqual(["Inbox", "Website", "Launch v1"]);
  });

  it("isn't offered inside one project, unless a condition already uses it", () => {
    render(<Harness scopeTasks={SPREAD} />);
    act(() => {
      fireEvent.keyDown(document.body, { key: "f" });
    });
    expect(screen.queryByRole("option", { name: /^Project/ })).toBeNull();
    cleanup();
    // A stored one still shows its chip, so it never filters out of sight.
    render(
      <Harness
        scopeTasks={SPREAD}
        initial={[{ dimension: "project", operator: "is", values: ["gone"] }]}
      />,
    );
    expect(screen.getByRole("group", { name: "Project is Former project" })).toBeTruthy();
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
    expect(screen.getByRole("group", { name: "Assignee is You" })).toBeTruthy();
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
