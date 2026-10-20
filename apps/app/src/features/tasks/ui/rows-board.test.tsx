// TV-U1 on the real List and Board: the row anatomy and its fixed columns
// (U1-1), tags as a count (U1-2), done rows and hidden completed tasks
// (U1-3), and board columns and cards (U1-4).

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, renderHook, screen, within } from "@testing-library/react";

const PEOPLE = {
  u1: {
    userId: "u1",
    name: "You",
    fullName: "Alex Rivera",
    avatarUrl: null,
    isMe: true,
    canTakeTasks: true,
  },
  u2: { userId: "u2", name: "Mike", avatarUrl: null, isMe: false, canTakeTasks: true },
} as const;

rs.mock("../assignees", () => ({
  useAssignees: () => ({
    assignees: Object.values(PEOPLE),
    currentUserId: "u1",
    byId: (id: string | null) => (id ? (PEOPLE[id as keyof typeof PEOPLE] ?? null) : null),
  }),
  previewAssign: async () => null,
  initialsOf: (name: string) => name.slice(0, 2).toUpperCase(),
}));

import { SELECTED_OPTION } from "../../../components/ui/selection";
import { TooltipProvider } from "../../../components/ui/tooltip";
import type { AgentSession } from "../../spine/agent-session";
import { resetTagStore } from "../../tags/store";
import { useJustCompleted } from "../completed";
import { makeTask } from "../helpers";
import type { Section, Tag, Task } from "../model";
import { type FakeTasksSeed, queueEntry, relation, tagLink } from "../testing/fake-tasks";
import { renderWithTasks } from "../testing/render-with-tasks";
import { TaskBoardView } from "./task-board-view";
import { TaskListView } from "./task-list-view";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(() => {
  cleanup();
  // The tag store is per workspace, not per render: no tags carry over.
  resetTagStore();
});

const OLD = "2026-01-01T00:00:00.000Z";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "b1", title: `Task ${id}`, position: id }),
    id,
    assigneeId: null,
    updatedAt: OLD,
    ...over,
  };
}

// What the store holds beside the view's own tasks, as rows (A4): the views
// read tags, counts, blockers, subtasks and the queue from the Tasks context.

/** `tags` on task `taskId`: the tag rows and their links. */
function tagged(taskId: string, tags: { id: string; name: string; color?: string }[]) {
  const rows: Tag[] = tags.map((t) => ({
    id: t.id,
    workspaceId: "w",
    ownerId: "u1",
    name: t.name,
    color: t.color ?? null,
    createdAt: OLD,
    updatedAt: OLD,
    deletedAt: null,
  }));
  return { tags: rows, tagLinks: rows.map((t) => tagLink(t.id, taskId, "w")) };
}

/** `n` live comments on a task. */
const comments = (taskId: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `c-${taskId}-${i}`,
    taskId,
    updatedAt: OLD,
    deletedAt: null,
  }));

/** `n` finished files on a task. */
const files = (taskId: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `f-${taskId}-${i}`,
    taskId,
    status: "ready",
    updatedAt: OLD,
    deletedAt: null,
  }));

/** Section "Design" of the project. */
const DESIGN: Section = {
  id: "s1",
  workspaceId: "w",
  projectId: "b1",
  name: "Design",
  position: 1,
  startsOn: null,
  endsOn: null,
  createdAt: OLD,
  updatedAt: OLD,
};

/** The view's tasks, plus whatever else the store holds. */
const seedOf = (tasks: Task[], rows: FakeTasksSeed): FakeTasksSeed => ({
  ...rows,
  tasks: [...tasks, ...(rows.tasks ?? [])],
});

type ListExtra = Partial<Parameters<typeof TaskListView>[0]>;

async function renderList(tasks: Task[], extra: ListExtra = {}, rows: FakeTasksSeed = {}) {
  await renderWithTasks(
    <TooltipProvider>
      <TaskListView
        tasks={tasks}
        scopeTitle="Work"
        selection="b1"
        view="list"
        onViewChange={() => {}}
        groupBy="none"
        buckets={[]}
        inbox={null}
        bucketNameById={() => "Work"}
        canEdit
        onRequestCapture={() => {}}
        selectedTaskId={null}
        onSelectTask={() => {}}
        {...extra}
      />
    </TooltipProvider>,
    { seed: seedOf(tasks, rows), workspaceId: "w" },
  );
}

const rowOf = (title: string) =>
  screen.getByRole("button", { name: title }).closest('[role="row"]') as HTMLElement;
const cols = (row: HTMLElement) =>
  [...row.querySelectorAll<HTMLElement>("[data-col]")].map((el) => el.dataset.col);

