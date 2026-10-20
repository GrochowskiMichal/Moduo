// TV-U3 on the real panel: the comp layout with property rule C and the Time row
// (U3-1), comments read and written on the task (U3-2), and the queue toggle in
// the header instead of the old full-width button (U3-3).

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

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

rs.mock("../../spine/hooks/use-comment-people", () => ({
  useCommentPeople: () => ({
    currentUserId: "u1",
    mentionable: [{ id: "u2", name: "Mike", avatarUrl: null }],
    names: ["Maciej", "Mike"],
    nameOf: (id: string) => (id === "u1" ? "Maciej" : id === "u2" ? "Mike" : null),
    personOf: (id: string) =>
      id === "u2"
        ? { id: "u2", name: "Mike", avatarUrl: null }
        : id === "u1"
          ? { id: "u1", name: "Maciej", avatarUrl: null }
          : null,
  }),
}));

import type { ReactElement, ReactNode } from "react";
import type { ModuoRuntime, SpineComment } from "@/lib/runtime.types";
import { RightPanel } from "../../../components/app/right-panel";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { setRunClaims } from "../../focus/claims";
import { WorkspaceContext, type WorkspaceContextValue } from "../../workspaces/workspace-context";
import type { TaskCommands } from "../commands";
import { makeTask } from "../helpers";
import { clearTaskTimeShares } from "../hooks/use-task-time-share";
import type { ActivityEntry, Bucket, Section, Tag, Task } from "../model";
import { useTaskCommands, useTasksActivityStamp } from "../tasks-context";
import { type FakeTasksSeed, queueEntry, tagLink } from "../testing/fake-tasks";
import { renderWithTasks } from "../testing/render-with-tasks";
import { BulkPanel } from "./bulk-panel";
import { TaskDetailPanel } from "./task-detail-panel";
import { TaskFullPage } from "./task-full-page";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});
/** Where the feed remembers your All · Comments pick (u1 is "you" here). */
const FEED_FILTER_KEY = "moduo:task-feed-filter:u1";
/** The feed opens on Comments (MOD-157); a test about the trail picks All first. */
const pickAll = () => localStorage.setItem(FEED_FILTER_KEY, "all");

afterEach(() => {
  cleanup();
  clearTaskTimeShares();
  setRunClaims(null, new Map());
  localStorage.removeItem(FEED_FILTER_KEY);
});

const INBOX: Bucket = {
  id: "inbox",
  workspaceId: "w",
  ownerId: "u1",
  name: "Inbox",
  isSystem: true,
  group: null,
  position: "a",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};
const APP: Bucket = { ...INBOX, id: "b-app", name: "Moduo App", isSystem: false, position: "b" };

function task(over: Partial<Task> = {}): Task {
  return {
    ...makeTask({
      workspaceId: "w",
      bucketId: "b-app",
      title: "Task Module UI/UX Review",
      position: "a",
    }),
    id: "t1",
    creatorId: "u1",
    assigneeId: "u1",
    createdAt: "2026-10-06T10:07:00Z",
    updatedAt: "2026-10-06T10:07:00Z",
    ...over,
  };
}

/**
 * The panel's Tasks context for a test: the store holds `seed` (the task, the
 * two projects, and whatever the test adds), and the commands the panel calls
 * are spies (`a.patchTask`, …). Pass more spies or seed rows in `over`.
 */
type Setup = Partial<TaskCommands> & { seed: FakeTasksSeed; canEdit: boolean };

/** The commands the panel calls, as spies. */
function spies() {
  return {
    setTaskStatus: rs.fn(),
    loadActivity: rs.fn(async () => [] as ActivityEntry[]),
    patchTask: rs.fn(),
    toggleDone: rs.fn(),
    toggleQueue: rs.fn(),
    setTimeSpent: rs.fn(),
    logTime: rs.fn(async () => true),
    editTimeEntry: rs.fn(async () => true),
    removeTimeEntry: rs.fn(async () => true),
    listMyTimeEntries: rs.fn(async () => []),
    createTask: rs.fn(async () => null),
    createTagForTask: rs.fn(),
    archiveTask: rs.fn(),
    deleteTask: rs.fn(),
    setTaskParent: rs.fn(),
    addSession: rs.fn(),
    updateSession: rs.fn(),
    removeSession: rs.fn(),
    addReminder: rs.fn(),
    removeReminder: rs.fn(),
    addWaiting: rs.fn(),
    removeWaiting: rs.fn(),
    restoreTask: rs.fn(async () => true),
  };
}

function api(
  t: Task,
  over: Partial<TaskCommands> & { seed?: FakeTasksSeed; canEdit?: boolean } = {},
): Setup & ReturnType<typeof spies> {
  const { seed = {}, canEdit = true, ...commands } = over;
  return {
    ...spies(),
    ...commands,
    canEdit,
    seed: { buckets: [INBOX, APP], tasks: [t], ...seed },
  } as never;
}

/** A row of a Focus line-up in this test's workspace. */
const queued = (taskId: string, userId: string) => queueEntry(taskId, userId, { workspaceId: "w" });

function fakeRuntime(opts: { comments?: SpineComment[]; mySeconds?: number } = {}) {
  let comments = opts.comments ?? [];
  const addComment = rs.fn(
    async (input: { body: string; entityType: string; entityId: string }) => {
      const row: SpineComment = {
        id: `c${comments.length + 1}`,
        workspaceId: "w",
        entityType: input.entityType,
        entityId: input.entityId,
        body: input.body,
        createdBy: "u1",
        authorKind: "user",
        authorLabel: null,
        createdAt: "2026-10-09T10:00:00Z",
        updatedAt: "2026-10-09T10:00:00Z",
        deletedAt: null,
        editedAt: null,
        reactions: [],
      };
      comments = [...comments, row];
      return row;
    },
  );
  const runtime = {
    spine: {
      listComments: rs.fn(async () => comments),
      addComment,
      listLinks: async () => [],
      getEntities: async () => [],
    },
    tasks: {
      listTimeTotals: rs.fn(async () =>
        opts.mySeconds === undefined
          ? []
          : [
              {
                taskId: "t1",
                totalSeconds: 4800,
                mySeconds: opts.mySeconds,
                myWaitingSeconds: 0,
                mySecondsSince: null,
              },
            ],
      ),
    },
  };
  return { runtime: runtime as unknown as ModuoRuntime, addComment, spine: runtime.spine };
}

