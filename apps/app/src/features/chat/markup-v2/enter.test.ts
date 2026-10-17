import { createHeadlessEditor } from "@lexical/headless";
import { describe, expect, it } from "@rstest/core";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $setCompositionKey,
  KEY_ENTER_COMMAND,
} from "lexical";

import { enterIntent, registerSendOnEnter } from "./enter";

function enter(init: {
  isComposing?: boolean;
  keyCode?: number;
  shiftKey?: boolean;
  metaKey?: boolean;
}) {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    isComposing: init.isComposing ?? false,
    shiftKey: init.shiftKey ?? false,
    metaKey: init.metaKey ?? false,
    cancelable: true,
  });
  // KeyboardEventInit has no keyCode; WebKit's committing Enter carries 229.
  if (init.keyCode !== undefined) Object.defineProperty(event, "keyCode", { value: init.keyCode });
  return event;
}

function composer() {
  const editor = createHeadlessEditor({
    namespace: "enter-test",
    onError: (error) => {
      throw error;
    },
  });
  const sent: number[] = [];
  registerSendOnEnter(editor, () => sent.push(1));
  return { editor, sent };
}

describe("enterIntent", () => {
  it("never sends while an input method composes", () => {
    expect(enterIntent(enter({ isComposing: true }), false)).toBe("compose");
    expect(enterIntent(enter({ keyCode: 229 }), false)).toBe("compose");
    expect(enterIntent(enter({}), true)).toBe("compose");
    expect(enterIntent(enter({ isComposing: true, shiftKey: true }), false)).toBe("compose");
  });

  it("⏎ and ⌘⏎ send, ⇧⏎ is a new line", () => {
    expect(enterIntent(enter({}), false)).toBe("send");
    expect(enterIntent(enter({ metaKey: true }), false)).toBe("send");
    expect(enterIntent(enter({ shiftKey: true }), false)).toBe("newline");
    expect(enterIntent(null, false)).toBe("send");
  });
});

describe("registerSendOnEnter", () => {
  it("a composing ⏎ is swallowed without sending or cancelling the key", () => {
    const { editor, sent } = composer();
    for (const event of [enter({ isComposing: true }), enter({ keyCode: 229 })]) {
      const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, event);
      expect(handled).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(sent).toHaveLength(0);
  });

  it("⏎ during Lexical's own composition doesn't send", () => {
    const { editor, sent } = composer();
    editor.update(
      () => {
        const text = $createTextNode("にほ");
        $getRoot().append($createParagraphNode().append(text));
        $setCompositionKey(text.getKey());
      },
      { discrete: true },
    );
    expect(editor.isComposing()).toBe(true);
    editor.dispatchCommand(KEY_ENTER_COMMAND, enter({}));
    expect(sent).toHaveLength(0);
  });

  it("⏎ sends once and cancels the key; ⇧⏎ is left to the editor", () => {
    const { editor, sent } = composer();
    const plain = enter({});
    expect(editor.dispatchCommand(KEY_ENTER_COMMAND, plain)).toBe(true);
    expect(plain.defaultPrevented).toBe(true);
    expect(sent).toHaveLength(1);
    expect(editor.dispatchCommand(KEY_ENTER_COMMAND, enter({ shiftKey: true }))).toBe(false);
    expect(sent).toHaveLength(1);
  });
});
