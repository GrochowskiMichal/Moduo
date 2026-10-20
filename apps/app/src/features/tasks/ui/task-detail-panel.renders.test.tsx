// A4b: the detail panel reads the Tasks context through the narrow hooks, so
// an edit to another task redraws none of it. Before, it took the whole api,
// a new object on every store change, and every section redrew each time.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

/** Renders of the parts that show people: the properties and the header's Focus toggle. */
const peopleReads = rs.hoisted(() => ({ count: 0 }));

rs.mock("../assignees", () => ({
  useAssignees: () => {
    peopleReads.count += 1;
    return { assignees: [], currentUserId: "u1", byId: () => null };
  },
  previewAssign: async () => null,
  initialsOf: (name: string) => name.slice(0, 2).toUpperCase(),
}));

rs.mock("../../spine/hooks/use-comment-people", () => ({
  useCommentPeople: () => ({
    currentUserId: "u1",
    mentionable: [],
    names: [],
    nameOf: () => null,
    personOf: () => null,
  }),
}));

import { Profiler } from "react";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { makeTask } from "../helpers";
import type { Bucket, Task } from "../model";
import { useTaskById, useTaskCommands } from "../tasks-context";
import { renderWithTasks } from "../testing/render-with-tasks";
import { TaskDetailPanel } from "./task-detail-panel";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

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

function task(id: string, title: string): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "b-app", title, position: id }),
    id,
    creatorId: "u1",
    assigneeId: "u1",
    updatedAt: "2026-10-06T10:00:00Z",
  };
}

/**
 * The panel as a host shows it: the open task read by id, the panel's commits
 * counted (any render anywhere inside it), and another task's title read
 * outside it (to see that the change landed).
 */
async function openPanel() {
  const seen = {
    commits: 0,
    otherTitle: "",
    commands: null as ReturnType<typeof useTaskCommands> | null,
  };
  function Host() {
    const open = useTaskById("t1");
    return (
      <Profiler
        id="panel"
        onRender={() => {
          seen.commits += 1;
        }}
      >
        <TaskDetailPanel task={open} onRequestCapture={() => {}} onSelectTask={() => {}} />
      </Profiler>
    );
  }
  function Elsewhere() {
    seen.otherTitle = useTaskById("t2")?.title ?? "";
    seen.commands = useTaskCommands();
    return null;
  }
  const updateTask = rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => ({
    ...(taskId === "t1" ? task("t1", "Open task") : task("t2", "Another task")),
    ...patch,
    updatedAt: "2026-10-20T10:00:00Z",
  }));
  const view = await renderWithTasks(
    <TooltipProvider>
      <Host />
      <Elsewhere />
    </TooltipProvider>,
    {
      seed: { buckets: [INBOX, APP], tasks: [task("t1", "Open task"), task("t2", "Another task")] },
      workspaceId: "w",
      runtime: { tasks: { updateTask } },
    },
  );
  return { ...view, seen, updateTask };
}

const titleField = () => screen.getByRole("textbox", { name: "Task title" }) as HTMLTextAreaElement;

describe("the detail panel redraws only for what it shows (A4b)", () => {
  it("after editing its title, a teammate's change to another task redraws none of it", async () => {
    const { store, seen, updateTask } = await openPanel();
    // Its own field: the panel redraws with the saved title.
    const before = seen.commits;
    fireEvent.change(titleField(), { target: { value: "Renamed here" } });
    fireEvent.blur(titleField());
    await waitFor(() =>
      expect(updateTask).toHaveBeenCalledWith({
        workspaceId: "w",
        taskId: "t1",
        patch: { title: "Renamed here" },
      }),
    );
    await act(async () => {});
    expect(seen.commits).toBeGreaterThan(before);
    expect(titleField().value).toBe("Renamed here");

    // Another task changes (Realtime brings a teammate's edit): nothing in the panel renders.
    seen.commits = 0;
    peopleReads.count = 0;
    act(() =>
      store.answer({
        tasks: [{ ...task("t2", "Renamed by Mike"), updatedAt: "2026-10-20T11:00:00Z" }],
      }),
    );
    await act(async () => {});
    expect(seen.otherTitle).toBe("Renamed by Mike");
    expect(seen.commits).toBe(0);
    expect(peopleReads.count).toBe(0);
    expect(titleField().value).toBe("Renamed here");
  });

  it("an edit to another task from this page re-reads only the trail, not the properties or header", async () => {
    const { seen, updateTask } = await openPanel();
    peopleReads.count = 0;
    act(() => {
      seen.commands?.patchTask("t2", { title: "Renamed here too" });
    });
    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(seen.otherTitle).toBe("Renamed here too");
    // The trail's cue moved (the op saved), so the feed may redraw; the
    // properties and the header's Focus toggle (who reads people) don't.
    expect(peopleReads.count).toBe(0);
  });
});