/** Under the page's Tasks context: the test's seed, its spies for the commands. */
function renderTasks(ui: ReactElement, a: Setup, runtime: ModuoRuntime | null = null) {
  const { seed, canEdit, ...commands } = a;
  return renderWithTasks(ui, {
    seed,
    commands,
    permission: canEdit ? "edit" : "view",
    workspaceId: "w",
    // The spine and the time totals the panel reads through its `runtime`.
    runtime: (runtime ?? undefined) as never,
  });
}

function renderPanel(t: Task, a: Setup, runtime: ModuoRuntime | null = null, canEdit = true) {
  return renderTasks(
    <TooltipProvider>
      <TaskDetailPanel
        task={t}
        canEdit={canEdit}
        onRequestCapture={() => {}}
        onSelectTask={() => {}}
        runtime={runtime}
        workspaceId={runtime ? "w" : null}
      />
    </TooltipProvider>,
    a,
    runtime,
  );
}

const ROW_LABELS = [
  "Status",
  "Assignee",
  "Priority",
  "Due",
  "Energy",
  "Scheduled",
  "Reminder",
  "Estimate",
  "Repeat",
  "Tags",
];

/** The labels of the property rows on screen (the "+" line names more, as text). */
function shownRows(): string[] {
  const labels = [...document.querySelectorAll("[data-slot=property-row]")].map(
    (row) => row.firstElementChild?.textContent ?? "",
  );
  return ROW_LABELS.filter((l) => labels.includes(l));
}

const OPTIONAL_NAMES = ["Energy", "Scheduled", "Reminder", "Estimate", "Repeat", "Waiting on"];

/** The quiet "+" line: one control naming what isn't shown yet (MOD-114). */
function addLine(): HTMLElement {
  return screen.getByRole("button", { name: /^Add a property/ });
}

async function openAddMenu(): Promise<HTMLElement> {
  fireEvent.pointerDown(addLine(), { button: 0, pointerType: "mouse" });
  return screen.findByRole("menu");
}

describe("the comp layout and property rule C (U3-1)", () => {
  it("shows the core properties always and names the rest in one quiet line", async () => {
    await renderPanel(task(), api(task()));
    expect(shownRows()).toEqual(["Status", "Assignee", "Priority", "Due", "Tags"]);
    for (const name of OPTIONAL_NAMES) expect(addLine().textContent).toContain(name);
    // Its name holds the words it shows (label in name).
    expect(addLine().getAttribute("aria-label")).toBe(
      `Add a property: ${OPTIONAL_NAMES.join(", ")}`,
    );
    // Checkbox beside a wrapping title, no chevrons on the values.
    expect(screen.getByRole("button", { name: "Mark as done" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Task title" }).tagName).toBe("TEXTAREA");
    expect(screen.getByRole("button", { name: "Status: To do" })).toBeTruthy();
    // Values are PropertyValues even under a Radix trigger, and none has a chevron.
    expect(document.querySelectorAll("[data-slot=property-value]").length).toBeGreaterThanOrEqual(
      5,
    );
    expect(document.querySelector("[data-slot=property-value] .lucide-chevron-down")).toBeNull();
  });

  it("shows a set optional property as a row, and its name leaves the quiet line", async () => {
    const t = task({ energyLevel: "high", recurrence: null, scheduledAt: "2026-10-09T09:00:00Z" });
    await renderPanel(t, api(t));
    expect(shownRows()).toEqual([
      "Status",
      "Assignee",
      "Priority",
      "Due",
      "Energy",
      "Scheduled",
      "Tags",
    ]);
    expect(addLine().textContent).not.toContain("Energy");
    expect(addLine().textContent).toContain("Estimate");
  });

  it("picking a name in the quiet line's menu shows that row, empty", async () => {
    await renderPanel(task(), api(task()));
    const menu = await openAddMenu();
    // The menu lists every property the line names, in panel order.
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(OPTIONAL_NAMES);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Repeat" }));
    await waitFor(() => expect(shownRows()).toContain("Repeat"));
    expect(addLine().textContent).not.toContain("Repeat");
  });

  it('reads the Estimate row as "1h 20m of ~4h" with my share, the bar on its own line', async () => {
    const t = task({ timeSpentSeconds: 4800, durationMinutes: 240 });
    const { runtime } = fakeRuntime({ mySeconds: 3000 });
    await renderPanel(t, api(t), runtime);
    const time = screen.getByRole("button", { name: /^Estimate: 1h 20m, of ~4h/ });
    // "1h 20m of ~4h" never breaks between its parts (checkpoint 1).
    expect(time.querySelector(".whitespace-nowrap")?.textContent).toBe("1h 20m of ~4h");
    expect(time.textContent).toContain("1h 20m");
    expect(time.textContent).toContain("of ~4h");
    // My share sits on the line under the value, with the bar (never inside it).
    await waitFor(() => expect(screen.getByText("you 50m")).toBeTruthy());
    expect(time.textContent).not.toContain("you 50m");
  });

  it("view-only members see the values but no quiet line, and ⋯ only copies", async () => {
    await renderPanel(task(), api(task()), null, false);
    expect(screen.queryByRole("button", { name: /^Add a property/ })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Status: To do" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    const more = screen.getByRole("button", { name: "More actions" });
    fireEvent.pointerDown(more, { button: 0, pointerType: "mouse" });
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /Copy branch name/ })).toBeTruthy(),
    );
    expect(screen.queryByRole("menuitem", { name: /Delete/ })).toBeNull();
  });
});

describe("the description comes before the properties (MOD-116, the prototypes' order)", () => {
  const follows = (a: Element, b: Element) =>
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it("in the panel: title, description, then the properties", async () => {
    await renderPanel(task(), api(task()));
    const title = screen.getByRole("textbox", { name: "Task title" });
    const description = screen.getByRole("textbox", { name: "Description" });
    const status = screen.getByRole("button", { name: "Status: To do" });
    expect(follows(title, description)).toBe(true);
    expect(follows(description, status)).toBe(true);
  });

  it("on the full page too, in the narrow column and the wide one", async () => {
    await renderTasks(
      <TooltipProvider>
        <TaskDetailPanel
          task={task()}
          canEdit
          onRequestCapture={() => {}}
          onSelectTask={() => {}}
          layout="page"
        />
      </TooltipProvider>,
      api(task()),
    );
    const description = screen.getByRole("textbox", { name: "Description" });
    const statuses = screen.getAllByRole("button", { name: "Status: To do" });
    expect(statuses.length).toBeGreaterThan(0);
    for (const status of statuses) expect(follows(description, status)).toBe(true);
  });
});

