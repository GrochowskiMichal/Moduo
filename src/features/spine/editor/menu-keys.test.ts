import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHeadlessEditor } from "@lexical/headless";
import { describe, expect, it } from "@rstest/core";
import {
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
} from "lexical";
import { registerMenuKeys, stepMenuIndex } from "./menu-keys";

const key = () => new KeyboardEvent("keydown");

function harness(rows: number, open = true) {
  const editor = createHeadlessEditor({
    namespace: "menu-keys",
    onError: (e) => {
      throw e;
    },
  });
  const state = { open, index: 0, picked: [] as number[], closed: 0 };
  registerMenuKeys(editor, {
    isOpen: () => state.open,
    count: () => rows,
    index: () => state.index,
    setIndex: (i) => {
      state.index = i;
    },
    pick: (i) => state.picked.push(i),
    close: () => {
      state.closed += 1;
      state.open = false;
    },
  });
  return { editor, state };
}

describe("one caret-menu keyboard regime", () => {
  it("↑↓ wrap, ↵ and Tab pick the highlighted row, Esc closes", () => {
    const { editor, state } = harness(3);
    expect(editor.dispatchCommand(KEY_ARROW_UP_COMMAND, key())).toBe(true);
    expect(state.index).toBe(2);
    editor.dispatchCommand(KEY_ARROW_DOWN_COMMAND, key());
    expect(state.index).toBe(0);
    editor.dispatchCommand(KEY_ARROW_DOWN_COMMAND, key());
    expect(editor.dispatchCommand(KEY_ENTER_COMMAND, key())).toBe(true);
    expect(editor.dispatchCommand(KEY_TAB_COMMAND, key())).toBe(true);
    expect(state.picked).toEqual([1, 1]);
    expect(editor.dispatchCommand(KEY_ESCAPE_COMMAND, key())).toBe(true);
    expect(state.closed).toBe(1);
  });

  it("a closed or empty menu takes no key from the editor", () => {
    const closed = harness(3, false);
    for (const command of [
      KEY_ARROW_DOWN_COMMAND,
      KEY_ENTER_COMMAND,
      KEY_TAB_COMMAND,
      KEY_ESCAPE_COMMAND,
    ]) {
      expect(closed.editor.dispatchCommand(command, key())).toBe(false);
    }
    const empty = harness(0);
    expect(empty.editor.dispatchCommand(KEY_ENTER_COMMAND, key())).toBe(false);
    expect(empty.editor.dispatchCommand(KEY_ARROW_DOWN_COMMAND, key())).toBe(false);
  });

  it("stepMenuIndex wraps both ways", () => {
    expect(stepMenuIndex(0, 4, -1)).toBe(3);
    expect(stepMenuIndex(3, 4, 1)).toBe(0);
    expect(stepMenuIndex(0, 0, 1)).toBe(0);
  });

  it("the `/`, `@` and `[[` menus all ride it (no menu keeps its own key handlers)", () => {
    const root = resolve(__dirname, "../../..");
    for (const file of [
      "features/spine/editor/mention-menu-plugin.tsx",
      "features/notes/editor/plugins/slash-menu-plugin.tsx",
      "features/notes/editor/plugins/note-link-plugin.tsx",
    ]) {
      const src = readFileSync(resolve(root, file), "utf8");
      expect({ file, shared: src.includes("registerMenuKeys(editor") }).toEqual({
        file,
        shared: true,
      });
      expect({ file, outside: src.includes("closeOnOutsidePointer(") }).toEqual({
        file,
        outside: true,
      });
      expect({ file, own: /KEY_(ARROW_(UP|DOWN)|ENTER|ESCAPE|TAB)_COMMAND/.test(src) }).toEqual({
        file,
        own: false,
      });
    }
  });
});
