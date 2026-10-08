// Claims (TV-D4 + TV-F2): others' queue rows put a claim mark on a task
// ("In Mike's queue"); a teammate's running run on it says "Mike is on this"
// with a live dot. Nothing else about anyone's run shows (F2-6).

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, render, screen } from "@testing-library/react";

const PEOPLE = {
  u1: { userId: "u1", name: "Me", avatarUrl: null, isMe: true, canTakeTasks: true },
  u2: { userId: "u2", name: "Mike", avatarUrl: null, isMe: false, canTakeTasks: true },
  u3: { userId: "u3", name: "Ola", avatarUrl: null, isMe: false, canTakeTasks: true },
} as const;

rs.mock("./assignees", () => ({
  useAssignees: () => ({
    assignees: Object.values(PEOPLE),
    currentUserId: "u1",
    byId: (id: string | null) => (id ? (PEOPLE[id as keyof typeof PEOPLE] ?? null) : null),
  }),
  previewAssign: async () => null,
  initialsOf: (name: string) => name.slice(0, 2).toUpperCase(),
}));

import { TooltipProvider } from "../../components/ui/tooltip";
import { onThisLabel, runClaimsByTask, setRunClaims } from "./claims";
import { makeTask } from "./helpers";
import type { Task, TaskQueueEntry } from "./model";
import { claimsByTask } from "./queue";
import { QueueToggle } from "./ui/queue-toggle";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(() => {
  cleanup();
  act(() => setRunClaims("w", new Map()));
});

function task(id: string): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "b1", title: `Task ${id}`, position: id }),
    id,
  };
}

describe("claim markers from queues and runs", () => {
  it("others' queue rows become claims; mine don't", () => {
    const row = (id: string, userId: string, taskId: string): TaskQueueEntry => ({
      id,
      workspaceId: "w",
      userId,
      taskId,
      position: "0000000001",
      queuedAt: `2026-10-09T10:00:0${id}.000Z`,
      updatedAt: "2026-10-09T10:00:00.000Z",
    });
    const map = claimsByTask(
      [row("1", "u2", "t1"), row("2", "u1", "t1"), row("3", "u3", "t1")],
      "u1",
    );
    expect(map.get("t1")).toEqual(["u2", "u3"]);
  });

  it("a teammate's run puts them on its Now task; never me", () => {
    const map = runClaimsByTask(
      [
        { userId: "u2", taskId: "t1" },
        { userId: "u1", taskId: "t2" },
        { userId: "u3", taskId: "t1" },
        { userId: "u2", taskId: "t1" },
      ],
      "u1",
    );
    expect(map.get("t1")).toEqual(["u2", "u3"]);
    expect(map.has("t2")).toBe(false);
  });

  it("says who is on it", () => {
    expect(onThisLabel(["Mike"])).toBe("Mike is on this");
    expect(onThisLabel(["Mike", "Ola"])).toBe("Mike and Ola are on this");
    expect(onThisLabel([])).toBe("");
  });
});

describe("“Mike is on this” on a row (F2-6)", () => {
  const api = (claims: Record<string, string[]>, queued: string[] = []) => ({
    queuedTaskIds: new Set(queued),
    queueClaims: new Map(Object.entries(claims)),
    toggleQueue: rs.fn(),
  });

  it("shows Mike on the task his run is on, ahead of his queue claim", () => {
    act(() => setRunClaims("w", new Map([["t1", ["u2"]]])));
    render(
      <TooltipProvider>
        <QueueToggle task={task("t1")} api={api({ t1: ["u2"] })} canEdit />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "Add to queue. Mike is on this" })).not.toBeNull();
  });

  it("shows it to a view-only member too, without the action", () => {
    act(() => setRunClaims("w", new Map([["t1", ["u2"]]])));
    render(
      <TooltipProvider>
        <QueueToggle task={task("t1")} api={api({})} canEdit={false} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("img", { name: "Mike is on this" })).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("claims of another workspace don't show here", () => {
    act(() => setRunClaims("other", new Map([["t1", ["u2"]]])));
    render(
      <TooltipProvider>
        <QueueToggle task={task("t1")} api={api({})} canEdit />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "Add to queue" })).not.toBeNull();
  });

  it("with only a queue claim it still reads “In Mike's queue”", () => {
    render(
      <TooltipProvider>
        <QueueToggle task={task("t1")} api={api({ t1: ["u2"] })} canEdit />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "Add to queue. In Mike’s queue" })).not.toBeNull();
  });
});