describe('the "+" line is one line that opens a menu (MOD-114, round-2b)', () => {
  it("never wraps: the names sit on one clipped line", async () => {
    await renderPanel(task(), api(task()));
    const names = addLine().querySelector("[data-slot=add-property-names]") as HTMLElement;
    expect(names.className).toContain("whitespace-nowrap");
    expect(names.className).toContain("overflow-hidden");
    expect(names.className).not.toContain("flex-wrap");
    // One control, not a button per name.
    expect(within(addLine()).queryAllByRole("button")).toHaveLength(0);
  });

  it("opens from the keyboard, and a pick adds that property's row with its editor open", async () => {
    await renderPanel(task(), api(task()));
    addLine().focus();
    fireEvent.keyDown(addLine(), { key: "Enter" });
    const menu = await screen.findByRole("menu", { name: /^Add a property/ });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Energy" }));
    await waitFor(() => expect(shownRows()).toContain("Energy"));
    // The new row's picker is open (a modal menu, so the rest reads as hidden).
    expect(await screen.findByRole("menu", { name: "Energy: none" })).toBeTruthy();
    const line = screen.getByRole("button", { name: /^Add a property/, hidden: true });
    expect(line.textContent).not.toContain("Energy");
  });
});

describe("the breadcrumb stays on one line (MOD-118, round-2b)", () => {
  it("shortens the names with the full one on hover, and puts the handle at the end", async () => {
    const t = task({ number: 142, sectionId: "s1" });
    const longSection: Section = {
      id: "s1",
      workspaceId: "w",
      projectId: "b-app",
      name: "A section name long enough to need the ellipsis",
      position: 0,
      startsOn: null,
      endsOn: null,
      createdAt: "",
      updatedAt: "",
    };
    const a = api(t, { seed: { sections: [longSection] } });
    await renderTasks(
      <WorkspaceContext.Provider
        value={{ selectedWorkspace: { taskKey: "MOD" } } as unknown as WorkspaceContextValue}
      >
        <TooltipProvider>
          <TaskDetailPanel task={t} canEdit onRequestCapture={() => {}} onSelectTask={() => {}} />
        </TooltipProvider>
      </WorkspaceContext.Provider>,
      a,
    );
    const nav = screen.getByRole("navigation", { name: "Location" });
    expect(nav.className).toContain("flex-nowrap");
    expect(nav.className).not.toContain("flex-wrap ");
    const section = within(nav).getByRole("button", { name: /^Section: / });
    expect(section.querySelector("span")?.className).toContain("truncate");
    // The full name in the kit tooltip (as the handle's), not a native title.
    expect(section.getAttribute("title")).toBeNull();
    act(() => section.focus());
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "A section name long enough to need the ellipsis",
    );
    // The handle is the task's, outside the crumbs and their chevrons: the
    // next thing on the line after the nav, which grows to push it right.
    const handle = screen.getByRole("button", { name: "Copy MOD-142" });
    expect(nav.contains(handle)).toBe(false);
    expect(nav.nextElementSibling).toBe(handle);
    expect(nav.className).toContain("flex-1");
    expect(nav.querySelectorAll(".lucide-chevron-right")).toHaveLength(1);
  });
});

/** The panel the Tasks page hosts it in: "Details ▾" over the task, Project beside it. */
async function renderInRightPanel(
  t: Task,
  a: Setup,
  opts: { onOpenFullPage?: () => void; canEdit?: boolean } = {},
) {
  const taskDetails = () => (
    <TaskDetailPanel
      task={t}
      canEdit={opts.canEdit ?? true}
      onRequestCapture={() => {}}
      onSelectTask={() => {}}
      onOpenFullPage={opts.onOpenFullPage}
    />
  );
  const ui = (activeId: string, details: () => ReactNode) => (
    <WorkspaceContext.Provider
      value={{ selectedWorkspace: { taskKey: "MOD" } } as unknown as WorkspaceContextValue}
    >
      <TooltipProvider>
        <RightPanel
          module="tasks"
          views={{ details, project: () => <p>Project body</p> }}
          activeId={activeId}
          onChange={() => {}}
        />
      </TooltipProvider>
    </WorkspaceContext.Provider>
  );
  const utils = await renderTasks(ui("details", taskDetails), a);
  return {
    ...utils,
    show: (activeId: string, details: () => ReactNode = taskDetails) =>
      utils.rerender(ui(activeId, details)),
  };
}

/** The panel's title row: the one that holds "Details ▾". */
function titleRow(): HTMLElement {
  return screen.getByRole("button", { name: /^Panel view: / }).parentElement as HTMLElement;
}

/** Its right end, where a view's own actions show. */
function titleActions(): HTMLElement {
  return titleRow().querySelector("[data-slot=panel-title-actions]") as HTMLElement;
}

const labels = (scope: HTMLElement) =>
  within(scope)
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));

async function openMore(scope: HTMLElement = document.body): Promise<HTMLElement> {
  const more = within(scope).getByRole("button", { name: "More actions" });
  fireEvent.pointerDown(more, { button: 0, pointerType: "mouse" });
  return screen.findByRole("menu");
}

