// TV-TL2 — the right panel's No date view: Enter/Space on a task open it and
// never lift it (the drop onto the canvas is the pointer's: a keyboard lift
// could never land), and someone who can't edit gets no drag at all.

import { DndContext } from "@dnd-kit/core";
import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { makeTask } from "../helpers";
import type { Bucket, Task } from "../model";
import { useTaskDndSensors } from "./dnd/task-dnd";
import { TimelineNoDatePanel } from "./timeline-no-date-panel";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
  cleanup();
});

const project: Bucket = {
  id: "p1",
  workspaceId: "w1",
  ownerId: "u1",
  name: "Rebrand",
  isSystem: false,
  group: null,
  position: "a",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};

function task(id: string, title: string): Task {
  return { ...makeTask({ workspaceId: "w1", bucketId: "p1", title, position: id }), id };
}

function Harness({ onDragStart, children }: { onDragStart: () => void; children: ReactNode }) {
  const sensors = useTaskDndSensors();
  return (
    <DndContext sensors={sensors} onDragStart={onDragStart}>
      {children}
    </DndContext>
  );
}

function renderPanel(canEdit = true) {
  const onDragStart = rs.fn();
  const onOpen = rs.fn();
  render(
    <Harness onDragStart={onDragStart}>
      <TimelineNoDatePanel
        tasks={[task("t1", "Press kit"), task("t2", "Brief")]}
        projects={[project]}
        inboxId={null}
        canEdit={canEdit}
        selectedTaskId={null}
        onOpen={onOpen}
      />
    </Harness>,
  );
  return { onDragStart, onOpen };
}

describe("TimelineNoDatePanel", () => {
  it("lists the tasks by project, and says how to place one", () => {
    renderPanel();
    expect(screen.getByText("Rebrand")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Press kit" })).toBeTruthy();
    expect(screen.getByText("Drag a task onto a day.")).toBeTruthy();
  });

  it("Enter and Space on a task never lift it: the button keeps them (it opens the task)", async () => {
    const { onDragStart, onOpen } = renderPanel();
    const button = screen.getByRole("button", { name: "Press kit" });
    button.focus();
    // `true` = nobody called preventDefault, so the browser still clicks the button.
    expect(fireEvent.keyDown(button, { key: "Enter", code: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(button, { key: " ", code: "Space" })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onDragStart).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith("t1");
  });

  it("someone who can't edit gets no drag and no hint", () => {
    renderPanel(false);
    expect(screen.queryByText("Drag a task onto a day.")).toBeNull();
    expect(screen.getByRole("button", { name: "Press kit" }).className).not.toContain(
      "cursor-grab",
    );
  });

  it("filters by title", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Search the tasks with no date"), {
      target: { value: "brief" },
    });
    expect(screen.queryByRole("button", { name: "Press kit" })).toBeNull();
    expect(screen.getByRole("button", { name: "Brief" })).toBeTruthy();
  });

  it("says so when everything has a date", () => {
    cleanup();
    render(
      <Harness onDragStart={() => {}}>
        <TimelineNoDatePanel
          tasks={[]}
          projects={[project]}
          inboxId={null}
          canEdit
          selectedTaskId={null}
          onOpen={() => {}}
        />
      </Harness>,
    );
    expect(screen.getByText("Everything here has a date")).toBeTruthy();
  });
});
