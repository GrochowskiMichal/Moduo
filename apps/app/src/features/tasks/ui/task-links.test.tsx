// "Copy link" for a task (MOD-28), in its right-click menu and in the
// details' ⋯: the link names the task by its handle (`/tasks?id=MOD-142`)
// when it has one, else by its id.

import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

rs.mock("../assignees", () => ({
  useAssignees: () => ({ assignees: [], currentUserId: "u1", byId: () => null }),
  previewAssign: async () => null,
  initialsOf: () => "?",
}));

import { TooltipProvider } from "../../../components/ui/tooltip";
import { WorkspaceContext } from "../../workspaces/workspace-context";
import { makeTask } from "../helpers";
import type { Task } from "../model";
import { renderWithTasks } from "../testing/render-with-tasks";
import { TaskContextMenu } from "./task-context-menu";
import { TaskDetailHeader } from "./task-detail-header";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});

const writeText = rs.fn(async (_text: string) => {});
beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(cleanup);

const task = (over: Partial<Task> = {}): Task => ({
  ...makeTask({ workspaceId: "w", bucketId: "inbox", title: "Verify the links", position: "a" }),
  id: "f2968388-7a0f-4cd7-9d01-7b9242ebc1ce",
  ...over,
});

const noop = () => {};
const actions = {
  toggleDone: rs.fn(),
  setTaskStatus: rs.fn(),
  patchTask: rs.fn(),
  deleteTask: rs.fn(),
} as never;

async function copyLinkOf(t: Task, opts: { canEdit: boolean; taskKey: string | null }) {
  render(
    <TaskContextMenu
      task={t}
      facts={{ queued: false }}
      canEdit={opts.canEdit}
      taskKey={opts.taskKey}
      actions={actions}
      onOpen={noop}
      onRename={noop}
      onRequestCommand={noop}
    >
      <div>row</div>
    </TaskContextMenu>,
  );
  fireEvent.contextMenu(screen.getByText("row"));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Copy link" }));
  await act(async () => {});
  expect(writeText).toHaveBeenCalledOnce();
  return writeText.mock.calls[0][0];
}

describe("Copy link (MOD-28)", () => {
  it("names the task by its handle", async () => {
    const url = await copyLinkOf(task({ number: 142 }), { canEdit: true, taskKey: "MOD" });
    expect(url).toBe(`${window.location.origin}/tasks?id=MOD-142`);
  });

  it("does the same in the read-only menu", async () => {
    const url = await copyLinkOf(task({ number: 7 }), { canEdit: false, taskKey: "MOD" });
    expect(url).toBe(`${window.location.origin}/tasks?id=MOD-7`);
  });

  it("uses the id while the task has no number (or the workspace no key)", async () => {
    const url = await copyLinkOf(task({ number: null }), { canEdit: true, taskKey: "MOD" });
    expect(url).toBe(`${window.location.origin}/tasks?id=f2968388-7a0f-4cd7-9d01-7b9242ebc1ce`);
  });
});

describe("the details' ⋯ → Copy link (MOD-28)", () => {
  async function copyFromHeader(t: Task, taskKey: string | null) {
    await renderWithTasks(
      <WorkspaceContext.Provider value={{ selectedWorkspace: { taskKey } } as never}>
        <TooltipProvider>
          <TaskDetailHeader
            task={t}
            parent={null}
            buckets={[]}
            canEdit={false}
            onOpenTask={noop}
            onSelectTask={noop}
            claimSlot={<span />}
          />
        </TooltipProvider>
      </WorkspaceContext.Provider>,
      { seed: { tasks: [t] } },
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), {
      button: 0,
      pointerType: "mouse",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Copy link/ }));
    await act(async () => {});
    expect(writeText).toHaveBeenCalledOnce();
    return writeText.mock.calls[0][0];
  }

  it("names the task by its handle", async () => {
    const done = task({ number: 142, status: "done" });
    expect(await copyFromHeader(done, "MOD")).toBe(`${window.location.origin}/tasks?id=MOD-142`);
  });

  it("uses the id when the workspace has no key yet", async () => {
    const done = task({ number: 142, status: "done" });
    expect(await copyFromHeader(done, null)).toBe(
      `${window.location.origin}/tasks?id=f2968388-7a0f-4cd7-9d01-7b9242ebc1ce`,
    );
  });
});
