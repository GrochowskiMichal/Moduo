// The description's fold (call 56) with the soft surface (MOD-115): only text
// that really runs past the fold offers "Show more". An empty or short
// description never does, so nothing inside the measured box may reach past
// it (a negative margin on the editor did, and every description folded).

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import { makeTask } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Task } from "../model";
import { TaskDescription } from "./task-description";

const restores: Array<() => void> = [];
/** jsdom lays nothing out: give every element these heights for one test. */
function heights(scroll: number, client: number) {
  for (const [key, value] of [
    ["scrollHeight", scroll],
    ["clientHeight", client],
  ] as const) {
    const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value });
    restores.push(() => {
      if (before) Object.defineProperty(HTMLElement.prototype, key, before);
    });
  }
}

afterEach(() => {
  cleanup();
  for (const restore of restores.splice(0)) restore();
});

function task(description: string): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "b", title: "T", position: "a" }),
    id: "t1",
    creatorId: "u1",
    description,
  };
}

function renderDescription(description: string) {
  const api = { patchTask: rs.fn() } as unknown as TasksModuleApi;
  return render(
    <TaskDescription
      task={task(description)}
      api={api}
      canEdit
      runtime={null}
      workspaceId={null}
      foldable
    />,
  );
}

describe("the description's fold (MOD-115 regression)", () => {
  it("an empty description offers no Show more", () => {
    heights(30, 30);
    renderDescription("");
    expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull();
  });

  it("a short description offers no Show more", () => {
    heights(30, 30);
    renderDescription("Repro steps in the thread.");
    expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull();
  });

  it("nothing in the measured box reaches past it: the editor has no negative margin", () => {
    renderDescription("");
    const editor = screen.getByRole("textbox", { name: "Description" });
    expect(editor.className).not.toMatch(/(^|\s)-m[ytb]?-/);
  });

  it("text that runs past the fold still offers Show more", () => {
    heights(300, 192);
    renderDescription("A long description.");
    expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
  });
});
