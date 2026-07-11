/**
 * FormatToolbarPlugin (DF-13) — the minimal floating selection toolbar:
 * Bold · Italic · Strikethrough · Code over any non-collapsed text selection.
 *
 * Same portal posture as the task-line hover pill: fixed-positioned into
 * document.body (NEVER into Lexical-owned DOM — the mutation observer reclaims
 * foreign children, see gotchas §Lexical), positioned off the native selection
 * rect and clamped to the viewport (flips below a near-top selection), and
 * dismissed on any scroll so stale coordinates can't invite a mis-click. Buttons
 * act on pointerdown with preventDefault so the editor keeps focus + selection.
 *
 * Full keyboard path: every format has a shortcut, so the bar is a mouse-first
 * discoverability aid, never the only way in. ⌘B/⌘I/⌘U are Lexical rich-text
 * core; this plugin adds ⌘⇧S (strikethrough) + ⌘E (inline code), the two the
 * core doesn't bind. The tooltips advertise all of them.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  BLUR_COMMAND,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  KEY_MODIFIER_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type LexicalNode,
  type TextFormatType,
} from "lexical";
import { $isCodeNode } from "@lexical/code";
import { Bold, Code, Italic, Strikethrough } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";

type Formats = { bold: boolean; italic: boolean; strikethrough: boolean; code: boolean };
type ToolbarState = { top: number; left: number; below: boolean; formats: Formats };

const TOOLBAR_OFFSET = 8;
/** Selections nearer than this to the viewport top flip the bar below them. */
const FLIP_THRESHOLD = 48;
/** ~half the bar's width — the horizontal viewport clamp margin. */
const EDGE_MARGIN = 72;

const ACTIONS: Array<{
  format: TextFormatType & keyof Formats;
  label: string;
  icon: typeof Bold;
}> = [
  { format: "bold", label: "Bold ⌘B", icon: Bold },
  { format: "italic", label: "Italic ⌘I", icon: Italic },
  { format: "strikethrough", label: "Strikethrough ⌘⇧S", icon: Strikethrough },
  { format: "code", label: "Code ⌘E", icon: Code },
];

/**
 * The keyboard path (DF-13): every toolbar format also has a shortcut, so a
 * keyboard-only user never needs to reach the mouse-first bar. Bold/Italic ride
 * Lexical rich-text core (⌘B/⌘I); these add the two the core doesn't bind, on
 * the Notion conventions (⌘⇧S strikethrough, ⌘E inline code). `preventDefault`
 * suppresses the browser's ⌘S/⌘⇧S save prompt.
 */
const SHORTCUTS: Array<{
  format: TextFormatType;
  needsShift: boolean;
  key: string;
}> = [
  { format: "strikethrough", needsShift: true, key: "s" },
  { format: "code", needsShift: false, key: "e" },
];

function sameState(a: ToolbarState, b: ToolbarState): boolean {
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.below === b.below &&
    a.formats.bold === b.formats.bold &&
    a.formats.italic === b.formats.italic &&
    a.formats.strikethrough === b.formats.strikethrough &&
    a.formats.code === b.formats.code
  );
}

/** Walk to the nearest CodeNode ancestor — inline formats don't render there. */
function inCodeBlock(node: LexicalNode | null): boolean {
  let cur = node;
  while (cur) {
    if ($isCodeNode(cur)) return true;
    cur = cur.getParent();
  }
  return false;
}