describe("the task's actions sit in the panel's title row (MOD-118 follow-up, round-2b frame 5)", () => {
  it('reads "Details ▾ … Focus ↗ ⋯"; the breadcrumb row holds only the crumbs and the handle', async () => {
    const t = task({ number: 142 });
    await renderInRightPanel(t, api(t), { onOpenFullPage: () => {} });
    expect(labels(titleActions())).toEqual(["Add to Focus", "Open full page", "More actions"]);
    // All three on one rung, the small control size (the toggle was 32 px).
    const heights = within(titleActions())
      .getAllByRole("button")
      .map((b) => [b.style.height, b.style.width]);
    expect(heights).toEqual(Array(3).fill(["var(--ctrl-h-sm)", "var(--ctrl-h-sm)"]));
    // ▶ "Focus on this" went into ⋯: no icon of its own.
    expect(screen.queryByRole("button", { name: "Focus on this" })).toBeNull();

    const nav = screen.getByRole("navigation", { name: "Location" });
    const crumbRow = nav.parentElement as HTMLElement;
    expect(titleRow().contains(nav)).toBe(false);
    expect([...crumbRow.children]).toEqual([
      nav,
      screen.getByRole("button", { name: "Copy MOD-142" }),
    ]);
  });

  it("they still work from there: full page, the Focus toggle, ⋯", async () => {
    const t = task();
    const onOpenFullPage = rs.fn();
    const a = api(t, { focusOnTask: rs.fn(() => true) });
    await renderInRightPanel(t, a, { onOpenFullPage });
    fireEvent.click(within(titleActions()).getByRole("button", { name: "Open full page" }));
    expect(onOpenFullPage).toHaveBeenCalledTimes(1);
    fireEvent.click(within(titleActions()).getByRole("button", { name: "Add to Focus" }));
    expect(a.toggleQueue).toHaveBeenCalledWith("t1");

    const focusOn = within(await openMore(titleActions())).getByRole("menuitem", {
      name: /Focus on this/,
    });
    expect(focusOn.textContent).toContain("⇧F");
    fireEvent.click(focusOn);
    expect(a.focusOnTask).toHaveBeenCalledWith("t1");

    const menu = await openMore(titleActions());
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Delete/ }));
    expect(a.deleteTask).toHaveBeenCalledWith("t1");
  });

  it("stays short at its fullest: a viewer, in their Focus, three people on it, one lined up", async () => {
    act(() => setRunClaims("w", new Map([["t1", ["u3", "u4", "u5"]]])));
    const t = task();
    // In my Focus, and in Mike's.
    const a = api(t, { canEdit: false, seed: { queue: [queued("t1", "u1"), queued("t1", "u2")] } });
    await renderInRightPanel(t, a, { onOpenFullPage: () => {}, canEdit: false });
    const slot = titleActions();
    // One avatar and "+2" for the three on it; the mark's name says who.
    const onIt = within(slot).getByRole("img", { name: /are on this$/ });
    expect(onIt.querySelectorAll("[data-slot=avatar]")).toHaveLength(1);
    expect(onIt.textContent).toContain("+2");
    // Mike, who has it lined up, then the viewer's own "In Focus" as an icon:
    // its words are in its name and tooltip, never on the row.
    expect(within(slot).getByRole("img", { name: "Also in Mike’s Focus" })).toBeTruthy();
    const inFocus = within(slot).getByRole("img", { name: "In Focus" });
    expect(inFocus.textContent).toBe("");
    expect(slot.textContent).not.toContain("In Focus");
    expect(labels(slot)).toEqual(["Open full page", "More actions"]);
  });

  it("the Project view and a multi-selection show none of the task's actions", async () => {
    const t = task();
    const { show } = await renderInRightPanel(t, api(t), { onOpenFullPage: () => {} });
    expect(titleActions().childElementCount).toBeGreaterThan(0);

    show("project");
    expect(screen.getByText("Project body")).toBeTruthy();
    expect(titleActions().childElementCount).toBe(0);

    // A multi-selection swaps Details' body for the shared values (the page's rule).
    show("details", () => (
      <BulkPanel
        tasks={[t, task({ id: "t2", title: "Second" })]}
        statusById={new Map()}
        bucketNameById={() => "Moduo App"}
        sections={[]}
        teams={[]}
        tagsByTask={new Map()}
        canEdit
        onPick={() => {}}
      />
    ));
    expect(titleActions().childElementCount).toBe(0);
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: /to Focus|in Focus/i })).toBeNull();
    // "2 tasks" is the title row's (the page's `title`, MOD-109), not a heading in the body.
    expect(screen.queryByRole("heading", { name: "2 tasks" })).toBeNull();
    expect(screen.getByRole("list", { name: "Selected tasks" })).toBeTruthy();
  });

  it("on the full page they sit in its header after ↑ ↓ (the prototype's `.fphead`)", async () => {
    const t = task({ number: 142 });
    await renderTasks(
      <WorkspaceContext.Provider
        value={{ selectedWorkspace: { taskKey: "MOD" } } as unknown as WorkspaceContextValue}
      >
        <TooltipProvider>
          <TaskFullPage
            backLabel="List · Moduo App"
            position={{ index: 0, total: 3 }}
            onPrev={null}
            onNext={() => {}}
            onClose={() => {}}
          >
            <TaskDetailPanel
              task={t}
              canEdit
              onRequestCapture={() => {}}
              onSelectTask={() => {}}
              onCloseFullPage={() => {}}
              layout="page"
            />
          </TaskFullPage>
        </TooltipProvider>
      </WorkspaceContext.Provider>,
      api(t),
    );
    const header = screen.getByRole("button", { name: "Next task" }).parentElement as HTMLElement;
    const slot = header.querySelector("[data-slot=full-page-actions]") as HTMLElement;
    expect(labels(slot)).toEqual(["Add to Focus", "Back to the panel", "More actions"]);
    // The hairline before them is 16 px tall, not the primitive's h-full (0 px in a row).
    const hairline = header.querySelector("[data-slot=separator]") as HTMLElement;
    expect(hairline.className).toContain("data-[orientation=vertical]:h-4");
    expect(hairline.className).not.toContain("h-full");
    const nav = screen.getByRole("navigation", { name: "Location" });
    expect([...(nav.parentElement as HTMLElement).children]).toEqual([
      nav,
      screen.getByRole("button", { name: "Copy MOD-142" }),
    ]);
  });
});

