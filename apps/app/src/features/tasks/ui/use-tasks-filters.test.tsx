// TV-U2 · U2-1/U2-2/U2-4/U2-5 — the Tasks toolbar's Filter and search on the
// real pieces: the Filter button's count badge and the sentence chips with
// "N of M · Clear"; `/` search over title + description, where `#tag` and
// `@name` turn into chips; the `/` and `f` keys; and what New pre-fills.

import { afterEach, beforeAll, describe, expect, it } from "@rstest/core";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { type ReactElement, useState } from "react";
import type { FilterCondition } from "../../../components/ui/filter-model";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { HotkeyScope } from "../../../lib/hotkeys";
import type { Assignee } from "../assignees";
import { makeTask } from "../helpers";
import type { Bucket, ProjectStatus, Tag, Task } from "../model";
import { tagLink } from "../testing/fake-tasks";
import { renderWithTasks } from "../testing/render-with-tasks";
import {
  type ProjectFilterChoices,
  statusFilterOptions,
  useTasksFilters,
} from "./use-tasks-filters";

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

/**
 * The workspace as the store holds it: the three tasks, and "design" on
 * "Filter chips" (one open task, the menu's count). Nothing queued or blocked.
 */
// The page turns the "tasks" hotkey scope on (route-tree.tsx); `/` and `f` live there.
const show = (ui: ReactElement) =>
  renderWithTasks(<HotkeyScope scope="tasks">{ui}</HotkeyScope>, {
    seed: { tasks: TASKS, tags: TAGS, tagLinks: [tagLink("t1", "b")] },
  });

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
  it("chips read as sentences, with a count badge and 'N of M · Clear'", async () => {
    await show(<Harness initial={[{ dimension: "priority", operator: "is", values: ["high"] }]} />);
    expect(rows()).toEqual(["Toolbar polish"]);
    expect(screen.getByRole("button", { name: "Filter, 1 active" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Priority is High" })).toBeTruthy();
    expect(screen.getByText("1 of 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(rows()).toEqual(["Toolbar polish", "Filter chips", "Search box"]);
    expect(screen.getByRole("button", { name: "Filter" })).toBeTruthy();
  });

  it("an assignee filter reads the member's name; a deleted tag still has a chip", async () => {
    await show(
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

  it("Status reads To do and Won’t do, the words every surface uses", async () => {
    await show(
      <Harness
        initial={[
          { dimension: "status", operator: "is", values: ["archived"] },
          { dimension: "priority", operator: "is_not", values: ["low"] },
        ]}
      />,
    );
    expect(screen.getByRole("group", { name: "Status is Won’t do" })).toBeTruthy();
    cleanup();
    await show(
      <Harness initial={[{ dimension: "status", operator: "is_not", values: ["todo"] }]} />,
    );
    expect(screen.getByRole("group", { name: "Status is not To do" })).toBeTruthy();
  });

  it("a deep-linked task stays listed past the filters, which stay as they were", async () => {
    const filters: FilterCondition[] = [
      { dimension: "priority", operator: "is", values: ["high"] },
    ];
    await show(<Harness initial={filters} keep="b" />);
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
    await show(<Harness initial={filters} />);
    expect(rows()).toEqual(["Toolbar polish"]);
  });

  it("New pre-fills what the filter asks for", async () => {
    await show(
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

  it("f opens the Filter menu; not while typing", async () => {
    await show(<Harness />);
    act(() => {
      fireEvent.keyDown(document.body, { key: "f" });
    });
    expect(screen.getByRole("combobox", { name: "Filter by" })).toBeTruthy();
  });

  it("lists you as your name plus (you), and the chip reads You (MOD-137)", async () => {
    await show(<Harness />);
    act(() => {
      fireEvent.keyDown(document.body, { key: "f" });
    });
    fireEvent.click(screen.getByRole("option", { name: /^Assignee/ }));
    const you = screen.getByRole("option", { name: /Alex Rivera \(you\)$/ });
    fireEvent.click(you);
    expect(screen.getByRole("group", { name: "Assignee is You" })).toBeTruthy();
  });

  it("finds you by typing me", async () => {
    await show(<Harness />);
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

  it("names the project, and your Inbox as Inbox", async () => {
    await show(
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

  it("is offered in the menu, the projects in the order given", async () => {
    await show(<Harness scopeTasks={SPREAD} projects={offered} inboxId="inbox-1" />);
    act(() => {
      fireEvent.keyDown(document.body, { key: "f" });
    });
    fireEvent.click(screen.getByRole("option", { name: /^Project/ }));
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names.slice(0, 3)).toEqual(["Inbox", "Website", "Launch v1"]);
  });

  it("isn't offered inside one project, unless a condition already uses it", async () => {
    await show(<Harness scopeTasks={SPREAD} />);
    act(() => {
      fireEvent.keyDown(document.body, { key: "f" });
    });
    expect(screen.queryByRole("option", { name: /^Project/ })).toBeNull();
    cleanup();
    // A stored one still shows its chip, so it never filters out of sight.
    await show(
      <Harness
        scopeTasks={SPREAD}
        initial={[{ dimension: "project", operator: "is", values: ["gone"] }]}
      />,
    );
    expect(screen.getByRole("group", { name: "Project is Former project" })).toBeTruthy();
  });
});

describe("Search", () => {
  it("/ opens the field; typing filters by title and description", async () => {
    await show(<Harness />);
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

  it("#tag and @name become chips and leave the query", async () => {
    await show(<Harness />);
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

  it("Esc clears, then closes", async () => {
    await show(<Harness />);
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

describe("Filter → Status options (MOD-240)", () => {
  const status = (
    id: string,
    category: ProjectStatus["category"],
    name: string,
    position = 0,
    hidden = false,
  ): ProjectStatus => ({
    id,
    workspaceId: "w",
    projectId: "p1",
    category,
    name,
    position,
    hidden,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  });
  const SET = [
    status("todo", "todo", "To do"),
    status("review", "in_progress", "In review", 1),
    status("building", "in_progress", "Building", 0),
    status("shipped", "done", "Shipped"),
    status("parked", "in_progress", "Parked", 2, true),
  ];
  const byId = new Map(SET.map((s) => [s.id, s]));
  const asked = (...values: string[]): FilterCondition[] => [
    { dimension: "status", operator: "any_of", values },
  ];
  const labels = (options: { label: string }[]) => options.map((o) => o.label);

  it("inside a project: its own statuses in order, hidden ones left out", () => {
    const options = statusFilterOptions(SET, byId, []);
    expect(labels(options)).toEqual(["To do", "Building", "In review", "Shipped"]);
    expect(options.map((o) => o.value)).toEqual(["todo", "building", "review", "shipped"]);
  });

  it("a hidden status shows while a filter asks for it", () => {
    expect(labels(statusFilterOptions(SET, byId, asked("parked")))).toContain("Parked");
  });

  it("elsewhere: the five categories", () => {
    expect(labels(statusFilterOptions([], byId, []))).toEqual([
      "Backlog",
      "To do",
      "In progress",
      "Done",
      "Won’t do",
    ]);
  });

  it("values the list lacks keep a readable chip", () => {
    const options = statusFilterOptions(SET, byId, asked("in_progress", "gone"));
    expect(labels(options).slice(-2)).toEqual(["In progress", "Deleted status"]);
    const across = statusFilterOptions([], byId, asked("review"));
    expect(labels(across).at(-1)).toBe("In review");
  });
});
