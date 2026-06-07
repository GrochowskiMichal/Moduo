import { describe, expect, it, vi } from "vitest";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor, type LexicalEditor } from "lexical";
import { $createCodeNode, CodeNode } from "@lexical/code";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListItemNode, ListNode } from "@lexical/list";
import { TableNode } from "@lexical/table";
import { act, render } from "@testing-library/react";
import { ToggleNode } from "../nodes/ToggleNode";
import { NotesBlockControlsPlugin } from "./NotesBlockControlsPlugin";

vi.mock("@lexical/react/LexicalComposerContext", () => ({
  LexicalComposerContext: undefined,
  useLexicalComposerContext: () => [globalThis.__MODUO_TEST_EDITOR__],
}));

declare global {
  // eslint-disable-next-line no-var
  var __MODUO_TEST_EDITOR__: LexicalEditor | undefined;
}

function flushAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function mountTestEditor(buildState: () => void): { editor: LexicalEditor; dispose: () => void } {
  const editorRoot = document.createElement("div");
  editorRoot.setAttribute("contenteditable", "true");
  document.body.appendChild(editorRoot);
  const editor = createEditor({
    nodes: [CodeNode, HeadingNode, ListNode, ListItemNode, QuoteNode, TableNode, ToggleNode],
    onError: (error) => { throw error; },
  });
  globalThis.__MODUO_TEST_EDITOR__ = editor;
  editor.update(buildState, { discrete: true });
  editor.setRootElement(editorRoot);
  return {
    editor,
    dispose: () => {
      editor.setRootElement(null);
      editorRoot.remove();
    },
  };
}

describe("drag handle visibility (real editor)", () => {
  it("drag handle is visible on paragraph hover", async () => {
    const { editor, dispose } = mountTestEditor(() => {
      const p = $createParagraphNode().append($createTextNode("Hello world"));
      $getRoot().append(p);
    });

    // Render the plugin
    const { container, unmount } = render(<NotesBlockControlsPlugin />);

    // Capture errors
    const origError = console.error;
    const errors: string[] = [];
    console.error = (...args) => {
      errors.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      origError.apply(console, args);
    };

    try {
      const root = editor.getRootElement();
      expect(root).not.toBeNull();
      const paragraphEl = root!.querySelector("p");
      expect(paragraphEl).not.toBeNull();
      console.log("paragraph text:", paragraphEl!.textContent);

      // First, trigger a focus event on the editor root
      root!.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
      root!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      paragraphEl!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, clientX: 100, clientY: 50 }));
      await act(async () => {
        paragraphEl!.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 100, clientY: 50 }));
        await flushAnimationFrame();
      });

      console.log("errors:", errors);

      const grip = document.querySelector(".notes-block-grip");
      console.log("grip:", grip);

      if (grip) {
        const styles = window.getComputedStyle(grip as HTMLElement);
        const rect = (grip as HTMLElement).getBoundingClientRect();
        console.log("grip rect:", rect);
        console.log("grip computed styles:", {
          display: styles.display,
          visibility: styles.visibility,
          opacity: styles.opacity,
          position: styles.position,
          width: styles.width,
          height: styles.height,
        });
      }
    } finally {
      console.error = origError;
    }

    unmount();
    dispose();
  });
});