describe("Row anatomy (U1-1, U1-2)", () => {
  it("every row carries the same fixed columns, in order, so they line up", async () => {
    await renderList([
      task("a", { priority: "high", dueDate: "2026-10-20T00:00:00.000Z", assigneeId: "u2" }),
      task("b"),
    ]);
    expect(cols(rowOf("Task a"))).toEqual(["priority", "date", "assignee", "queue"]);
    // An empty row still holds every cell.
    expect(cols(rowOf("Task b"))).toEqual(["priority", "date", "assignee", "queue"]);
  });

  it("collapses a column that's empty on every row", async () => {
    await renderList([task("a"), task("b")]);
    expect(cols(rowOf("Task a"))).toEqual(["queue"]);
  });

  it("energy stays off on rows until Display turns it on", async () => {
    const rows = [task("a", { energyLevel: "high" })];
    await renderList(rows);
    expect(cols(rowOf("Task a"))).not.toContain("energy");
    cleanup();
    await renderList(rows, { properties: ["priority", "energy", "date", "assignee"] });
    expect(cols(rowOf("Task a"))).toContain("energy");
    expect(screen.getByLabelText("High energy")).toBeTruthy();
  });

  it("priority is a fixed three-bar glyph read by fill (ghost bars stay)", async () => {
    await renderList([task("a", { priority: "medium" })]);
    const svg = screen.getByLabelText("Medium priority").querySelector("svg") as SVGElement;
    expect(svg.querySelectorAll("rect")).toHaveLength(3);
    expect(svg.getAttribute("data-level")).toBe("2");
    expect([...svg.querySelectorAll("rect")].map((r) => r.getAttribute("class"))).toEqual([
      null,
      null,
      "opacity-25",
    ]);
  });

  it("tags show as a quiet tag icon + count after the title, never as chips or a #", async () => {
    const tags = [
      { id: "t1", name: "ui" },
      { id: "t2", name: "notes" },
      { id: "t3", name: "bug" },
    ];
    await renderList([task("a")], {}, tagged("a", tags));
    const row = rowOf("Task a");
    // Name-sorted, as the tag store hands them.
    const spoken = screen.getByText("3 tags: bug, notes, ui");
    expect(spoken.className).toContain("sr-only");
    // The same icon size and colour as files, comments and subtasks (MetaCount).
    // (Its tooltip trigger takes over the span's data-slot.)
    const count = spoken.parentElement as HTMLElement;
    expect(count.querySelector("svg")?.getAttribute("class")).toContain("lucide-tag");
    expect(count.querySelector("svg")?.getAttribute("class")).toContain("size-icon-xs");
    expect(count.className).toContain("text-muted-foreground");
    expect(count.textContent).toBe("33 tags: bug, notes, ui");
    expect(row.querySelector('[data-slot="tag-chip"]')).toBeNull();
    expect(row.textContent).not.toContain("#");
    // Hovering names them as words, in the kit tooltip.
    fireEvent.pointerMove(count, { pointerType: "mouse" });
    expect((await screen.findByRole("tooltip")).textContent).toBe("bug, notes, ui");
    // The count sits in the title cell, in the row's details (MOD-138).
    const title = row.querySelector('[data-slot="row-title"]') as HTMLElement;
    expect(title.querySelector('[data-slot="row-details"]')?.contains(count)).toBe(true);
  });

  it("Detailed rows show two tags as dot chips, then +n, never a # (MOD-97)", async () => {
    const tags = [
      { id: "t1", name: "ui", color: "blue" },
      { id: "t2", name: "notes", color: "green" },
      { id: "t3", name: "bug", color: "red" },
    ];
    await renderList([task("a")], { rows: "detailed" }, tagged("a", tags));
    const title = rowOf("Task a").querySelector('[data-slot="row-title"]') as HTMLElement;
    const names = title.querySelector('[data-slot="row-tag-names"]') as HTMLElement;
    const chips = [...names.querySelectorAll<HTMLElement>('[data-slot="tag-chip"]')];
    // Name-sorted, as the tag store hands them.
    expect(chips.map((c) => c.textContent)).toEqual(["bug", "notes"]);
    expect(chips.map((c) => c.dataset.label)).toEqual(["red", "green"]);
    expect(chips[0]?.className).toContain("h-4.5");
    // The names stay at full width, so each chip is capped: the title keeps its room.
    expect(names.className).toContain("shrink-0");
    for (const chip of chips) expect(chip.className).toContain("max-w-24");
    expect(screen.getByTitle("Tag: bug").closest('[data-slot="tag-chip"]')).toBe(
      chips[0] as HTMLElement,
    );
    const more = names.querySelector('[data-slot="tag-chip-more"]') as HTMLElement;
    expect(more.textContent).toBe("+1");
    act(() => more.focus());
    expect((await screen.findByRole("tooltip")).textContent).toBe("ui");
    expect(names.textContent).not.toContain("#");
  });

  it("counts subtasks as done/total and marks blocked and repeating tasks", async () => {
    await renderList(
      [task("a", { recurrence: { rrule: "FREQ=DAILY", dtstart: null, nextOccurrence: null } })],
      {},
      {
        // Three subtasks, one done; "Spec" (open) blocks it.
        tasks: [
          task("s1", { parentId: "a", status: "done" }),
          task("s2", { parentId: "a" }),
          task("s3", { parentId: "a" }),
          task("z", { title: "Spec" }),
        ],
        relations: [relation("z", "a", "w")],
      },
    );
    const row = rowOf("Task a");
    expect(row.textContent).toContain("1/3");
    expect(screen.getByText("1 of 3 subtasks done")).toBeTruthy();
    expect(screen.getByLabelText("Blocked by “Spec”")).toBeTruthy();
    expect(screen.getByLabelText("Repeats")).toBeTruthy();
  });

  it("in a cross-bucket flat view the bucket is dot + name text, not a pill", async () => {
    await renderList([task("a")], { selection: "all" });
    const bucket = screen.getByRole("button", { name: "Project: Work" });
    expect(bucket.textContent).toBe("Work");
    expect(bucket.querySelector('[data-slot="badge"]')).toBeNull();
    expect(bucket.querySelector('[data-slot="nav-row-dot"]')).not.toBeNull();
  });

  it("the queue toggle hides until hover, focus or selection, unless queued or claimed", async () => {
    await renderList(
      [task("a"), task("b"), task("c")],
      {},
      {
        queue: [
          queueEntry("b", "u1", { workspaceId: "w" }),
          queueEntry("c", "u2", { workspaceId: "w" }),
        ],
      },
    );
    const toggle = (title: string) =>
      rowOf(title).querySelector('[data-col="queue"] button') as HTMLElement;
    expect(toggle("Task a").className).toContain("opacity-0");
    expect(toggle("Task a").className).toContain("group-hover:opacity-100");
    expect(toggle("Task a").className).toContain("group-aria-selected:opacity-100");
    expect(toggle("Task b").className).not.toContain("opacity-0");
    expect(toggle("Task c").className).not.toContain("opacity-0");
  });

  it("the date cell is named by its dates", async () => {
    await renderList([task("a", { dueDate: "2026-10-20T00:00:00.000Z" })]);
    const cell = rowOf("Task a").querySelector('[data-col="date"]') as HTMLElement;
    // The one grammar (decision 41): the year shows only when it isn't this one.
    expect(cell.getAttribute("aria-label")).toMatch(/^Due (\S+ \d+|\d+ \S+)(,? \d{4})?$/);
  });
});