describe("the Focus toggle (U3-3; call 61 renamed the Queue)", () => {
  it("is one icon, never the old full-width button", async () => {
    const a = api(task());
    await renderPanel(task(), a);
    const queue = screen.getAllByRole("button", { name: /to Focus|in Focus/i });
    expect(queue).toHaveLength(1);
    expect(queue[0].getAttribute("aria-label")).toBe("Add to Focus");
    expect(queue[0].getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText("Commit to Queue")).toBeNull();
    expect(screen.queryByRole("button", { name: /queue/i })).toBeNull();
    fireEvent.click(queue[0]);
    expect(a.toggleQueue).toHaveBeenCalledWith("t1");
  });

  it("reads 'In Focus' once queued, and offers nothing for a done task", async () => {
    await renderPanel(task(), api(task(), { seed: { queue: [queued("t1", "u1")] } }));
    const toggle = screen.getByRole("button", { name: "In Focus" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    cleanup();
    const done = task({ status: "done" });
    await renderPanel(done, api(done));
    expect(screen.queryByRole("button", { name: /Focus/ })).toBeNull();
    expect(within(await openMore()).queryByRole("menuitem", { name: /Focus/ })).toBeNull();
  });

  it("⋯ → Focus on this (call 31): on top of Up next, with the clock; not for a viewer", async () => {
    const a = api(task(), { focusOnTask: rs.fn(() => true) });
    await renderPanel(task(), a);
    fireEvent.click(within(await openMore()).getByRole("menuitem", { name: /Focus on this/ }));
    expect(a.focusOnTask).toHaveBeenCalledWith("t1");
    cleanup();
    await renderPanel(task(), api(task()), null, false);
    expect(within(await openMore()).queryByRole("menuitem", { name: /Focus on this/ })).toBeNull();
  });
});

describe("comments on a task (U3-2)", () => {
  it("reads the task's comments into the feed, after its creation line", async () => {
    const { runtime, spine } = fakeRuntime({
      comments: [
        {
          id: "c1",
          workspaceId: "w",
          entityType: "task",
          entityId: "t1",
          body: "Let's start with the rail counts, @Maciej",
          createdBy: "u2",
          authorKind: "user",
          authorLabel: null,
          createdAt: "2026-10-07T20:02:00Z",
          updatedAt: "2026-10-07T20:02:00Z",
          deletedAt: null,
          editedAt: null,
          reactions: [],
        },
      ],
    });
    pickAll();
    await renderPanel(task(), api(task()), runtime);
    const feed = screen.getByRole("region", { name: "Comments and activity" });
    await waitFor(() => expect(within(feed).getByText("Mike")).toBeTruthy());
    expect(spine.listComments).toHaveBeenCalledWith({
      workspaceId: "w",
      entityType: "task",
      entityId: "t1",
    });
    expect(feed.textContent?.indexOf("created this")).toBeLessThan(
      feed.textContent?.indexOf("Let's start") ?? -1,
    );
    // A mention of me reads as a mention.
    expect(within(feed).getByText("@Maciej").className).toContain("bg-primary/14");
  });

  it("posts a comment with the people it still mentions", async () => {
    const { runtime, addComment } = fakeRuntime();
    await renderPanel(task(), api(task()), runtime);
    const box = screen.getByRole("textbox", {
      name: "Comment on this task",
    }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "@mi", selectionStart: 3 } });
    const option = await screen.findByRole("option", { name: "Mike" });
    fireEvent.click(option);
    expect(box.value).toBe("@Mike ");
    fireEvent.change(box, { target: { value: "@Mike can you check?", selectionStart: 20 } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    });
    await waitFor(() => expect(addComment).toHaveBeenCalledTimes(1));
    expect(addComment.mock.calls[0][0]).toMatchObject({
      workspaceId: "w",
      entityType: "task",
      entityId: "t1",
      body: "@Mike can you check?",
      mentionedUserIds: ["u2"],
      entityLabel: "Task Module UI/UX Review",
      entityIcon: "task",
    });
    await waitFor(() => expect(box.value).toBe(""));
  });

  it("doesn't notify someone whose mention was deleted before posting", async () => {
    const { runtime, addComment } = fakeRuntime();
    await renderPanel(task(), api(task()), runtime);
    const box = screen.getByRole("textbox", {
      name: "Comment on this task",
    }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "@", selectionStart: 1 } });
    fireEvent.click(await screen.findByRole("option", { name: "Mike" }));
    fireEvent.change(box, { target: { value: "never mind", selectionStart: 10 } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    });
    await waitFor(() => expect(addComment).toHaveBeenCalledTimes(1));
    expect(addComment.mock.calls[0][0]).toMatchObject({ body: "never mind", mentionedUserIds: [] });
  });
});

describe("an unset priority draws the bars, as capture does (MOD-134)", () => {
  it("shows the three faint bars, never a flag, in the value and the menu's None", async () => {
    await renderPanel(task({ priority: null }), api(task({ priority: null })));
    const value = screen.getByRole("button", { name: "Priority: none" });
    expect(value.querySelector('svg[data-level="0"]')).toBeTruthy();
    expect(value.querySelector(".lucide-flag")).toBeNull();
    fireEvent.pointerDown(value, { button: 0, pointerType: "mouse" });
    const none = await screen.findByRole("menuitemradio", { name: "None" });
    expect(none.querySelector('svg[data-level="0"]')).toBeTruthy();
  });

  it("a set priority still shows its filled bars", async () => {
    await renderPanel(task({ priority: "high" }), api(task({ priority: "high" })));
    const value = screen.getByRole("button", { name: "Priority: High" });
    expect(value.querySelector('svg[data-level="3"]')).toBeTruthy();
  });
});

describe("one way to name you (MOD-137)", () => {
  it("your task's assignee reads You; the picker lists you as your name plus (you)", async () => {
    await renderPanel(task(), api(task()));
    const value = screen.getByRole("button", { name: "Assignee: You" });
    expect(value.textContent).toContain("You");
    fireEvent.click(value);
    expect(await screen.findByRole("option", { name: /Alex Rivera \(you\)$/ })).toBeTruthy();
    // Typing "me" still finds you (your name holds no "m").
    fireEvent.change(screen.getByPlaceholderText("Assign to…"), { target: { value: "me" } });
    expect(screen.getByRole("option", { name: /Alex Rivera \(you\)$/ })).toBeTruthy();
  });

  it("an empty Reminder reads Add reminder, never Remind me", async () => {
    await renderPanel(task(), api(task()));
    const menu = await openAddMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Reminder" }));
    await waitFor(() => expect(shownRows()).toContain("Reminder"));
    const value = screen.getByRole("button", { name: "Reminder: add one", hidden: true });
    expect(value.textContent).toContain("Add reminder");
    expect(document.body.textContent).not.toContain("Remind me");
  });
});

