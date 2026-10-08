// The shared comment pieces (tasks-v2 decision 12): a thread reads and writes
// comments on any entity (a task here), and the composer's @ picker offers
// people, never entities, by keyboard as well as by pointer.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";

import type { ModuoRuntime, SpineComment } from "@/lib/runtime.types";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { useCommentThread } from "../hooks/use-comment-thread";
import { CommentComposer } from "./comments-panel";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(cleanup);

const PEOPLE = [
  { id: "u2", name: "Mike", avatarUrl: null },
  { id: "u3", name: "Ola", avatarUrl: null },
];

function renderComposer(onSubmit = rs.fn(async () => {})) {
  render(
    <TooltipProvider>
      <CommentComposer people={PEOPLE} onSubmit={onSubmit} />
    </TooltipProvider>,
  );
  return { box: screen.getByRole("textbox", { name: "Comment" }) as HTMLTextAreaElement, onSubmit };
}

describe("the composer's @ picker", () => {
  it("lists people only, and arrows + Enter pick one", async () => {
    const { box } = renderComposer();
    fireEvent.change(box, { target: { value: "hi @", selectionStart: 4 } });
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    expect(screen.getByRole("option", { name: "Mike" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Ola" })).toBeTruthy();
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Ola" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe("hi @Ola ");
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("closes on Esc and stays closed for that @", async () => {
    const { box } = renderComposer();
    fireEvent.change(box, { target: { value: "@m", selectionStart: 2 } });
    await screen.findByRole("option", { name: "Mike" });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("option")).toBeNull();
    fireEvent.change(box, { target: { value: "@mi", selectionStart: 3 } });
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("the @ button starts a mention at the caret", async () => {
    const { box } = renderComposer();
    fireEvent.change(box, { target: { value: "ping", selectionStart: 4 } });
    fireEvent.click(screen.getByRole("button", { name: "Mention someone" }));
    expect(box.value).toBe("ping @");
    expect(await screen.findByRole("option", { name: "Mike" })).toBeTruthy();
  });

  it("posts with ⌘Enter only, and keeps the text when posting fails", async () => {
    const onSubmit = rs.fn(async () => {
      throw new Error("offline");
    });
    const { box } = renderComposer(onSubmit);
    fireEvent.change(box, { target: { value: "first line", selectionStart: 10 } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    });
    expect(onSubmit).toHaveBeenCalledWith("first line", []);
    expect(box.value).toBe("first line");
  });
});

describe("a comment thread on a task", () => {
  it("reads the task's comments and posts to the same task, then re-reads", async () => {
    const stored: SpineComment[] = [];
    const listComments = rs.fn(async () => [...stored]);
    const addComment = rs.fn(async (input: { body: string }) => {
      const row = {
        id: "c1",
        workspaceId: "w",
        entityType: "task",
        entityId: "t1",
        body: input.body,
        createdBy: "u1",
        authorKind: "user",
        authorLabel: null,
        createdAt: "2026-10-09T10:00:00Z",
        updatedAt: "2026-10-09T10:00:00Z",
        deletedAt: null,
      } as SpineComment;
      stored.push(row);
      return row;
    });
    const runtime = { spine: { listComments, addComment } } as unknown as ModuoRuntime;
    const { result } = renderHook(() =>
      useCommentThread({
        runtime,
        workspaceId: "w",
        entityType: "task",
        entityId: "t1",
        entityLabel: "  ",
        entityIcon: "task",
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listComments).toHaveBeenCalledWith({
      workspaceId: "w",
      entityType: "task",
      entityId: "t1",
    });
    await act(async () => {
      await result.current.post({ body: "On it @Mike", mentionedUserIds: ["u2"] });
    });
    expect(addComment).toHaveBeenCalledWith({
      workspaceId: "w",
      entityType: "task",
      entityId: "t1",
      body: "On it @Mike",
      mentionedUserIds: ["u2"],
      entityLabel: "Untitled",
      entityIcon: "task",
    });
    expect(result.current.comments.map((c) => c.body)).toEqual(["On it @Mike"]);
  });
});
