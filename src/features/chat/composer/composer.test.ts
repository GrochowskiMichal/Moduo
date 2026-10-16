// CV-7b · the composer: its grammar, its keys and IME (AC4.3, AC4.7, AC9.7).
// The typed handle chip (`MOD-142`, CH66) is CV-10's: its block is at the end
// (and live in tests/chat-capture.spec.ts).

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";

import { handleFinishedAt } from "@/features/spine/references/handle-autolink-plugin";
import { CAPTURE_OPEN_EVENT } from "@/lib/capture-open";
import type { CaptureRequest } from "@/lib/capture-registry";
import { parseStored } from "../markup-v2/parse";
import { openCreateCapture } from "./capture";
import { ChatComposer, type ChatComposerProps } from "./chat-composer";
import {
  appLinkRef,
  composerKeyAction,
  createCommandsFor,
  limitCopy,
  linkAppRefs,
  MESSAGE_LIMIT,
  offersChannel,
  overLimit,
  peopleFor,
} from "./grammar";
import { escapeUndoesChip } from "./handle-chip";

afterEach(cleanup);

const ORIGIN = "https://app.moduo.test";
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("grammar, handle chip, IME: the grammar", () => {
  it("`/` offers the create commands by prefix, and the words after one are its title", () => {
    expect(createCommandsFor("").map((c) => c.id)).toEqual(["task", "note", "event"]);
    expect(createCommandsFor("ta")).toEqual([{ id: "task", title: "" }]);
    expect(createCommandsFor("task Order frames")).toEqual([{ id: "task", title: "Order frames" }]);
    expect(createCommandsFor("event  Review at 3pm ")).toEqual([
      { id: "event", title: "Review at 3pm" },
    ]);
    expect(createCommandsFor("tasks")).toEqual([]);
    expect(createCommandsFor("takeaway lunch")).toEqual([]);
    expect(createCommandsFor("today")).toEqual([]);
  });

  it("`@` offers people first (name start, then a word, then anywhere), never you", () => {
    const people = [
      { id: "1", name: "Anna Lis" },
      { id: "2", name: "Mike Chen" },
      { id: "3", name: "Joanna Mika" },
      { id: "me", name: "Maciej" },
    ];
    expect(peopleFor(people, "mi", "me").map((p) => p.name)).toEqual(["Mike Chen", "Joanna Mika"]);
    expect(peopleFor(people, "an", "me").map((p) => p.name)).toEqual(["Anna Lis", "Joanna Mika"]);
    expect(peopleFor(people, "", "me").map((p) => p.id)).not.toContain("me");
    expect(offersChannel("ch")).toBe(true);
    expect(offersChannel("ev")).toBe(true);
    expect(offersChannel("")).toBe(false);
    expect(offersChannel("mike")).toBe(false);
  });

  it("a pasted Moduo link becomes the reference a pick makes; others stay links", () => {
    expect(appLinkRef(`${ORIGIN}/tasks?id=${ID}`, [ORIGIN])).toEqual({ type: "task", id: ID });
    expect(appLinkRef(`${ORIGIN}/notes?id=${ID}`, [ORIGIN])).toEqual({ type: "note", id: ID });
    expect(appLinkRef(`${ORIGIN}/calendar?event=${ID}`, [ORIGIN])).toEqual({
      type: "event",
      id: ID,
    });
    expect(appLinkRef(`${ORIGIN}/contacts?type=company&id=${ID}`, [ORIGIN])).toEqual({
      type: "company",
      id: ID,
    });
    expect(appLinkRef(`${ORIGIN}/chat?c=${ID}&m=${ID}`, [ORIGIN])).toEqual({
      type: "chat_channel",
      id: ID,
    });
    // A handle link is CV-10's; another site's link is a link.
    expect(appLinkRef(`${ORIGIN}/tasks?id=MOD-142`, [ORIGIN])).toBeNull();
    expect(appLinkRef(`https://elsewhere.test/tasks?id=${ID}`, [ORIGIN])).toBeNull();
    const blocks = linkAppRefs(parseStored(`see ${ORIGIN}/tasks?id=${ID} and https://x.test`), [
      ORIGIN,
    ]);
    expect(blocks).toEqual([
      {
        t: "p",
        c: [
          { t: "text", v: "see ", m: 0 },
          { t: "ref", type: "task", id: ID },
          { t: "text", v: " and ", m: 0 },
          { t: "url", v: "https://x.test", m: 0 },
        ],
      },
    ]);
  });

  it("8,000 stored characters at most, refused with the count", () => {
    expect(overLimit("x".repeat(MESSAGE_LIMIT))).toBeNull();
    expect(overLimit("x".repeat(MESSAGE_LIMIT + 1))).toBe(8001);
    // References count as stored characters.
    const ref = `moduo://task/${ID}`;
    expect(overLimit(`${"x".repeat(MESSAGE_LIMIT - ref.length + 1)}${ref}`)).toBe(8001);
    expect(limitCopy(8001)).toContain("8,001 characters");
  });

  it("↑ and Esc act only in an empty composer with no menu open", () => {
    const base = { empty: true, menuOpen: false, modifiers: false };
    expect(composerKeyAction({ ...base, key: "ArrowUp" })).toBe("edit-last");
    expect(composerKeyAction({ ...base, key: "Escape" })).toBe("to-stream");
    expect(composerKeyAction({ ...base, key: "ArrowUp", empty: false })).toBeNull();
    expect(composerKeyAction({ ...base, key: "Escape", menuOpen: true })).toBeNull();
    expect(composerKeyAction({ ...base, key: "ArrowUp", modifiers: true })).toBeNull();
  });

  it("`/task` opens the capture as Task with the words after it", () => {
    const seen: CaptureRequest[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent<CaptureRequest>).detail);
    window.addEventListener(CAPTURE_OPEN_EVENT, on);
    const [cmd] = createCommandsFor("task Order frames");
    const made = rs.fn();
    if (cmd) openCreateCapture(cmd.id, cmd.title, made);
    window.removeEventListener(CAPTURE_OPEN_EVENT, on);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.type).toBe("task");
    expect(seen[0]?.draft).toBe("Order frames");
    seen[0]?.onCreated?.({ type: "task", id: ID }, "Order frames");
    expect(made).toHaveBeenCalledWith({ type: "task", id: ID }, "Order frames");
  });
});