// TV-U2 · Display → Rows (tasks-v3 §4, AC11.2): Standard is TV-U1's row;
// Detailed adds the status name, the time and the assignee's name, and names
// the project on every row. The rest of Detailed is TV-U10's.
describe("Display → Rows: Standard · Detailed", () => {
  const rows = [
    task("a", {
      status: "in_progress",
      assigneeId: "u2",
      durationMinutes: 240,
      timeSpentSeconds: 4800,
      dueDate: "2026-10-20T00:00:00.000Z",
    }),
    task("b", { durationMinutes: 45 }),
    task("c", { status: "archived" }),
  ];

  // The project's control is in every editable row; inside the project it
  // stays out of sight in Standard (implied by the scope).
  // Where the project is implied the trigger stays, taking no width (DS-6).
  // (It is aria-hidden then, so look it up by its label, not its role.)
  const projectShown = (row: HTMLElement) =>
    !row.querySelector('[aria-label="Project: Work"]')?.hasAttribute("data-implied");

  it("Standard keeps TV-U1's columns", async () => {
    await renderList(rows);
    expect(cols(rowOf("Task a"))).toEqual(["date", "assignee", "queue"]);
    expect(projectShown(rowOf("Task a"))).toBe(false);
  });

  it("Detailed (TV-U10): Project › Section, status name, Due, time, assignee name, updated", async () => {
    await renderList(rows, { rows: "detailed" }, { sections: [DESIGN] });
    const a = rowOf("Task a");
    expect(cols(a)).toEqual(["project", "status", "due", "time", "assignee", "updated", "queue"]);
    const cell = (row: HTMLElement, col: string) =>
      row.querySelector<HTMLElement>(`[data-col="${col}"]`)?.textContent;
    expect(cell(a, "status")).toBe("In progress");
    expect(cell(a, "time")).toBe("1h 20m / ~4h");
    expect(cell(a, "assignee")).toContain("Mike");
    expect(cell(a, "project")).toBe("Work");
    expect(cell(rowOf("Task b"), "time")).toBe("~45m");
    expect(cell(rowOf("Task c"), "status")).toBe("Won’t do");
    // The project shows even inside the project, in its own column.
    expect(projectShown(a)).toBe(true);
  });

  it("Display → Columns turns Detailed's own columns off, header and rows (MOD-128, MOD-136)", async () => {
    // A project's defaults: no Project (the page's title), no Updated.
    await renderList(rows, {
      rows: "detailed",
      detailedColumns: ["handle", "status", "time", "waiting"],
    });
    const a = rowOf("Task a");
    expect(cols(a)).toEqual(["status", "due", "time", "assignee", "queue"]);
    expect(projectShown(a)).toBe(false);
    const header = document.querySelector('[data-slot="task-list-header"]') as HTMLElement;
    expect(within(header).queryByText("Project")).toBeNull();
    expect(within(header).queryByRole("button", { name: /updated/i })).toBeNull();
  });

  it("Detailed with every own column off is still Detailed, not Standard's date (MOD-128)", async () => {
    await renderList(rows, { rows: "detailed", detailedColumns: [] });
    // Due stays Detailed's own cell; Standard's one date never comes back.
    expect(cols(rowOf("Task a"))).toEqual(["due", "assignee", "queue"]);
    expect(document.querySelector('[data-slot="task-list-header"]')).not.toBeNull();
  });

  it("Detailed names the section after the project, and the handle before the title", async () => {
    const withSection = [task("a", { sectionId: "s1", number: 142 })];
    await renderList(withSection, { rows: "detailed", taskKey: "MOD" }, { sections: [DESIGN] });
    const a = rowOf("Task a");
    expect(a.querySelector('[data-col="project"]')?.textContent).toBe("Work › Design");
    const handle = a.querySelector('[data-col="handle"]') as HTMLElement;
    expect(handle.textContent).toBe("MOD-142");
    // Before the title, like Linear's ID.
    const title = a.querySelector('[data-slot="row-title"]') as HTMLElement;
    expect(handle.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Detailed's ID header sorts by the number and says which way (MOD-144)", async () => {
    const onSort = rs.fn();
    const numbered = [task("a", { number: 10 }), task("b", { number: 2 })];
    await renderList(numbered, { rows: "detailed", taskKey: "MOD", onSort, order: "id" });
    const header = document.querySelector('[data-slot="task-list-header"]') as HTMLElement;
    const id = within(header).getByRole("button", { name: "ID, sorted ascending" });
    fireEvent.click(id);
    expect(onSort).toHaveBeenCalledWith("id");
    // In number order: MOD-2 before MOD-10.
    const titles = screen.getAllByRole("row").map((r) => r.getAttribute("data-task-id"));
    expect(titles.filter(Boolean)).toEqual(["b", "a"]);
  });

  it("Detailed has sortable column headers on the rows' widths", async () => {
    const onSort = rs.fn();
    await renderList(rows, { rows: "detailed", onSort });
    const header = document.querySelector('[data-slot="task-list-header"]') as HTMLElement;
    expect(header).not.toBeNull();
    fireEvent.click(within(header).getByRole("button", { name: "Sort by due" }));
    expect(onSort).toHaveBeenCalledWith("due");
    fireEvent.click(within(header).getByRole("button", { name: "Sort by title" }));
    expect(onSort).toHaveBeenCalledWith("title");
    // The widths are the frame's variables, shared by header and rows.
    const frame = header.parentElement?.parentElement as HTMLElement;
    expect(frame.style.getPropertyValue("--tl-col-status")).toMatch(/ch$/);
  });

  it("nothing in Detailed's cells truncates: they hold the list's width", async () => {
    await renderList(rows, { rows: "detailed" });
    for (const col of ["status", "time", "assignee", "updated"]) {
      const el = rowOf("Task a").querySelector<HTMLElement>(`[data-col="${col}"]`);
      expect(el?.className).toContain("whitespace-nowrap");
      expect(el?.className).not.toContain("truncate");
      expect(el?.className).toMatch(/min-w-\(--tl-col-/);
    }
  });

  it("the title takes the free width (checkpoint 1): the only flexible cell", async () => {
    await renderList(rows, { rows: "detailed" });
    const title = rowOf("Task a").querySelector('[data-slot="row-title"]') as HTMLElement;
    expect(title.className).toContain("flex-1");
    const columns = rowOf("Task a").querySelector('[data-slot="row-columns"]') as HTMLElement;
    expect(columns.className).toContain("shrink-0");
  });
});

describe("A row's details, pinned to its end (MOD-138, MOD-125)", () => {
  const working: AgentSession = {
    id: "s1",
    workspaceId: "w",
    taskId: "a",
    userId: "someone",
    agent: "Claude",
    state: "needs_you",
    note: null,
    step: null,
    steps: null,
    links: [],
    earlier: [],
    summaryAt: null,
    summaryPostedAt: null,
    startedAt: OLD,
    updatedAt: OLD,
    stoppedAt: null,
  };
  const detailsOf = (row: HTMLElement) =>
    row.querySelector('[data-slot="row-details"]') as HTMLElement | null;
  const titleCell = (row: HTMLElement) =>
    row.querySelector('[data-slot="row-title"]') as HTMLElement;

  it("Standard: the agent's mark and the counts are one group at the title cell's end", async () => {
    await renderList(
      [task("a", { title: "Hero banner for the homepage" })],
      { selection: "all", scopeTitle: "All" },
      {
        comments: comments("a", 3),
        attachments: files("a", 2),
        agentSessions: [working],
      },
    );
    const row = rowOf("Hero banner for the homepage");
    const details = detailsOf(row) as HTMLElement;
    // The last thing in the title cell, pushed to its end, so it never moves
    // with the title's length; the project's name stays with the title.
    expect(titleCell(row).lastElementChild).toBe(details);
    expect(details.className).toContain("ms-auto");
    const project = row.querySelector(
      '[data-slot="row-title"] button[aria-label^="Project"]',
    ) as HTMLElement;
    expect(
      project.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The agent first, then the counts (round-2b `.ind`).
    const agent = details.querySelector('[data-slot="row-agent"]') as HTMLElement;
    const counts = details.querySelector('[data-slot="row-details-counts"]') as HTMLElement;
    expect(agent.compareDocumentPosition(counts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(counts.textContent).toContain("2 files");
    expect(counts.textContent).toContain("3 comments");
    // The agent's words give way first: it starts at nothing and grows to
    // its words, never under its dot.
    expect(agent.className).toContain("basis-0");
    expect(agent.className).toContain("max-w-max");
    expect(agent.className).toContain("min-w-3");
    // Then the counts, whole and from their start: laid out from the end,
    // each count an item of its own, in its own order (tags, files, comments).
    expect(counts.className).toContain("flex-row-reverse");
    expect(counts.className).toContain("flex-wrap");
    expect(counts.className).toContain("overflow-hidden");
    const spoken = [...counts.children].map((c) => c.querySelector(".sr-only")?.textContent);
    expect(spoken).toEqual(["2 files", "3 comments"]);
    // Nothing inside spills over the columns.
    expect((details.lastElementChild as HTMLElement).className).toContain("overflow-x-clip");
  });

  it("the title gives way first, never below about ten characters", async () => {
    await renderList([
      task("a", { title: "Hero banner for the homepage" }),
      task("b", { title: "Pay rent" }),
    ]);
    const long = rowOf("Hero banner for the homepage").querySelector(
      "[data-row-title]",
    ) as HTMLElement;
    expect(long.className).toContain("min-w-[min(10ch,100%)]");
    // From its floor it grows to its own width, never past its words.
    expect(long.className).toContain("max-w-max");
    expect(long.className).toContain("truncate");
    // A short title keeps its whole width.
    const short = rowOf("Pay rent").querySelector("[data-row-title]") as HTMLElement;
    expect(short.className).toContain("shrink-0");
    expect(short.className).not.toContain("min-w-[min(10ch,100%)]");
    // The cell is a container, so the details can say less when it's narrow.
    expect(titleCell(rowOf("Pay rent")).className).toContain("@container/title");
  });

  it("the agent's mark is a dot, its agent and what it does, shorter as the cell narrows", async () => {
    await renderList([task("a", { title: "Hero banner" })], {}, { agentSessions: [working] });
    const agent = rowOf("Hero banner").querySelector('[data-slot="row-agent"]') as HTMLElement;
    // Needs you reads in the text colour (round-1c `.agent.needs`).
    expect(agent.dataset.tone).toBe("loud");
    expect(agent.className).toContain("text-foreground");
    expect(agent.querySelector("span[aria-hidden]")?.className).toContain("rounded-full");
    expect(agent.textContent).toBe("A teammate's Claude · needs you");
    // Under 16rem the state goes, under 12rem the agent too: still read aloud.
    const words = agent.lastElementChild as HTMLElement;
    expect(words.className).toContain("@max-[12rem]/title:sr-only");
    expect((words.lastElementChild as HTMLElement).className).toContain("@max-3xs/title:sr-only");
    fireEvent.pointerMove(agent, { pointerType: "mouse" });
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "A teammate's Claude · needs you",
    );
  });

  it("an agent's dot always keeps its room beside the title's floor (MOD-125)", async () => {
    await renderList(
      [task("a", { title: "Hero banner for the homepage" })],
      {},
      { agentSessions: [working] },
    );
    const row = rowOf("Hero banner for the homepage");
    const title = row.querySelector("[data-row-title]") as HTMLElement;
    // The floor leaves the dot and its gap (12 + 10 px) when the cell is tiny.
    expect(title.className).toContain("min-w-[min(10ch,calc(100%-1.375rem))]");
    expect((detailsOf(row) as HTMLElement).className).toContain("min-w-3");
  });

  it("Detailed keeps them right after the title", async () => {
    await renderList(
      [task("a", { title: "Hero banner" })],
      { rows: "detailed" },
      { comments: comments("a", 3) },
    );
    const row = rowOf("Hero banner");
    const details = detailsOf(row) as HTMLElement;
    expect(details.className).not.toContain("ms-auto");
    const title = row.querySelector("[data-row-title]") as HTMLElement;
    expect(title.nextElementSibling).toBe(details);
    // Whole counts here too, but what's left sits right after the title.
    const counts = details.querySelector('[data-slot="row-details-counts"]') as HTMLElement;
    expect(counts.className).toContain("flex-row-reverse");
    expect(counts.className).toContain("justify-end");
  });

  it("a late row's fixes sit beside the details, never over them", async () => {
    await renderList(
      [task("a", { title: "Hero banner", dueOn: "2020-01-01", dueDate: "2020-01-01T00:00:00Z" })],
      {},
      { comments: comments("a", 3) },
    );
    const details = detailsOf(rowOf("Hero banner")) as HTMLElement;
    const fixes = details.querySelector('[data-slot="row-late-fixes"]')?.parentElement
      ?.parentElement as HTMLElement;
    // Anchored to the group's start, outside its clipped box.
    expect(fixes.className).toContain("end-full");
    expect(fixes.parentElement).toBe(details);
  });
});

describe("Done and completed (U1-3)", () => {
  const tasks = () => [
    task("open"),
    task("old-done", { status: "done" }),
    task("new-done", { status: "done", updatedAt: new Date().toISOString() }),
  ];

  it('hides completed tasks by default behind the list\'s one "N completed · Show" (MOD-148)', async () => {
    await renderList(tasks());
    expect(screen.getAllByRole("row")).toHaveLength(1);
    const line = screen.getByRole("button", { name: "2 completed, show" });
    expect(line.textContent).toBe("2 completed · Show");

    fireEvent.click(line);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "2 completed, hide" }).textContent).toBe(
      "2 completed · Hide",
    );
  });

  it('"7 days" lists the recent ones, the older behind the end line; "All" lists every one', async () => {
    await renderList(tasks(), { completed: "week" });
    expect(screen.getAllByRole("row")).toHaveLength(2);
    // The list's one end line, for the older ones (MOD-148 follow-up).
    expect(
      screen
        .getByRole("button", { name: "1 older completed, show" })
        .closest("[data-slot]")
        ?.getAttribute("data-slot"),
    ).toBe("completed-end-line");
    cleanup();
    await renderList(tasks(), { completed: "all" });
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /completed/ })).toBeNull();
  });

  it("a task just checked off stays listed, struck through", async () => {
    await renderList(tasks(), { stayingIds: new Set(["old-done"]) });
    expect(screen.getAllByRole("row")).toHaveLength(2);
    const row = rowOf("Task old-done");
    expect(screen.getByRole("button", { name: "Task old-done" }).className).toContain(
      "line-through",
    );
    // The kit Row's done state (DS-6).
    expect(row.dataset.done).toBe("");
  });

  it("a selected or deep-linked completed task stays listed (no fallback to another task)", async () => {
    const onSelectTask = rs.fn();
    await renderList([task("a"), task("b", { status: "done" })], {
      selectedTaskId: "b",
      onSelectTask,
      revealRequest: { id: "b", seq: 1 },
    });
    expect(rowOf("Task b")).toBeTruthy();
    expect(onSelectTask).not.toHaveBeenCalled();
    // The list's end line still counts it, so the count never moves with the
    // selection (MOD-148).
    expect(screen.getByRole("button", { name: "1 completed, show" })).toBeTruthy();
  });

  it("a deep link to a done subtask of a done parent lands: the parent stays and expands", async () => {
    const onSelectTask = rs.fn();
    const parent = task("p", { status: "done" });
    const child = task("c", { status: "done", parentId: "p" });
    await renderList(
      [task("a"), parent, child],
      // The store nests c under p by its parentId.
      { selectedTaskId: "c", onSelectTask, revealRequest: { id: "c", seq: 1 } },
    );
    expect(rowOf("Task p")).toBeTruthy();
    expect(rowOf("Task c")).toBeTruthy();
    expect(onSelectTask).not.toHaveBeenCalled();
  });

  it("a done row dims as a whole except its status icon", async () => {
    await renderList(tasks(), { completed: "all" });
    const row = rowOf("Task old-done");
    const title = row.querySelector('[data-slot="row-title"]') as HTMLElement;
    const columns = row.querySelector('[data-slot="row-columns"]') as HTMLElement;
    // The kit Row's fade: every slot but the lead, keyed on the row's state.
    expect(title.className).toContain("group-data-[done]/row:opacity-50");
    expect(columns.className).toContain("group-data-[done]/row:opacity-50");
    // Dimmed once, by opacity: the title keeps its colour (the comp).
    expect(screen.getByRole("button", { name: "Task old-done" }).className).not.toContain(
      "text-muted-foreground",
    );
    expect(row.className).not.toContain("opacity-50");
    const glyph = within(row).getByRole("button", { name: "Mark as not done" });
    expect(title.contains(glyph) || columns.contains(glyph)).toBe(false);
  });

  it("a done parent with open subtasks stays, so they aren't hidden with it", async () => {
    const parent = task("p", { status: "done" });
    const child = task("c", { parentId: "p" });
    // The store nests c under p by its parentId.
    await renderList([parent, child]);
    expect(rowOf("Task p")).toBeTruthy();
  });

  it("the Queue ignores Completed (TV-D4 keeps a checked-off task until reload)", async () => {
    await renderList(tasks(), { selection: "today", reorderable: false });
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });
});

