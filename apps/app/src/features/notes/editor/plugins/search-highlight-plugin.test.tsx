// GS-10 (specs/global-search.md Q16, AC13): a note opened from a body hit
// highlights the query's word-starts until you click or type. The highlight is
// paint only (the CSS Custom Highlight API): it never writes into the editor,
// so nothing reaches the note's Yjs document.

import { afterEach, beforeEach, describe, expect, it } from "@rstest/core";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";

import { clearEntityOpenHighlight, entityOpenHighlight, markEntityOpenHighlight } from "@/lib/entity-open";

import {
  noteMatchRanges,
  SEARCH_HIGHLIGHT_NAME,
  SearchHighlightPlugin,
} from "./search-highlight-plugin";

// jsdom has no CSS Custom Highlight API: a registry that records what is painted.
class FakeHighlight {
  ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}
const painted = new Map<string, FakeHighlight>();

beforeEach(() => {
  painted.clear();
  (globalThis as any).Highlight = FakeHighlight;
  (globalThis as any).CSS = { ...(globalThis as any).CSS, highlights: painted };
  Element.prototype.scrollIntoView = function scrollIntoView() {
    scrolledTo.push(this as Element);
  };
});
const scrolledTo: Element[] = [];

afterEach(() => {
  cleanup();
  clearEntityOpenHighlight();
  scrolledTo.length = 0;
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

function Grab({ onEditor }: { onEditor: (e: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => onEditor(editor), [editor, onEditor]);
  return null;
}

function renderNote(lines: string[], noteId = "n1") {
  let editor: LexicalEditor | null = null;
  render(
    <LexicalComposer
      initialConfig={{
        namespace: "gs10",
        onError: (e: Error) => {
          throw e;
        },
        editorState: () => {
          const root = $getRoot();
          for (const line of lines) {
            root.append($createParagraphNode().append($createTextNode(line)));
          }
        },
      }}
    >
      <RichTextPlugin
        contentEditable={<ContentEditable aria-label="note" />}
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <SearchHighlightPlugin noteId={noteId} />
      <Grab onEditor={(e) => (editor = e)} />
    </LexicalComposer>,
  );
  return () => editor!;
}

const paintedText = () =>
  (painted.get(SEARCH_HIGHLIGHT_NAME)?.ranges ?? []).map((r) => r.toString());

describe("noteMatchRanges", () => {
  it("finds each word-start in the note's text, in order", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>Planning the <b>żółw</b> plan</p><p>airplane</p>";
    expect(noteMatchRanges(root, "plan zolw").map((r) => r.toString())).toEqual([
      "Plan",
      "żółw",
      "plan",
    ]);
  });
});

describe("SearchHighlightPlugin", () => {
  it("paints nothing without a pending query for this note", async () => {
    markEntityOpenHighlight("other", "kumquat");
    renderNote(["We tasted a kumquat"]);
    await settle();
    expect(painted.has(SEARCH_HIGHLIGHT_NAME)).toBe(false);
  });

  it("highlights the query's word-starts and scrolls to the first match", async () => {
    markEntityOpenHighlight("n1", "kumquat");
    renderNote(["Intro line", "We tasted a kumquat", "Kumquats again"]);
    await settle();
    expect(paintedText()).toEqual(["kumquat", "Kumquat"]);
    expect(scrolledTo[0]?.textContent).toBe("We tasted a kumquat");
  });

  it("never writes into the editor", async () => {
    markEntityOpenHighlight("n1", "kumquat");
    const editor = renderNote(["We tasted a kumquat"]);
    await settle();
    const before = JSON.stringify(editor().getEditorState().toJSON());
    let updates = 0;
    const off = editor().registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size > 0 || dirtyLeaves.size > 0) updates++;
    });
    await settle();
    off();
    expect(updates).toBe(0);
    expect(JSON.stringify(editor().getEditorState().toJSON())).toBe(before);
    expect(screen.getByLabelText("note").querySelector("mark")).toBeNull();
  });

  it("clears when you click in the note", async () => {
    markEntityOpenHighlight("n1", "kumquat");
    renderNote(["We tasted a kumquat"]);
    await settle();
    fireEvent.pointerDown(screen.getByLabelText("note"));
    await settle();
    expect(painted.has(SEARCH_HIGHLIGHT_NAME)).toBe(false);
    expect(entityOpenHighlight("n1")).toBeNull();
  });

  it("clears when you type", async () => {
    markEntityOpenHighlight("n1", "kumquat");
    renderNote(["We tasted a kumquat"]);
    await settle();
    fireEvent.keyDown(screen.getByLabelText("note"), { key: "a" });
    await settle();
    expect(painted.has(SEARCH_HIGHLIGHT_NAME)).toBe(false);
    expect(entityOpenHighlight("n1")).toBeNull();
  });
});