function mount(props: Partial<ChatComposerProps> = {}) {
  const onSend = rs.fn();
  const onEditLast = rs.fn();
  const onEscapeEmpty = rs.fn();
  render(
    createElement(ChatComposer, {
      runtime: null,
      workspaceId: null,
      selfId: "me",
      people: [],
      placeholder: "Message #general",
      onSend,
      onEditLast,
      onEscapeEmpty,
      ...props,
    }),
  );
  return {
    box: screen.getByRole("textbox", { name: "Message #general" }),
    onSend,
    onEditLast,
    onEscapeEmpty,
  };
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("grammar, handle chip, IME: the keys", () => {
  it("⏎ during IME composition doesn't send; ⏎ after it does", async () => {
    const { box, onSend } = mount({ initial: "こんにちは" });
    await settle();
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    // WebKit's commit Enter after compositionend.
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("こんにちは");
  });

  it("⇧⏎ doesn't send; ⌘⏎ does", async () => {
    const { box, onSend } = mount({ initial: "hello" });
    await settle();
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("↑ in an empty composer edits the last message; Esc moves to the stream", async () => {
    const { box, onEditLast, onEscapeEmpty } = mount();
    await settle();
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(onEditLast).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(onEscapeEmpty).toHaveBeenCalledTimes(1);
  });

  it("↑ with text in it is the caret's, not an edit", async () => {
    const { box, onEditLast } = mount({ initial: "draft" });
    await settle();
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(onEditLast).not.toHaveBeenCalled();
  });

  it("a code block and inline code keep their backticks into an edit and back (AC4.7)", async () => {
    const body = "run `bun test` first\n\n```ts\nconst a = 1;\n```";
    const onSend = rs.fn();
    const onCancel = rs.fn();
    render(
      createElement(ChatComposer, {
        mode: "edit",
        runtime: null,
        workspaceId: null,
        selfId: "me",
        people: [],
        placeholder: "Edit message",
        initial: body,
        onSend,
        onCancel,
      }),
    );
    await settle();
    const box = screen.getByRole("textbox", { name: "Edit message" });
    expect(box.querySelector("code")?.textContent).toBe("bun test");
    // Unchanged: ⏎ is a cancel, nothing is saved.
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("grammar, handle chip, IME: the handle chip (CV-10, AC4.1)", () => {
  it("`MOD-142` counts once it's finished, and only with the workspace's key", () => {
    expect(handleFinishedAt("see MOD-142 ", 12, ["MOD"])).toEqual({
      handle: "MOD-142",
      start: 4,
      end: 11,
    });
    expect(handleFinishedAt("see MOD-142", 11, ["MOD"])).toBeNull();
    expect(handleFinishedAt("UTF-8 ", 6, ["MOD"])).toBeNull();
  });

  it("Esc right after the chip went in takes it back; after more typing it doesn't", () => {
    expect(escapeUndoesChip("see MOD-142 ", "see MOD-142 ")).toBe(true);
    expect(escapeUndoesChip("see MOD-142 ", "see MOD-142 and")).toBe(false);
    expect(escapeUndoesChip(null, "anything")).toBe(false);
  });
});