describe("useJustCompleted", () => {
  it("keeps a task checked off in this scope, and forgets on a scope change", () => {
    const open = [task("a")];
    const done = [task("a", { status: "done" })];
    const { result, rerender } = renderHook(({ tasks, scope }) => useJustCompleted(tasks, scope), {
      initialProps: { tasks: open, scope: "inbox" },
    });
    expect([...result.current]).toEqual([]);
    rerender({ tasks: done, scope: "inbox" });
    expect([...result.current]).toEqual(["a"]);
    rerender({ tasks: done, scope: "b2" });
    expect([...result.current]).toEqual([]);
  });
});

describe("Board (U1-4)", () => {
  async function renderBoard(
    tasks: Task[],
    extra: Record<string, unknown> = {},
    rows: FakeTasksSeed = {},
  ) {
    await renderWithTasks(
      <TooltipProvider>
        <TaskBoardView
          tasks={tasks}
          scopeTitle="Work"
          selection="b1"
          view="board"
          onViewChange={() => {}}
          boardGroupBy="status"
          buckets={[]}
          inbox={null}
          bucketNameById={() => "Work"}
          canEdit
          onRequestCapture={() => {}}
          selectedTaskId="a"
          onSelectTask={() => {}}
          {...extra}
        />
      </TooltipProvider>,
      { seed: seedOf(tasks, rows), workspaceId: "w" },
    );
  }
  const card = (title: string) => screen.getByText(title).closest("[data-task-id]") as HTMLElement;

  it("columns keep one fixed width per density, and their cards fill them (default o, TV-U11)", async () => {
    await renderBoard([task("a")]);
    const column = card("Task a").closest("section") as HTMLElement;
    expect(column.className).toContain("w-(--board-col-w)");
    expect(column.className).toContain("shrink-0");
    // A card as wide as the column overflowed it by the scrollbar's width
    // once the column scrolled, so the column scrolled sideways (MOD-143).
    expect(card("Task a").className).toContain("w-full");
    expect(card("Task a").className).not.toContain("w-(--board-card-w)");
    const scroller = column.children[1] as HTMLElement;
    expect(scroller.className).toContain("overflow-x-hidden");
    expect(scroller.className).toContain("overflow-y-auto");
  });

  it("a long title wraps to three lines at most (MOD-143)", async () => {
    await renderBoard([task("a")]);
    expect(screen.getByText("Task a").className).toContain("line-clamp-3");
  });

  it("a card has one quiet meta line, and selection is the tint", async () => {
    await renderBoard([
      task("a", {
        priority: "high",
        dueDate: "2026-10-20T00:00:00.000Z",
        assigneeId: "u2",
      }),
    ]);
    const el = card("Task a");
    for (const cls of SELECTED_OPTION.split(" ")) expect(el.className).toContain(cls);
    // One meta line, which wraps rather than cut anything (TV-P0, AC1.16).
    const meta = el.querySelector(".flex-wrap") as HTMLElement;
    expect(meta).not.toBeNull();
    expect(meta.contains(screen.getByLabelText("High priority"))).toBe(true);
    expect(meta.contains(screen.getByLabelText("Assignee: Mike"))).toBe(true);
  });

  it("Standard cards count tags with the tag icon, as rows do (MOD-97)", async () => {
    const tags = [
      { id: "t1", name: "ui", color: "blue" },
      { id: "t2", name: "notes", color: "green" },
    ];
    await renderBoard([task("a")], {}, tagged("a", tags));
    // Name-sorted, as the tag store hands them.
    const spoken = within(card("Task a")).getByText("2 tags: notes, ui");
    expect(spoken.parentElement?.querySelector("svg")?.getAttribute("class")).toContain(
      "lucide-tag",
    );
    expect(card("Task a").querySelector('[data-slot="tag-chip"]')).toBeNull();
    expect(card("Task a").textContent).not.toContain("#");
  });

  it("Detailed cards show three tags as dot chips on the second line, layout-neutral (MOD-97)", async () => {
    const tags = ["ui", "notes", "bug", "copy"].map((name, i) => ({
      id: `t${i}`,
      name,
      color: "violet",
    }));
    await renderBoard([task("a")], { rows: "detailed" }, tagged("a", tags));
    const chips = [...card("Task a").querySelectorAll<HTMLElement>('[data-slot="tag-chip"]')];
    // Name-sorted, as the tag store hands them.
    expect(chips.map((c) => c.textContent)).toEqual(["bug", "copy", "notes"]);
    const more = card("Task a").querySelector('[data-slot="tag-chip-more"]') as HTMLElement;
    expect(more.textContent).toBe("+1");
    act(() => more.focus());
    expect((await screen.findByRole("tooltip")).textContent).toBe("ui");
    // 18 px chips in a 16 px text line: the list takes -1 px top and bottom,
    // so the card keeps its height.
    const list = chips[0]?.closest('[data-slot="tag-chip-list"]') as HTMLElement;
    expect(list.className).toContain("-my-px");
    expect(list.closest('[data-slot="item-card-meta"]')).not.toBeNull();
    // One line, never wrapping: long names shorten instead (full name on hover).
    expect(list.className).not.toContain("flex-wrap");
    for (const chip of chips) expect(chip.className).toContain("max-w-24");
    expect(screen.getByTitle("Tag: bug").closest('[data-slot="tag-chip"]')).toBe(
      chips[0] as HTMLElement,
    );
    expect(card("Task a").textContent).not.toContain("#");
  });

  it("done cards fade, and completed cards hide behind the board's one line (MOD-148)", async () => {
    await renderBoard([task("a"), task("d", { status: "done" })]);
    expect(screen.queryByText("Task d")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1 completed, show" }));
    // The kit card fades its title and meta, never its status icon (it reopens).
    expect(card("Task d").hasAttribute("data-done")).toBe(true);
    const title = card("Task d").querySelector('[data-slot="item-card-title"] > span:last-child');
    expect(title?.className).toContain("group-data-[done]/card:opacity-50");
    act(() => {});
  });

  it("keeps the selected card even when Display hides completed ones", async () => {
    await renderBoard([task("a"), task("d", { status: "done" })], { selectedTaskId: "d" });
    expect(card("Task d")).toBeTruthy();
  });

  // The column's name in its kit GroupHeader (DS-6), without the count.
  const headers = () =>
    [...document.querySelectorAll("section > header")].map(
      (h) => h.querySelector('[data-slot="group-header-label"]')?.textContent,
    );

  it("Filter → Status shows only the groups it lets through: Won't do on its own", async () => {
    await renderBoard([task("w", { status: "archived" })], {
      statusFilter: new Set(["archived"]),
      selectedTaskId: "w",
    });
    expect(headers()).toEqual(["Won’t do"]);
    expect(card("Task w")).toBeTruthy();
    cleanup();
    await renderBoard([task("a")], { statusFilter: new Set(["todo", "in_progress"]) });
    expect(headers()).toEqual(["To do", "In progress"]);
    cleanup();
    await renderBoard([task("a")]);
    expect(headers()).toEqual(["To do", "In progress", "Done"]);
  });

  it("a Won't do card kept in view (TV-P0) brings its group with it", async () => {
    await renderBoard([task("a"), task("w", { status: "archived" })], { selectedTaskId: "w" });
    expect(headers()).toEqual(["To do", "In progress", "Done", "Won’t do"]);
  });

  it("a card with nothing to show has no empty meta line", async () => {
    await renderBoard([task("d", { status: "done" })], { completed: "all", canEdit: false });
    expect(card("Task d").querySelector(".whitespace-nowrap")).toBeNull();
  });
});

// TV-U2 · U2-1/U2-3 — Display drives the List and the Board: group, order and
// subtasks; the toolbar carries the page's search, Filter, Display and count.
describe("Display on the List and Board (U2-1, U2-3)", () => {
  it("the toolbar shows the title, its count and the page's controls; Group isn't in it", async () => {
    await renderList([task("a")], {
      header: {
        count: 7,
        search: <button type="button">Search</button>,
        filter: <button type="button">Filter</button>,
        display: <button type="button">Display</button>,
      },
    });
    const toolbar = screen.getByRole("toolbar");
    expect(within(toolbar).getByRole("heading", { name: "Work" })).toBeTruthy();
    expect(within(toolbar).getByText("7")).toBeTruthy();
    for (const name of ["Search", "Filter", "Display", "New"]) {
      expect(within(toolbar).getByRole("button", { name })).toBeTruthy();
    }
    expect(within(toolbar).queryByText("Group")).toBeNull();
    expect(within(toolbar).queryByRole("combobox")).toBeNull();
  });

  it("orders rows inside each group", async () => {
    await renderList(
      [
        task("a", { priority: "low" }),
        task("b", { priority: "high", status: "in_progress" }),
        task("c", { priority: "high" }),
        task("d", { priority: "medium" }),
      ],
      { groupBy: "status", order: "priority" },
    );
    expect(screen.getByRole("button", { name: /^In progress/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^To do/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Task / }).map((b) => b.textContent)).toEqual([
      "Task b",
      "Task c",
      "Task d",
      "Task a",
    ]);
  });

  it("each task is listed once, whatever the grouping (no Tag grouping)", async () => {
    const tasks = [
      task("a", { dueDate: new Date().toISOString(), priority: "high" }),
      task("b", { assigneeId: null }),
    ];
    for (const groupBy of ["status", "priority", "assignee", "date"] as const) {
      await renderList(tasks, { groupBy });
      expect(screen.getAllByRole("button", { name: "Task a" })).toHaveLength(1);
      cleanup();
    }
  });

  it("Subtasks · Flat lists a subtask as its own row", async () => {
    const parent = task("p");
    const child = task("c", { parentId: "p" });
    // The store nests c under p by its parentId.
    await renderList([parent, child], { subtasks: "nested" });
    expect(screen.queryByRole("button", { name: "Task c" })).toBeNull();
    cleanup();
    await renderList([parent, child], { subtasks: "flat" });
    expect(screen.getByRole("button", { name: "Task c" })).toBeTruthy();
  });

  it("the Queue keeps its line-up whatever Order says", async () => {
    await renderList([task("a", { priority: "low" }), task("b", { priority: "high" })], {
      selection: "today",
      order: "priority",
    });
    expect(screen.getAllByRole("button", { name: /^Task / }).map((b) => b.textContent)).toEqual([
      "Task a",
      "Task b",
    ]);
  });

  it("the Board orders cards inside each column, and flattens subtasks on Flat", async () => {
    const parent = task("p", { dueDate: "2026-10-20T00:00:00.000Z" });
    const child = task("c", { parentId: "p", dueDate: "2026-10-10T00:00:00.000Z" });
    // The store nests c under p by its parentId.
    await renderWithTasks(
      <TooltipProvider>
        <TaskBoardView
          tasks={[parent, child]}
          scopeTitle="Work"
          selection="b1"
          view="board"
          onViewChange={() => {}}
          boardGroupBy="status"
          buckets={[]}
          inbox={null}
          bucketNameById={() => "Work"}
          canEdit
          onRequestCapture={() => {}}
          selectedTaskId={null}
          onSelectTask={() => {}}
          order="due"
          subtasks="flat"
        />
      </TooltipProvider>,
      { seed: { tasks: [parent, child] }, workspaceId: "w" },
    );
    const cards = [...document.querySelectorAll<HTMLElement>("[data-task-id]")].map(
      (el) => el.dataset.taskId,
    );
    expect(cards).toEqual(["c", "p"]);
  });
});
