// TV-U3 on the real panel: the comp layout with property rule C and the Time row
// (U3-1), comments read and written on the task (U3-2), and the queue toggle in
// the header instead of the old full-width button (U3-3).

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const PEOPLE = {
  u1: { userId: "u1", name: "Me", avatarUrl: null, isMe: true, canTakeTasks: true },
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

import type { ModuoRuntime, SpineComment } from "@/lib/runtime.types";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { WorkspaceContext, type WorkspaceContextValue } from "../../workspaces/workspace-context";
import { makeTask } from "../helpers";
import { clearTaskTimeShares } from "../hooks/use-task-time-share";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Bucket, Task } from "../model";
import { TaskDetailPanel } from "./task-detail-panel";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});
afterEach(() => {
  cleanup();
  clearTaskTimeShares();
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

function api(t: Task, over: Partial<TasksModuleApi> = {}): TasksModuleApi {
  return {
    canEdit: true,
    tasks: [t],
    tags: [],
    tagsByTask: new Map(),
    subtasksByParent: new Map(),
    subtaskProgressByTask: new Map(),
    statuses: [],
    statusById: new Map(),
    statusesForBucket: () => [],
    setTaskStatus: rs.fn(),
    blockersByTask: new Map(),
    dependentsByTask: new Map(),
    taskRelations: [],
    queuedTaskIds: new Set<string>(),
    queueClaims: new Map(),
    activityStamp: 0,
    currentUserId: "u1",
    loadActivity: async () => [],
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
    // TV-U13: the task's rows and structure from the store.
    sessions: [],
    reminders: [],
    waiting: [],
    teams: [],
    areas: [],
    sections: [],
    commentStamps: new Map(),
    inbox: INBOX,
    addSession: rs.fn(),
    updateSession: rs.fn(),
    removeSession: rs.fn(),
    addReminder: rs.fn(),
    removeReminder: rs.fn(),
    addWaiting: rs.fn(),
    removeWaiting: rs.fn(),
    restoreTask: rs.fn(async () => true),
    ...over,
  } as unknown as TasksModuleApi;
}

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

function renderPanel(
  t: Task,
  a: TasksModuleApi,
  runtime: ModuoRuntime | null = null,
  canEdit = true,
) {
  return render(
    <TooltipProvider>
      <TaskDetailPanel
        task={t}
        buckets={[APP]}
        inbox={INBOX}
        canEdit={canEdit}
        onRequestCapture={() => {}}
        onSelectTask={() => {}}
        api={a}
        runtime={runtime}
        workspaceId={runtime ? "w" : null}
      />
    </TooltipProvider>,
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

function shownRows(): string[] {
  return ROW_LABELS.filter((l) => screen.queryByText(l, { selector: "span" }) !== null);
}

describe("the comp layout and property rule C (U3-1)", () => {
  it("shows the core properties always and names the rest in one quiet line", () => {
    renderPanel(task(), api(task()));
    expect(shownRows()).toEqual(["Status", "Assignee", "Priority", "Due", "Tags"]);
    for (const name of ["energy", "scheduled", "reminder", "estimate", "repeat", "waiting on"]) {
      expect(screen.getByRole("button", { name: `Add ${name}` })).toBeTruthy();
    }
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

  it("shows a set optional property as a row, and its name leaves the quiet line", () => {
    const t = task({ energyLevel: "high", recurrence: null, scheduledAt: "2026-10-09T09:00:00Z" });
    renderPanel(t, api(t));
    expect(shownRows()).toEqual([
      "Status",
      "Assignee",
      "Priority",
      "Due",
      "Energy",
      "Scheduled",
      "Tags",
    ]);
    expect(screen.queryByRole("button", { name: "Add energy" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add estimate" })).toBeTruthy();
  });

  it("picking a name in the quiet line shows that row, empty", () => {
    renderPanel(task(), api(task()));
    fireEvent.click(screen.getByRole("button", { name: "Add repeat" }));
    expect(shownRows()).toContain("Repeat");
    expect(screen.queryByRole("button", { name: "Add repeat" })).toBeNull();
  });

  it('reads the Estimate row as "1h 20m of ~4h" with my share, the bar on its own line', async () => {
    const t = task({ timeSpentSeconds: 4800, durationMinutes: 240 });
    const { runtime } = fakeRuntime({ mySeconds: 3000 });
    renderPanel(t, api(t), runtime);
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
    renderPanel(task(), api(task()), null, false);
    expect(screen.queryByRole("button", { name: "Add energy" })).toBeNull();
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

  it("in the panel: title, description, then the properties", () => {
    renderPanel(task(), api(task()));
    const title = screen.getByRole("textbox", { name: "Task title" });
    const description = screen.getByRole("textbox", { name: "Description" });
    const status = screen.getByRole("button", { name: "Status: To do" });
    expect(follows(title, description)).toBe(true);
    expect(follows(description, status)).toBe(true);
  });

  it("on the full page too, in the narrow column and the wide one", () => {
    render(
      <TooltipProvider>
        <TaskDetailPanel
          task={task()}
          buckets={[APP]}
          inbox={INBOX}
          canEdit
          onRequestCapture={() => {}}
          onSelectTask={() => {}}
          api={api(task())}
          layout="page"
        />
      </TooltipProvider>,
    );
    const description = screen.getByRole("textbox", { name: "Description" });
    const statuses = screen.getAllByRole("button", { name: "Status: To do" });
    expect(statuses.length).toBeGreaterThan(0);
    for (const status of statuses) expect(follows(description, status)).toBe(true);
  });
});

describe("the breadcrumb stays on one line (MOD-118, round-2b)", () => {
  it("shortens the names with the full one on hover, and puts the handle at the end", () => {
    const t = task({ number: 142, sectionId: "s1" });
    const a = api(t, {
      sections: [
        {
          id: "s1",
          projectId: "b-app",
          name: "A section name long enough to need the ellipsis",
          position: 0,
        },
      ],
    } as unknown as Partial<TasksModuleApi>);
    render(
      <WorkspaceContext.Provider
        value={{ selectedWorkspace: { taskKey: "MOD" } } as unknown as WorkspaceContextValue}
      >
        <TooltipProvider>
          <TaskDetailPanel
            task={t}
            buckets={[APP]}
            inbox={INBOX}
            canEdit
            onRequestCapture={() => {}}
            onSelectTask={() => {}}
            api={a}
          />
        </TooltipProvider>
      </WorkspaceContext.Provider>,
    );
    const nav = screen.getByRole("navigation", { name: "Location" });
    expect(nav.className).toContain("flex-nowrap");
    expect(nav.className).not.toContain("flex-wrap ");
    const section = within(nav).getByRole("button", { name: /^Section: / });
    expect(section.getAttribute("title")).toBe("A section name long enough to need the ellipsis");
    expect(section.querySelector("span")?.className).toContain("truncate");
    expect(
      within(nav)
        .getByRole("button", { name: /^Project: / })
        .getAttribute("title"),
    ).toBe("Moduo App");
    // The handle is the task's, outside the crumbs and their chevrons, pushed right.
    const handle = screen.getByRole("button", { name: "Copy MOD-142" });
    expect(nav.contains(handle)).toBe(false);
    expect(nav.parentElement?.contains(handle)).toBe(true);
    expect(handle.className).toContain("ml-auto");
    expect(nav.querySelectorAll(".lucide-chevron-right")).toHaveLength(1);
  });
});

describe("the Focus toggle lives in the header (U3-3; call 61 renamed the Queue)", () => {
  it("has one Focus toggle, in the header beside copy link and ⋯; no full-width button", () => {
    const a = api(task());
    renderPanel(task(), a);
    const queue = screen.getAllByRole("button", { name: /to Focus|in Focus/i });
    expect(queue).toHaveLength(1);
    expect(queue[0].getAttribute("aria-label")).toBe("Add to Focus");
    expect(queue[0].getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText("Commit to Queue")).toBeNull();
    expect(screen.queryByRole("button", { name: /queue/i })).toBeNull();
    const header = queue[0].parentElement as HTMLElement;
    expect(within(header).getByRole("button", { name: "More actions" })).toBeTruthy();
    expect(within(header).getByRole("navigation", { name: "Location" }).textContent).toContain(
      "Moduo App",
    );
    fireEvent.click(queue[0]);
    expect(a.toggleQueue).toHaveBeenCalledWith("t1");
  });

  it("reads 'In Focus' once queued, and offers nothing for a done task", () => {
    renderPanel(task(), api(task(), { queuedTaskIds: new Set(["t1"]) }));
    const toggle = screen.getByRole("button", { name: "In Focus" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    cleanup();
    const done = task({ status: "done" });
    renderPanel(done, api(done));
    expect(screen.queryByRole("button", { name: /Focus/ })).toBeNull();
  });

  it("▶ is Focus on this (call 31): on top of Up next, with the clock", () => {
    const a = api(task(), { focusOnTask: rs.fn(() => true) });
    renderPanel(task(), a);
    fireEvent.click(screen.getByRole("button", { name: "Focus on this" }));
    expect(a.focusOnTask).toHaveBeenCalledWith("t1");
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
    renderPanel(task(), api(task()), runtime);
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
    renderPanel(task(), api(task()), runtime);
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
    renderPanel(task(), api(task()), runtime);
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

describe("validator round", () => {
  it("never writes back the tracked total the Time editor opened with", async () => {
    const before = task({ timeSpentSeconds: 4800, durationMinutes: 240 });
    const a = api(before);
    const view = renderPanel(before, a);
    fireEvent.click(screen.getByRole("button", { name: /^Estimate: 1h 20m/ }));
    const estimate = (await screen.findByLabelText("Estimate")) as HTMLInputElement;
    // Focus saves a minute while the editor is open.
    const after = { ...before, timeSpentSeconds: 4860 };
    view.rerender(
      <TooltipProvider>
        <TaskDetailPanel
          task={after}
          buckets={[APP]}
          inbox={INBOX}
          canEdit
          onRequestCapture={() => {}}
          onSelectTask={() => {}}
          api={{ ...a, tasks: [after] } as TasksModuleApi}
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
    const view = renderPanel(before, a);
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
          buckets={[APP]}
          inbox={INBOX}
          canEdit
          onRequestCapture={() => {}}
          onSelectTask={() => {}}
          api={{ ...a, tasks: [after] } as TasksModuleApi}
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
    renderPanel(task(), api(task(), { activityStamp: 3 }), runtime);
    await waitFor(() => expect(spine.listComments).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(spine.listComments).toHaveBeenCalledTimes(1);
  });

  it("doesn't read the workspace's time totals for a task with no time", async () => {
    const { runtime } = fakeRuntime({ mySeconds: 0 });
    renderPanel(task(), api(task()), runtime);
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
    renderPanel(t, api(t), r.runtime);
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
    const view = renderPanel(temp, api(temp), r.runtime);
    const saved = task({ id: "t1" });
    view.rerender(
      <TooltipProvider>
        <TaskDetailPanel
          task={saved}
          buckets={[APP]}
          inbox={INBOX}
          canEdit
          onRequestCapture={() => {}}
          onSelectTask={() => {}}
          api={api(saved)}
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
    const a = api(parent, {
      tasks: [parent, one, two],
      subtasksByParent: new Map([["p", [one, two]]]),
      dropTask,
    } as unknown as Partial<TasksModuleApi>);
    return { a, dropTask };
  };
  const moveUp = (title: string) =>
    fireEvent.keyDown(screen.getByRole("button", { name: `Open subtask: ${title}` }), {
      key: "ArrowUp",
      altKey: true,
      shiftKey: true,
    });

  it("⌥⇧↑ moves a subtask up among its siblings, with the drop's Undo label", () => {
    const { a, dropTask } = withSubtasks();
    renderPanel(parent, a);
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

  it("read-only, the keys move nothing", () => {
    const { a, dropTask } = withSubtasks();
    renderPanel(parent, a, null, false);
    moveUp("Second step");
    expect(dropTask).not.toHaveBeenCalled();
  });
});
