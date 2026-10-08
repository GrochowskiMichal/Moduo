// tasks-v2 Q1-2 — a button inside a draggable row keeps its Space/Enter. dnd-kit's
// keyboard sensor only refuses a keydown whose target isn't the row once the row
// is registered as the drag ACTIVATOR; without it, Space on the queue toggle
// lifted the whole row and swallowed the button.

import { DndContext, type DraggableSyntheticListeners } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { type DragActivatorRef, DraggableTask, SortableTask, useTaskDndSensors } from "./task-dnd";

beforeAll(() => {
  // jsdom has no layout; dnd-kit scrolls the lifted row into view.
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(async () => {
  // A lifted row's keyboard sensor listens on the document (attached a tick
  // after the lift) — drop it with Escape so it can't eat the next test's keys.
  await new Promise((resolve) => setTimeout(resolve, 0));
  fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
  cleanup();
});

function Row({
  dragListeners,
  dragActivatorRef,
  onToggle,
}: {
  dragListeners: DraggableSyntheticListeners;
  dragActivatorRef?: DragActivatorRef;
  onToggle: () => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: mirrors TaskRow's role="row" root.
    <div ref={dragActivatorRef} role="row" tabIndex={-1} data-testid="row" {...dragListeners}>
      <button type="button" onClick={onToggle}>
        Add to queue
      </button>
    </div>
  );
}

function Harness({ onDragStart, children }: { onDragStart: () => void; children: ReactNode }) {
  const sensors = useTaskDndSensors();
  return (
    <DndContext sensors={sensors} onDragStart={onDragStart}>
      <SortableContext items={["a"]}>{children}</SortableContext>
    </DndContext>
  );
}

const SPACE = { key: " ", code: "Space" };
const ENTER = { key: "Enter", code: "Enter" };

describe.each([
  ["SortableTask (Queue)", "sortable"],
  ["DraggableTask (List)", "draggable"],
] as const)("%s", (_name, kind) => {
  function renderRow(opts: { withActivator: boolean }) {
    const onDragStart = rs.fn();
    const onToggle = rs.fn();
    const row = (slot: {
      dragListeners: DraggableSyntheticListeners;
      dragActivatorRef: DragActivatorRef;
    }) => (
      <Row
        dragListeners={slot.dragListeners}
        dragActivatorRef={opts.withActivator ? slot.dragActivatorRef : undefined}
        onToggle={onToggle}
      />
    );
    render(
      <Harness onDragStart={onDragStart}>
        {kind === "sortable" ? (
          <SortableTask id="a" from="queue" render={row} />
        ) : (
          <DraggableTask id="a" from="list" render={row} />
        )}
      </Harness>,
    );
    return { onDragStart, onToggle, button: screen.getByRole("button", { name: "Add to queue" }) };
  }

  it("activator is the row only: Space/Enter on a focused child button don't start a drag", async () => {
    const { onDragStart, button } = renderRow({ withActivator: true });
    button.focus();
    // `true` = nobody called preventDefault, so the browser still activates the button.
    expect(fireEvent.keyDown(button, SPACE)).toBe(true);
    expect(fireEvent.keyDown(button, ENTER)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("still lifts from the row itself", async () => {
    const { onDragStart } = renderRow({ withActivator: true });
    fireEvent.keyDown(screen.getByTestId("row"), SPACE);
    await waitFor(() => expect(onDragStart).toHaveBeenCalledOnce());
  });

  it("without the activator ref, Space on the button starts a drag (the bug)", async () => {
    const { onDragStart, button } = renderRow({ withActivator: false });
    button.focus();
    expect(fireEvent.keyDown(button, SPACE)).toBe(false);
    await waitFor(() => expect(onDragStart).toHaveBeenCalledOnce());
  });
});