describe("the activity reads like a thread, its box always in reach (MOD-129)", () => {
  const commentBox = () => screen.getByRole("textbox", { name: "Comment on this task" });

  it("in the panel, the comment box is pinned under the scrolling body", async () => {
    const { runtime } = fakeRuntime();
    await renderPanel(task(), api(task()), runtime);
    const pinned = commentBox().closest('[data-slot="task-composer"]') as HTMLElement;
    expect(pinned).toBeTruthy();
    // Outside the scroll box (its sibling above), so it stays put as the body scrolls.
    const body = pinned.previousElementSibling as HTMLElement;
    expect(body.className).toContain("overflow-y-auto");
    expect(body.contains(commentBox())).toBe(false);
    // It's still the feed's: posting goes through its thread (the tests above).
    const feed = screen.getByRole("region", { name: "Comments and activity" });
    expect(feed.contains(commentBox())).toBe(false);
  });

  it("on the full page, the box ends the activity", async () => {
    const { runtime } = fakeRuntime();
    const t = task();
    await renderTasks(
      <TooltipProvider>
        <TaskDetailPanel
          task={t}
          canEdit
          onRequestCapture={() => {}}
          onSelectTask={() => {}}
          runtime={runtime}
          workspaceId="w"
          layout="page"
        />
      </TooltipProvider>,
      api(t),
      runtime,
    );
    const feed = screen.getByRole("region", { name: "Comments and activity" });
    expect(feed.contains(commentBox())).toBe(true);
    expect(feed.lastElementChild?.contains(commentBox())).toBe(true);
    expect(document.querySelector('[data-slot="task-composer"]')).toBeNull();
  });

  it('drops the "Created by · Updated" line: the trail already says both', async () => {
    const { runtime } = fakeRuntime();
    pickAll();
    await renderPanel(task(), api(task()), runtime);
    const feed = screen.getByRole("region", { name: "Comments and activity" });
    await waitFor(() => expect(within(feed).getByText(/created this/)).toBeTruthy());
    expect(within(feed).queryByText(/Created by/)).toBeNull();
    expect(within(feed).queryByText(/Updated/)).toBeNull();
  });

  it("a viewer who can't comment gets no empty pinned strip", async () => {
    await renderPanel(task(), api(task()), null);
    expect(screen.queryByRole("textbox", { name: "Comment on this task" })).toBeNull();
    const slot = document.querySelector('[data-slot="task-composer"]') as HTMLElement;
    expect(slot.childElementCount).toBe(0);
    expect(slot.className).toContain("empty:hidden");
  });
});

