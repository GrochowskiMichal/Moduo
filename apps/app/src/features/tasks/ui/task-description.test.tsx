// The description's fold (call 56) with the soft surface (MOD-115): only text
// that really runs past the fold offers "Show more". An empty or short
// description never does, so nothing inside the measured box may reach past
// it (a negative margin on the editor did, and every description folded).

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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

function renderDescription(description: string, foldable = true) {
  const api = { patchTask: rs.fn() } as unknown as TasksModuleApi;
  return render(
    <TaskDescription
      task={task(description)}
      api={api}
      canEdit
      runtime={null}
      workspaceId={null}
      foldable={foldable}
    />,
  );
}

/** The box the fold measures: the editor's parent. */
const foldBox = () =>
  screen.getByRole("textbox", { name: "Description" }).closest(".w-full") as HTMLElement;

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

describe("a long description in the panel and on the full page (MOD-36)", () => {
  it("folds at about eight of its own lines, counted in lines, not pixels", () => {
    renderDescription("A long description.");
    const box = foldBox();
    expect(box.className).toContain("max-h-[8.5lh]");
    // `lh` is the description's line: the box carries the text's size.
    expect(box.className).toContain("text-base");
  });

  it("Show more opens the whole text, and Show less folds it again", () => {
    heights(300, 192);
    renderDescription("A long description.");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    const less = screen.getByRole("button", { name: "Show less" });
    expect(less.getAttribute("aria-expanded")).toBe("true");
    expect(foldBox().className).not.toContain("max-h-");
    fireEvent.click(less);
    expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
    expect(foldBox().className).toContain("max-h-[8.5lh]");
  });

  it("the full page always shows everything, with no Show more", () => {
    heights(300, 192);
    renderDescription("A long description.", false);
    expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull();
    expect(foldBox().className).not.toContain("max-h-");
  });
});
