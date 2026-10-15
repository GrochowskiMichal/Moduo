// DF-23 — the blur-commit must baseline against the SERIALIZED seed, so merely
// focusing then leaving a migrated (legacy plain-text) description does NOT fire
// a spurious write (updatedAt bump / phantom activity row). Regression guard for
// the senior-review finding.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from "lexical";
import {
  EntityTextEditor,
  type EntityTextEditorApi,
  type EntityTextEditorProps,
} from "./entity-text-editor";

afterEach(cleanup);

describe("EntityTextEditor commit-on-blur", () => {
  it("does not commit when a legacy plain-text value is focused then left untouched", () => {
    const onCommit = rs.fn();
    render(
      <EntityTextEditor
        value="a legacy plain description"
        editable
        runtime={null}
        workspaceId={null}
        source={{ type: "task", id: "t-1" }}
        ariaLabel="Description"
        onCommit={onCommit}
      />,
    );
    const box = screen.getByLabelText("Description");
    fireEvent.focus(box);
    fireEvent.blur(box);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("EntityTextEditor surfaces (MOD-115)", () => {
  const editor = (surface?: "ring" | "soft") =>
    render(
      <EntityTextEditor
        value="Some notes"
        editable
        runtime={null}
        workspaceId={null}
        source={{ type: "event", id: "e-1" }}
        ariaLabel="Notes"
        placeholder="Notes…"
        surface={surface}
      />,
    );

  it("keeps the ring by default (Calendar's notes look as before)", () => {
    editor();
    const box = screen.getByLabelText("Notes");
    expect(box.className).toContain("focus-visible:ring-2");
    expect(box.className).not.toContain("focus:bg-state-hover");
  });

  it("soft: plain text at rest, a quiet fill with its padding inside while editing", () => {
    editor("soft");
    const box = screen.getByLabelText("Notes");
    expect(box.className).toContain("focus:bg-state-hover");
    expect(box.className).toContain("px-2");
    expect(box.className).not.toContain("ring");
  });
});

describe("EntityTextEditor plain-text lists", () => {
  it("shows an imported Markdown list as bullet lines, and a bare visit writes nothing", () => {
    const onCommit = rs.fn();
    render(
      <EntityTextEditor
        value={"Cut list:\n- short\n- long"}
        editable
        runtime={null}
        workspaceId={null}
        source={{ type: "task", id: "t-1" }}
        ariaLabel="Description"
        onCommit={onCommit}
      />,
    );
    const box = screen.getByLabelText("Description");
    expect(box.textContent).toContain("• short");
    expect(box.textContent).toContain("• long");
    expect(box.textContent).not.toContain("- short");
    fireEvent.focus(box);
    fireEvent.blur(box);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("EntityTextEditor files (AT-2: attachments only, no image nodes)", () => {
  function clipboard(files: File[]) {
    return { types: ["Files"], files, items: [], getData: () => "" };
  }

  it("hands pasted files to onFiles instead of inserting them", async () => {
    const onFiles = rs.fn();
    render(
      <EntityTextEditor
        value=""
        editable
        runtime={null}
        workspaceId={null}
        source={{ type: "task", id: "t-1" }}
        ariaLabel="Description"
        onFiles={onFiles}
      />,
    );
    const box = screen.getByLabelText("Description");
    const shot = new File(["x"], "shot.png", { type: "image/png" });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.assign(paste, { clipboardData: clipboard([shot]) });
    // jsdom has neither event class; Lexical tells them apart by class name.
    class ClipboardEvent extends Event {}
    class DragEvent extends Event {}
    const g = globalThis as Record<string, unknown>;
    g.ClipboardEvent ??= ClipboardEvent;
    g.DragEvent ??= DragEvent;
    Object.setPrototypeOf(paste, (g.ClipboardEvent as typeof ClipboardEvent).prototype);
    box.dispatchEvent(paste);
    await new Promise((r) => setTimeout(r, 0));
    expect(onFiles).toHaveBeenCalledWith([shot]);
    expect(box.querySelector("img")).toBeNull();
  });
});

// ── Markdown (task descriptions, dogfood call #15 and MOD-117's ⏎) ─────────

const TASK = "11111111-1111-4111-8111-111111111111";

/** The Lexical editor behind a rendered contenteditable. */
function lexicalOf(box: HTMLElement): LexicalEditor {
  const editor = (box as HTMLElement & { __lexicalEditor?: LexicalEditor }).__lexicalEditor;
  if (!editor) throw new Error("no Lexical editor on this element");
  return editor;
}

/** Render the Markdown editor and let its seed land (Lexical commits it after the effect). */
async function markdownEditor(props: Partial<EntityTextEditorProps> = {}) {
  render(
    <EntityTextEditor
      value=""
      editable
      format="markdown"
      runtime={null}
      workspaceId={null}
      source={{ type: "task", id: "t-1" }}
      ariaLabel="Description"
      {...props}
    />,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return screen.getByLabelText("Description");
}

/** Let Lexical commit what a key or command just did (it commits after the event). */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

// A focused editor measures its caret; jsdom's Range can't.
const noRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
const rangeProto = Range.prototype as unknown as Record<string, unknown>;
rangeProto.getBoundingClientRect ??= noRect;
rangeProto.getClientRects ??= () => [];

/** Focus the text with the caret at its end. */
function caretAtEnd(box: HTMLElement) {
  box.focus();
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  let last: Node | null = null;
  while (walker.nextNode()) last = walker.currentNode;
  const range = document.createRange();
  if (last) range.setStart(last, last.textContent?.length ?? 0);
  else range.setStart(box, 0);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  act(() => {
    lexicalOf(box).update(() => $getRoot().selectEnd(), { discrete: true });
  });
}

describe("EntityTextEditor markdown (call #15)", () => {
  it("shows Markdown formatted: bold, a list, a checkbox, a link", async () => {
    const box = await markdownEditor({
      value: "**Adding an issue**\n\n- one\n- two\n\n- [x] done\n\n[docs](https://example.com)",
    });
    expect(box.querySelector("strong")?.textContent).toBe("Adding an issue");
    expect(box.querySelectorAll("ul.desc-ul > li.desc-li")).toHaveLength(3);
    expect(box.querySelector("li.desc-li-checked")?.textContent).toBe("done");
    expect(box.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    expect(box.textContent).not.toContain("**");
  });

  it("an old HTML description shows as Markdown, and a visit alone writes nothing", async () => {
    const onCommit = rs.fn();
    const box = await markdownEditor({
      value:
        '<p class="mb-2 last:mb-0"><b><strong class="font-semibold" style="white-space: pre-wrap;">Old</strong></b><span style="white-space: pre-wrap;"> words</span></p>',
      onCommit,
    });
    expect(box.querySelector("strong")?.textContent).toBe("Old");
    fireEvent.focus(box);
    fireEvent.blur(box);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("an old HTML description is saved as Markdown on its next edit, references included", async () => {
    const onCommit = rs.fn();
    const box = await markdownEditor({
      value: `<p class="mb-2 last:mb-0"><span style="white-space: pre-wrap;">See </span><span data-lexical-entity-ref="true" data-entity-type="task" data-entity-id="${TASK}" data-ref-v="2">task</span></p>`,
      onCommit,
    });
    act(() => {
      lexicalOf(box).update(
        () => {
          const p = $getRoot().getFirstChild();
          if ($isElementNode(p)) p.append($createTextNode(" soon"));
        },
        { discrete: true },
      );
    });
    fireEvent.blur(box);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toBe(`See [task](moduo://task/${TASK}) soon`);
  });

  it("reports each change as Markdown (the capture's live draft), never the seed", async () => {
    const onChange = rs.fn();
    const box = await markdownEditor({ value: "Seeded", onChange });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      lexicalOf(box).update(
        () => {
          const p = $getRoot().getFirstChild();
          if ($isElementNode(p)) p.append($createTextNode(" and *more*"));
        },
        { discrete: true },
      );
    });
    expect(onChange).toHaveBeenLastCalledWith("Seeded and \\*more\\*");
  });

  it("after the host replaces the text, typing the old words again is still reported (Create more)", async () => {
    const onChange = rs.fn();
    const apiRef: { current: EntityTextEditorApi | null } = { current: null };
    const box = await markdownEditor({ value: "", onChange, apiRef });
    const type = (words: string) =>
      act(() => {
        lexicalOf(box).update(
          () => {
            const p = $getRoot().getFirstChild();
            if ($isElementNode(p)) p.append($createTextNode(words));
          },
          { discrete: true },
        );
      });
    type("abc");
    expect(onChange).toHaveBeenLastCalledWith("abc");
    act(() => apiRef.current?.setValue(""));
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    type("abc");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith("abc");
  });

  it("a read-only link opens outside the app, and the window never follows one itself", async () => {
    const open = rs.spyOn(window, "open").mockImplementation(() => null);
    const box = await markdownEditor({
      value: "[docs](https://example.com) and [settings](/settings)",
      editable: false,
    });
    const click = (a: Element) => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      a.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const [docs, settings] = [...box.querySelectorAll("a")];
    expect(click(docs as Element)).toBe(true);
    expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    expect(click(settings as Element)).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });

  describe("a crafted description stays quick through every way in (security review)", () => {
    const ADVERSARIAL = [
      "*a".repeat(2_500),
      Array.from({ length: 20 }, () => `- ${"*a".repeat(2_400)}`).join("\n"),
      "[x](".repeat(15_000),
      `- a\n${"  more [x](\n".repeat(2_000)}`,
      "a\n".repeat(200_000),
    ].join("\n\n");
    const timed = async (fn: () => unknown) => {
      const start = performance.now();
      await act(async () => {
        fn();
        await new Promise((r) => setTimeout(r, 0));
      });
      return performance.now() - start;
    };

    it("load: the stored value, seeded and saved", async () => {
      const onCommit = rs.fn();
      const start = performance.now();
      const box = await markdownEditor({ value: ADVERSARIAL, onCommit });
      expect(performance.now() - start).toBeLessThan(3000);
      act(() => {
        lexicalOf(box).update(
          () => {
            const p = $getRoot().getFirstChild();
            if ($isElementNode(p)) p.append($createTextNode("x"));
          },
          { discrete: true },
        );
      });
      expect(await timed(() => fireEvent.blur(box))).toBeLessThan(3000);
      expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it("draft restore: the host's setValue, reported live", async () => {
      const onChange = rs.fn();
      const apiRef: { current: EntityTextEditorApi | null } = { current: null };
      await markdownEditor({ value: "", onChange, apiRef });
      expect(await timed(() => apiRef.current?.setValue(ADVERSARIAL))).toBeLessThan(3000);
      // Typing after it still reports, quickly, with the whole text.
      expect(
        await timed(() =>
          lexicalOf(screen.getByLabelText("Description")).update(
            () => {
              const p = $getRoot().getLastChild();
              if ($isElementNode(p)) p.append($createTextNode("!"));
            },
            { discrete: true },
          ),
        ),
      ).toBeLessThan(3000);
      expect(String(onChange.mock.lastCall?.[0] ?? "").length).toBeGreaterThan(400_000);
    });

    it("paste: pasted text is words, never parsed, and saves quickly", async () => {
      const onChange = rs.fn();
      const box = await markdownEditor({ value: "", onChange });
      caretAtEnd(box);
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      Object.assign(paste, {
        clipboardData: {
          types: ["text/plain"],
          files: [],
          items: [],
          getData: (type: string) => (type === "text/plain" ? "*a".repeat(50_000) : ""),
        },
      });
      const g = globalThis as Record<string, unknown>;
      g.ClipboardEvent ??= class ClipboardEvent extends Event {};
      Object.setPrototypeOf(paste, (g.ClipboardEvent as typeof Event).prototype);
      expect(await timed(() => box.dispatchEvent(paste))).toBeLessThan(3000);
      // It landed as words, escaped where Markdown would read them.
      expect(String(onChange.mock.lastCall?.[0] ?? "").length).toBeGreaterThan(100_000);
    });
  });

  it("refuses underline in Markdown: it couldn't be saved", async () => {
    const box = await markdownEditor({ value: "plain" });
    const editor = lexicalOf(box);
    act(() => {
      editor.update(
        () => {
          const text = $getRoot().getFirstDescendant();
          if ($isTextNode(text)) text.select(0, text.getTextContentSize());
        },
        { discrete: true },
      );
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline");
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
    });
    await settle();
    // Bold still applies; underline doesn't.
    expect(box.querySelector("strong")?.textContent).toBe("plain");
    expect(box.querySelector(".underline")).toBeNull();
  });
});

describe("EntityTextEditor ⏎ creates (quick capture, MOD-117)", () => {
  async function captureEditor() {
    const onEnter = rs.fn();
    const box = await markdownEditor({ value: "Notes", onEnter });
    caretAtEnd(box);
    return { box, onEnter };
  }
  const paragraphs = (box: HTMLElement) => box.querySelectorAll("p").length;

  it("⏎ creates, ⌘⏎ creates more", async () => {
    const { box, onEnter } = await captureEditor();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onEnter).toHaveBeenLastCalledWith(false);
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(onEnter).toHaveBeenLastCalledWith(true);
    await settle();
    expect(paragraphs(box)).toBe(1);
  });

  it("⇧⏎ starts a new line (a new paragraph, so a list goes on) and creates nothing", async () => {
    const { box, onEnter } = await captureEditor();
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    await settle();
    expect(onEnter).not.toHaveBeenCalled();
    expect(paragraphs(box)).toBe(2);
  });

  it("an open @ # / menu keeps ⏎ for its pick (it claims the key at high priority)", async () => {
    const { box, onEnter } = await captureEditor();
    // What MentionMenuPlugin registers while its menu is open.
    const off = lexicalOf(box).registerCommand(
      KEY_ENTER_COMMAND,
      () => true,
      COMMAND_PRIORITY_HIGH,
    );
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onEnter).not.toHaveBeenCalled();
    off();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("the panel's editor (no onEnter) keeps ⏎ as a new line", async () => {
    const box = await markdownEditor({ value: "Notes" });
    caretAtEnd(box);
    fireEvent.keyDown(box, { key: "Enter" });
    await settle();
    expect(paragraphs(box)).toBe(2);
  });

  it("a menu showing nothing to pick yet keeps ⏎: it closes, and only the next ⏎ creates", async () => {
    const { box, onEnter } = await captureEditor();
    // Type " @zz" at the caret: the `@` menu opens with no matches.
    act(() => {
      lexicalOf(box).update(
        () => {
          const p = $getRoot().getFirstChild();
          if ($isElementNode(p)) {
            const text = $createTextNode(" @zz");
            p.append(text);
            text.selectEnd();
          }
        },
        { discrete: true },
      );
    });
    caretAtEnd(box);
    await settle();
    expect(screen.getByText(/No matches|Searching/)).toBeTruthy();
    fireEvent.keyDown(box, { key: "Enter" });
    await settle();
    expect(onEnter).not.toHaveBeenCalled();
    expect(screen.queryByText(/No matches|Searching/)).toBeNull();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });
});