describe("the feed opens on Comments, its switch at the title's size (MOD-157)", () => {
  const COMMENT: SpineComment = {
    id: "c1",
    workspaceId: "w",
    entityType: "task",
    entityId: "t1",
    body: "Rail counts first",
    createdBy: "u2",
    authorKind: "user",
    authorLabel: null,
    createdAt: "2026-10-07T20:02:00Z",
    updatedAt: "2026-10-07T20:02:00Z",
    deletedAt: null,
    editedAt: null,
    reactions: [],
  };
  const feed = () => screen.getByRole("region", { name: "Comments and activity" });
  const shown = (name: "All" | "Comments") =>
    within(feed()).getByRole("radio", { name }).getAttribute("aria-checked");

  it("shows only the talk until you pick All", async () => {
    const { runtime } = fakeRuntime({ comments: [COMMENT] });
    await renderPanel(task(), api(task()), runtime);
    await waitFor(() => expect(within(feed()).getByText("Rail counts first")).toBeTruthy());
    expect(shown("Comments")).toBe("true");
    expect(shown("All")).toBe("false");
    // The trail's lines (its creation line here) wait behind All.
    expect(within(feed()).queryByText(/created this/)).toBeNull();
  });

  it("a task with changes but no comments says so in one quiet line, and keeps its box", async () => {
    const { runtime } = fakeRuntime();
    const t = task();
    const changed: ActivityEntry = {
      id: "a1",
      workspaceId: "w",
      module: "tasks",
      entityType: "task",
      entityId: "t1",
      op: "tasks.update",
      actorType: "user",
      actorId: "u2",
      actorLabel: "Mike",
      payload: { fields: ["priority"] },
      createdAt: "2026-10-07T09:00:00Z",
    };
    const loadActivity = rs.fn(async () => [changed]);
    await renderPanel(t, api(t, { loadActivity }), runtime);
    await waitFor(() => expect(within(feed()).getByText("No comments yet.")).toBeTruthy());
    expect(loadActivity).toHaveBeenCalled();
    // The change waits behind All.
    expect(within(feed()).queryByText("Mike")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Comment on this task" })).toBeTruthy();
  });

  it("when the comments don't load, says that, never 'No comments yet.' too", async () => {
    const { runtime, spine } = fakeRuntime();
    spine.listComments = rs.fn(async () => {
      throw new Error("offline");
    });
    await renderPanel(task(), api(task()), runtime);
    await waitFor(() => expect(within(feed()).getByText(/didn’t load/)).toBeTruthy());
    expect(within(feed()).queryByText("No comments yet.")).toBeNull();
  });

  it("All brings the changes back, and stays picked on this device", async () => {
    const { runtime } = fakeRuntime({ comments: [COMMENT] });
    await renderPanel(task(), api(task()), runtime);
    fireEvent.click(within(feed()).getByRole("radio", { name: "All" }));
    await waitFor(() => expect(within(feed()).getByText(/created this/)).toBeTruthy());
    expect(localStorage.getItem(FEED_FILTER_KEY)).toBe("all");
    cleanup();
    await renderPanel(task(), api(task()), runtime);
    expect(shown("All")).toBe("true");
  });

  it("an earlier Comments pick, or anything but All, reads as Comments", async () => {
    for (const stored of ["comments", "bogus"]) {
      localStorage.setItem(FEED_FILTER_KEY, stored);
      const { runtime } = fakeRuntime();
      await renderPanel(task(), api(task()), runtime);
      expect(shown("Comments")).toBe("true");
      cleanup();
    }
    // The control: a stored All is read, so the cases above came from storage.
    pickAll();
    await renderPanel(task(), api(task()), fakeRuntime().runtime);
    expect(shown("All")).toBe("true");
  });

  it("draws the switch on the quiet header size, not the control rung", async () => {
    const { runtime } = fakeRuntime();
    await renderPanel(task(), api(task()), runtime);
    const sw = within(feed()).getByRole("radiogroup", { name: "Show" });
    expect(sw.getAttribute("data-size")).toBe("xs");
    expect(within(sw).getByRole("radio", { name: "All" }).className).toContain("text-sm");
  });
});

describe("validator round", () => {
  it("never writes back the tracked total the Time editor opened with", async () => {
    const before = task({ timeSpentSeconds: 4800, durationMinutes: 240 });
    const a = api(before);
    const view = await renderPanel(before, a);
    fireEvent.click(screen.getByRole("button", { name: /^Estimate: 1h 20m/ }));
    const estimate = (await screen.findByLabelText("Estimate")) as HTMLInputElement;
    // Focus saves a minute while the editor is open.
    const after = { ...before, timeSpentSeconds: 4860 };
    view.rerender(
      <TooltipProvider>
        <TaskDetailPanel
          task={after}
          canEdit
          onRequestCapture={() => {}}
          onSelectTask={() => {}}
          runtime={null}
          workspaceId={null}
        />
      </TooltipProvider>,
    );
    fireEvent.change(estimate, { target: { value: "5h" } });
    fireEvent.keyDown(estimate, { key: "Enter" });
    // TV-D10: the estimate is its own field.
    expect(a.patchTask).toHaveBeenCalledWith("t1", { estimateMinutes: 300 });
    expect(a.setTimeSpent).not.toHaveBeenCalled();
  });

  it("after typing a total, a later commit doesn't send it again over newer time", async () => {
    const before = task({ timeSpentSeconds: 4800, durationMinutes: 240 });
    const a = api(before);
    const view = await renderPanel(before, a);
    fireEvent.click(screen.getByRole("button", { name: /^Estimate: 1h 20m/ }));
    const tracked = (await screen.findByLabelText("Tracked")) as HTMLInputElement;
    fireEvent.change(tracked, { target: { value: "2h" } });
    fireEvent.blur(tracked);
    expect(a.setTimeSpent).toHaveBeenCalledWith("t1", 7200);
    // Focus saves a minute after the typed total landed.
    const after = { ...before, timeSpentSeconds: 7260 };
    view.rerender(
      <TooltipProvider>
        <TaskDetailPanel
          task={after}
          canEdit
          onRequestCapture={() => {}}
          onSelectTask={() => {}}
          runtime={null}
          workspaceId={null}
        />
      </TooltipProvider>,
    );
    const estimate = screen.getByLabelText("Estimate") as HTMLInputElement;
    fireEvent.change(estimate, { target: { value: "5h" } });
    fireEvent.keyDown(estimate, { key: "Enter" });
    expect(a.setTimeSpent).toHaveBeenCalledTimes(1);
    // TV-D10: the estimate is its own field.
    expect(a.patchTask).toHaveBeenCalledWith("t1", { estimateMinutes: 300 });
  });

  it("reads a task's comments once when it opens", async () => {
    const { runtime, spine } = fakeRuntime();
    // An op saved before the panel opens has moved the trail's stamp.
    const seen: { commands: TaskCommands | null; stamp: number } = { commands: null, stamp: 0 };
    function Earlier() {
      seen.commands = useTaskCommands();
      seen.stamp = useTasksActivityStamp();
      return null;
    }
    const { patchTask: _real, ...commands } = api(task());
    const view = await renderTasks(<Earlier />, commands, runtime);
    act(() => {
      seen.commands?.patchTask("t1", { priority: "high" });
    });
    await waitFor(() => expect(seen.stamp).toBeGreaterThan(0));
    view.rerender(
      <TooltipProvider>
        <TaskDetailPanel
          task={task()}
          canEdit
          onRequestCapture={() => {}}
          onSelectTask={() => {}}
          runtime={runtime}
          workspaceId="w"
        />
      </TooltipProvider>,
    );
    await waitFor(() => expect(spine.listComments).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(spine.listComments).toHaveBeenCalledTimes(1);
  });

  it("doesn't read the workspace's time totals for a task with no time", async () => {
    const { runtime } = fakeRuntime({ mySeconds: 0 });
    await renderPanel(task(), api(task()), runtime);
    await new Promise((r) => setTimeout(r, 400));
    expect(
      (runtime.tasks.listTimeTotals as unknown as { mock: { calls: unknown[] } }).mock.calls,
    ).toHaveLength(0);
  });
});

describe("a task the server doesn't have yet (tmp- id)", () => {
  function readers() {
    const { runtime, spine } = fakeRuntime();
    const listLinks = rs.fn(async () => []);
    const listForEntity = rs.fn(async () => []);
    Object.assign(spine, { listLinks });
    Object.assign(runtime, { attachments: { listForEntity, status: async () => null } });
    return { runtime, listComments: spine.listComments, listLinks, listForEntity };
  }

  it("reads no comments, links or files until it has its real id", async () => {
    const r = readers();
    const t = task({ id: "tmp-6f1c" });
    await renderPanel(t, api(t), r.runtime);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(r.listComments).not.toHaveBeenCalled();
    expect(r.listLinks).not.toHaveBeenCalled();
    expect(r.listForEntity).not.toHaveBeenCalled();
    // The title and properties still show at once.
    expect(screen.getByRole("textbox", { name: "Task title" })).toBeTruthy();
  });

  it("reads them once the saved task replaces it", async () => {
    const r = readers();
    const temp = task({ id: "tmp-6f1c" });
    const view = await renderPanel(temp, api(temp), r.runtime);
    const saved = task({ id: "t1" });
    view.rerender(
      <TooltipProvider>
        <TaskDetailPanel
          task={saved}
          canEdit
          onRequestCapture={() => {}}
          onSelectTask={() => {}}
          runtime={r.runtime}
          workspaceId="w"
        />
      </TooltipProvider>,
    );
    await waitFor(() => expect(r.listComments).toHaveBeenCalled());
    await waitFor(() => expect(r.listLinks).toHaveBeenCalled());
    await waitFor(() => expect(r.listForEntity).toHaveBeenCalled());
  });
});

describe("reordering subtasks (TV-U10)", () => {
  const parent = task({ id: "p", position: "0000000010" });
  const one = task({ id: "s1", title: "First step", parentId: "p", position: "0000000020" });
  const two = task({ id: "s2", title: "Second step", parentId: "p", position: "0000000030" });
  const withSubtasks = () => {
    const dropTask = rs.fn(async () => true);
    const a = api(parent, { seed: { tasks: [parent, one, two] }, dropTask });
    return { a, dropTask };
  };
  const moveUp = (title: string) =>
    fireEvent.keyDown(screen.getByRole("button", { name: `Open subtask: ${title}` }), {
      key: "ArrowUp",
      altKey: true,
      shiftKey: true,
    });

  it("⌥⇧↑ moves a subtask up among its siblings, with the drop's Undo label", async () => {
    const { a, dropTask } = withSubtasks();
    await renderPanel(parent, a);
    moveUp("Second step");
    const [write, label] = dropTask.mock.calls[0] as unknown as [
      { taskId: string; position: string },
      string,
    ];
    expect(label).toBe("Moved up");
    expect(write.taskId).toBe("s2");
    expect(write.position > parent.position && write.position < one.position).toBe(true);
    // The first can't go higher.
    moveUp("First step");
    expect(dropTask).toHaveBeenCalledTimes(1);
  });

  it("read-only, the keys move nothing", async () => {
    const { a, dropTask } = withSubtasks();
    await renderPanel(parent, a, null, false);
    moveUp("Second step");
    expect(dropTask).not.toHaveBeenCalled();
  });
});

describe("a connected app's avatar is a plug, a former member's a ? (MOD-149)", () => {
  const change = (over: Partial<ActivityEntry>): ActivityEntry => ({
    id: "a1",
    workspaceId: "w",
    module: "tasks",
    entityType: "task",
    entityId: "t1",
    op: "tasks.update",
    actorType: "user",
    actorId: "u2",
    actorLabel: "Mike",
    payload: { fields: ["priority"] },
    createdAt: "2026-10-07T09:00:00Z",
    ...over,
  });
  const feed = () => screen.getByRole("region", { name: "Comments and activity" });
  /** The avatar on the feed line or card that says `text`. */
  const avatarBy = (text: string) => {
    let el: HTMLElement | null = within(feed()).getAllByText(text)[0] ?? null;
    while (el && !el.querySelector("[data-slot=avatar]")) el = el.parentElement;
    return el?.querySelector("[data-slot=avatar]") as HTMLElement;
  };

  it("in the trail: a key's change shows the plug, Moduo's the Moduo mark, someone gone ?", async () => {
    pickAll();
    const activity = [
      // The key's id, never a member's: no person to find for it.
      change({
        id: "a1",
        actorType: "api_key",
        actorId: "k1",
        actorLabel: "Mike · via Claude Code",
      }),
      change({
        id: "a2",
        op: "tasks.set_status",
        actorType: "agent",
        actorId: null,
        actorLabel: "Moduo",
        createdAt: "2026-10-07T10:00:00Z",
      }),
      change({ id: "a3", actorId: "u9", actorLabel: "Ola", createdAt: "2026-10-07T11:00:00Z" }),
    ];
    const { runtime } = fakeRuntime();
    await renderPanel(task(), api(task(), { loadActivity: async () => activity }), runtime);
    await waitFor(() => expect(within(feed()).getByText("Ola")).toBeTruthy());
    const key = avatarBy("Mike · via Claude Code");
    expect(key.getAttribute("data-kind")).toBe("app");
    expect(key.querySelector("svg.lucide-plug")).toBeTruthy();
    expect(key.textContent).toBe("");
    // Moduo's own line (a catch-up, a waiting-on that came in: actor "agent", no id) shows
    // the Moduo mark on the same gray circle (MOD-149 follow-up).
    const moduo = avatarBy("Moduo");
    expect(moduo.getAttribute("data-kind")).toBe("moduo");
    expect(moduo.getAttribute("data-label")).toBe("gray");
    expect(moduo.querySelector("svg.lucide-plug")).toBeNull();
    expect(moduo.querySelector('svg[viewBox="0 0 1000 1000"]')).toBeTruthy();
    expect(moduo.textContent).toBe("");
    const gone = avatarBy("Ola");
    expect(gone.hasAttribute("data-kind")).toBe(false);
    expect(gone.getAttribute("data-label")).toBe("gray");
    expect(gone.textContent).toBe("?");
  });

  it("on a comment: an app's shows the plug beside its name, a person's their initials", async () => {
    const byKey: SpineComment = {
      id: "c1",
      workspaceId: "w",
      entityType: "task",
      entityId: "t1",
      body: "Filed from the connector",
      // A key's comment belongs to its creator but reads as the app.
      createdBy: "u2",
      authorKind: "api_key",
      authorLabel: "Claude Code",
      createdAt: "2026-10-07T20:02:00Z",
      updatedAt: "2026-10-07T20:02:00Z",
      deletedAt: null,
      editedAt: null,
      reactions: [],
    };
    const byMike: SpineComment = {
      ...byKey,
      id: "c2",
      body: "Thanks",
      authorKind: "user",
      authorLabel: null,
      createdAt: "2026-10-07T20:05:00Z",
    };
    const { runtime } = fakeRuntime({ comments: [byKey, byMike] });
    await renderPanel(task(), api(task()), runtime);
    await waitFor(() => expect(within(feed()).getByText("Claude Code (app)")).toBeTruthy());
    expect(avatarBy("Claude Code (app)").getAttribute("data-kind")).toBe("app");
    const mike = avatarBy("Mike");
    expect(mike.hasAttribute("data-kind")).toBe(false);
    expect(mike.textContent).toBe("MI");
  });
});

describe("the tags' + ends the chips, at their height (MOD-158)", () => {
  const tag = (id: string, name: string): Tag => ({
    id,
    workspaceId: "w",
    ownerId: "u1",
    name,
    color: "pink",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  });
  const TAGS = [tag("g1", "shell"), tag("g2", "visual")];
  const withTags = (tags: Tag[]) =>
    api(task(), { seed: { tags: TAGS, tagLinks: tags.map((t) => tagLink(t.id, "t1", "w")) } });

  it("rides with the last chip as the round 22 px +, never the 26 px value square", async () => {
    await renderPanel(task(), withTags(TAGS));
    const add = screen.getByRole("button", { name: "Add tag" });
    expect(add.getAttribute("data-slot")).toBe("tag-add");
    expect(add.className).toContain("size-5.5");
    // In one group with the last chip, so it can't wrap onto a line alone.
    const group = add.parentElement as HTMLElement;
    const chips = group.querySelectorAll('[data-slot="tag-chip"]');
    expect(chips).toHaveLength(1);
    expect(chips[0]?.textContent).toBe("visual");
    expect(group.lastElementChild).toBe(add);
  });

  it("opens the tag picker through both its triggers (popover and tooltip)", async () => {
    await renderPanel(task(), withTags(TAGS));
    const add = screen.getByRole("button", { name: "Add tag" });
    expect(add.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(add);
    expect(await screen.findByPlaceholderText("Filter or create…")).toBeTruthy();
    expect(add.getAttribute("aria-expanded")).toBe("true");
  });

  it("with no tags yet, the value still reads Add tag", async () => {
    await renderPanel(task(), withTags([]));
    const add = screen.getByRole("button", { name: "Add tag" });
    expect(add.getAttribute("data-slot")).toBe("property-value");
    expect(add.textContent).toContain("Add tag");
  });

  it("read-only: the chips and no +", async () => {
    await renderPanel(task(), withTags(TAGS), null, false);
    expect(screen.queryByRole("button", { name: "Add tag" })).toBeNull();
    expect(document.querySelectorAll('[data-slot="tag-chip"]')).toHaveLength(2);
  });
});