export function FormatToolbarPlugin({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<ToolbarState | null>(null);

  const recompute = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (
        !$isRangeSelection(selection) ||
        selection.isCollapsed() ||
        selection.getTextContent() === ""
      ) {
        setState(null);
        return;
      }
      // Both endpoints: a selection dragged from a paragraph INTO a code block
      // (or vice versa) must not offer formats that apply invisibly there.
      if (inCodeBlock(selection.anchor.getNode()) || inCodeBlock(selection.focus.getNode())) {
        setState(null);
        return;
      }
      // Geometry comes from the NATIVE selection — it must live inside this
      // editor's root (a selection in another pane must not summon our bar).
      const rootEl = editor.getRootElement();
      const native = window.getSelection();
      if (!rootEl || !native || native.rangeCount === 0) {
        setState(null);
        return;
      }
      if (!rootEl.contains(native.anchorNode)) {
        setState(null);
        return;
      }
      const rect = native.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setState(null);
        return;
      }
      // Clamp so the bar never renders off-screen: flip below a near-top
      // selection, clamp the horizontal center within the viewport.
      const below = rect.top < FLIP_THRESHOLD;
      const left = Math.min(
        Math.max(rect.left + rect.width / 2, EDGE_MARGIN),
        window.innerWidth - EDGE_MARGIN,
      );
      const next: ToolbarState = {
        top: below ? rect.bottom + TOOLBAR_OFFSET : rect.top - TOOLBAR_OFFSET,
        left,
        below,
        formats: {
          bold: selection.hasFormat("bold"),
          italic: selection.hasFormat("italic"),
          strikethrough: selection.hasFormat("strikethrough"),
          code: selection.hasFormat("code"),
        },
      };
      // Bail on no-change so a held selection doesn't re-render the portal on
      // every unrelated editor update (remote collab edits land constantly).
      setState((prev) => (prev && sameState(prev, next) ? prev : next));
    });
  }, [editor]);

  useEffect(() => {
    if (!editable) {
      setState(null);
      return;
    }
    // SELECTION_CHANGE fires on pure caret/selection moves (which don't always
    // surface as an update-listener tick — verified live: the update listener
    // alone missed selection-only changes and the bar never appeared). The
    // update listener additionally keeps the pressed states live while typing
    // inside a held selection. `sameState` bails the redundant re-render.
    const offSelection = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        recompute();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    const offUpdate = editor.registerUpdateListener(() => recompute());
    const offBlur = editor.registerCommand(
      BLUR_COMMAND,
      () => {
        setState(null);
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    // The keyboard path: strikethrough + inline code (the two formats Lexical
    // core doesn't bind). Works on any range selection, independent of whether
    // the mouse-first toolbar is showing.
    const offModifier = editor.registerCommand(
      KEY_MODIFIER_COMMAND,
      (event: KeyboardEvent) => {
        if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
        const key = event.key.toLowerCase();
        for (const s of SHORTCUTS) {
          if (key === s.key && event.shiftKey === s.needsShift) {
            const selection = $getSelection();
            if (!$isRangeSelection(selection) || selection.isCollapsed()) return false;
            event.preventDefault();
            editor.dispatchCommand(FORMAT_TEXT_COMMAND, s.format);
            return true;
          }
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    return () => {
      offSelection();
      offUpdate();
      offBlur();
      offModifier();
    };
  }, [editor, editable, recompute]);

  // Dismiss on scroll/resize — installed only while the bar is up, so the
  // capture-phase listener isn't running for every scroll in the app.
  const visible = state !== null;
  useEffect(() => {
    if (!visible) return;
    const hide = () => setState(null);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [visible]);

  if (!editable || !state) return null;

  return createPortal(
    <div
      className={`fixed z-[var(--z-popover)] flex -translate-x-1/2 items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 shadow-lg ${
        state.below ? "" : "-translate-y-full"
      }`}
      style={{ top: state.top, left: state.left }}
      role="toolbar"
      aria-label="Text formatting"
    >
      {ACTIONS.map(({ format, label, icon }) => {
        const active = state.formats[format];
        return (
          <IconButton
            key={format}
            icon={icon}
            label={label}
            aria-pressed={active}
            className={active ? "bg-accent text-foreground" : "text-muted-foreground"}
            onPointerDown={(e) => {
              // Keep the editor's focus + selection through the click.
              e.preventDefault();
            }}
            onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)}
          />
        );
      })}
    </div>,
    document.body,
  );
}
