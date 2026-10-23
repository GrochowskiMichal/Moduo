/**
 * Quiet block handles (NR-4, AC7). Hovering a top-level block shows a faint
 * ⋮⋮ in the left gutter: drag it to move the block, click it for Turn into ·
 * Duplicate · Delete · Comment. ⌥⇧↑ / ⌥⇧↓ move the block under the caret.
 *
 * The handle is an overlay NEXT TO the contenteditable (Lexical reclaims
 * foreign DOM inside its root, the NO-5 trap), placed at the hovered block's
 * offset inside the scrolling editor pane. Every move goes through
 * `moveBlockInDoc` on the Yjs doc (see block-move.ts for why not Lexical).
 */

import { $isCodeNode } from "@lexical/code";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createRangeSelection,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  type LexicalNode,
  type NodeKey,
} from "lexical";
import { Copy, GripVertical, MessageSquare, Trash2, Type } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import * as Y from "yjs";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import {
  $blockMenuFor,
  $deleteBlock,
  $duplicateBlock,
  $turnBlockInto,
  TURN_INTO,
} from "../block-actions";
import {
  BLOCK_MOVE_ORIGIN,
  type BlockMoveDirection,
  moveBlockInDoc,
  stepTarget,
} from "../block-move";
import { asUndoStep } from "../collab-undo";
import { NOTES_DOC_ROOT } from "../doc-markdown";
import { useNotesEditorBridge } from "../notes-editor-bridge";
import { ADD_COMMENT_COMMAND } from "./comment-marks-plugin";

type Hovered = { key: NodeKey; top: number; height: number };

/** How far the pointer travels on the grip before a press becomes a drag. */
const DRAG_SLOP_PX = 4;

/**
 * Where the grip sits for a block: centred on its FIRST line (a paragraph's
 * 26 px line, a heading's taller one), not pinned to the block's top edge,
 * which left it a few pixels under the text.
 */
function gripSpot(block: HTMLElement): { top: number; height: number } {
  const style = getComputedStyle(block);
  const padTop = Number.parseFloat(style.paddingTop) || 0;
  const line = Number.parseFloat(style.lineHeight);
  const lineHeight = Number.isFinite(line) ? line : (Number.parseFloat(style.fontSize) || 16) * 1.5;
  return {
    top: block.offsetTop + padTop,
    height: Math.min(lineHeight, block.offsetHeight || lineHeight),
  };
}

/** The editor's top-level block elements, in document order. */
function blockElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children).filter((el): el is HTMLElement => el instanceof HTMLElement);
}

/** Before which block index a pointer at `clientY` drops (0…count). */
export function dropIndexAt(
  rects: ReadonlyArray<{ top: number; bottom: number }>,
  clientY: number,
): number {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    if (clientY < (r.top + r.bottom) / 2) return i;
  }
  return rects.length;
}

export function BlockHandlePlugin({ doc }: { doc: Y.Doc }) {
  const [editor] = useLexicalComposerContext();
  const bridge = useNotesEditorBridge();
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropLine, setDropLine] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ from: number } | null>(null);
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;

  /** Index within root of the block whose DOM element is `el`. */
  const indexOfElement = (el: HTMLElement): number | null =>
    editor.read(() => {
      const node = $getNearestNodeFromDOMNode(el);
      const top = node?.getTopLevelElement() ?? node;
      return top && top.getParent() === $getRoot() ? top.getIndexWithinParent() : null;
    });

  /** Move with the Yjs doc only when it still mirrors the editor 1:1. */
  const move = (from: number, to: number): boolean => {
    const count = editor.getEditorState().read(() => $getRoot().getChildrenSize());
    if (doc.get(NOTES_DOC_ROOT, Y.XmlElement).length !== count) return false;
    return asUndoStep(editor, BLOCK_MOVE_ORIGIN, () => moveBlockInDoc(doc, from, to));
  };

  // ── hover tracking on the scrolling pane that holds the editor ─────────────
  useEffect(() => {
    let pane: HTMLElement | null = null;
    const onMove = (event: MouseEvent) => {
      if (menuOpenRef.current || dragRef.current) return;
      const root = editor.getRootElement();
      if (!root) return;
      const block = blockElements(root).find((el) => {
        const r = el.getBoundingClientRect();
        return event.clientY >= r.top && event.clientY < r.bottom;
      });
      if (!block) return;
      // The title line isn't a block to drag or turn into something else.
      if (block === root.firstElementChild) {
        setHovered(null);
        return;
      }
      const key = editor.read(() => $getNearestNodeFromDOMNode(block)?.getKey() ?? null);
      if (!key) return;
      const next = { key, ...gripSpot(block) };
      setHovered((prev) =>
        prev && prev.key === next.key && prev.top === next.top && prev.height === next.height
          ? prev
          : next,
      );
    };
    const onLeave = () => {
      if (!menuOpenRef.current && !dragRef.current) setHovered(null);
    };
    const unregister = editor.registerRootListener((root) => {
      pane?.removeEventListener("mousemove", onMove);
      pane?.removeEventListener("mouseleave", onLeave);
      pane = root?.parentElement ?? null;
      pane?.addEventListener("mousemove", onMove);
      pane?.addEventListener("mouseleave", onLeave);
    });
    return () => {
      unregister();
      pane?.removeEventListener("mousemove", onMove);
      pane?.removeEventListener("mouseleave", onLeave);
    };
  }, [editor]);

  // A block that leaves the document takes its handle with it.
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        setHovered((prev) =>
          prev && !editorState.read(() => $getNodeByKey(prev.key)) ? null : prev,
        );
      }),
    [editor],
  );

  // ── ⌥⇧↑ / ⌥⇧↓ ────────────────────────────────────────────────────────────
  useEffect(() => {
    const step = (direction: BlockMoveDirection) => (event: KeyboardEvent | null) => {
      if (!event || !event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey)
        return false;
      const at = editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return null;
        const block = selection.anchor.getNode().getTopLevelElement();
        return block
          ? { index: block.getIndexWithinParent(), count: $getRoot().getChildrenSize() }
          : null;
      });
      if (!at) return false;
      event.preventDefault();
      const to = stepTarget(at.index, direction, at.count);
      if (to !== null) move(at.index, to);
      return true;
    };
    const offUp = editor.registerCommand(KEY_ARROW_UP_COMMAND, step("up"), COMMAND_PRIORITY_HIGH);
    const offDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      step("down"),
      COMMAND_PRIORITY_HIGH,
    );
    return () => {
      offUp();
      offDown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, doc]);

  // ── drag: pointer events on the grip ───────────────────────────────────────
  // Not HTML5 drag-and-drop: a press on the grip either drags (past a few px)
  // or, released in place, opens the menu. The pointer is captured on the
  // grip, so the drop resolves against the blocks wherever the pointer goes,
  // and the pane scrolls when it nears an edge.
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const dropAt = (clientY: number): number | null => {
    const root = editor.getRootElement();
    if (!root) return null;
    return dropIndexAt(
      blockElements(root).map((el) => el.getBoundingClientRect()),
      clientY,
    );
  };
  const showDropLine = (at: number | null) => {
    const root = editor.getRootElement();
    const els = root ? blockElements(root) : [];
    const el = at === null ? undefined : els[Math.min(at, els.length - 1)];
    setDropLine(
      !el || at === null ? null : at < els.length ? el.offsetTop : el.offsetTop + el.offsetHeight,
    );
  };
  const scrollPane = (clientY: number) => {
    const pane = editor.getRootElement()?.closest<HTMLElement>(".notes-editor-v2");
    if (!pane) return;
    const r = pane.getBoundingClientRect();
    if (clientY < r.top + 40) pane.scrollTop -= 12;
    else if (clientY > r.bottom - 40) pane.scrollTop += 12;
  };

  const onGripDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    // Claim the press: Radix would open the menu on it.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pressRef.current = { x: event.clientX, y: event.clientY };
  };
  const onGripMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const press = pressRef.current;
    if (!press) return;
    if (!dragRef.current) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_SLOP_PX) return;
      const el = hovered ? editor.getElementByKey(hovered.key) : null;
      const index = el ? indexOfElement(el) : null;
      if (index === null) return;
      dragRef.current = { from: index };
      setDragging(true);
      setMenuOpen(false);
    }
    scrollPane(event.clientY);
    showDropLine(dropAt(event.clientY));
  };
  const onGripUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const pressed = pressRef.current !== null;
    pressRef.current = null;
    dragRef.current = null;
    setDragging(false);
    setDropLine(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag) {
      const at = dropAt(event.clientY);
      // Dropping before index `at` lands the block at `at` (or `at - 1` once
      // it has left its old place above).
      if (at !== null) move(drag.from, at > drag.from ? at - 1 : at);
      return;
    }
    if (pressed) setMenuOpen((open) => !open);
  };
  const onGripCancel = () => {
    pressRef.current = null;
    dragRef.current = null;
    setDragging(false);
    setDropLine(null);
  };

  const act = (fn: (key: NodeKey) => void) => {
    if (!hovered) return;
    const key = hovered.key;
    editor.focus();
    editor.update(() => fn(key));
  };

  const menu = hovered
    ? editor.getEditorState().read(() => {
        const node = $getNodeByKey(hovered.key);
        return node ? $blockMenuFor(node) : null;
      })
    : null;

  return (
    <>
      {dropLine !== null ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-6 h-0.5 rounded-full bg-primary"
          style={{ top: dropLine - 1 }}
        />
      ) : null}
      {dragging && hovered ? (
        // The block being carried, quietly marked where it was.
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-6 rounded-sm bg-state-hover"
          style={{
            top: editor.getElementByKey(hovered.key)?.offsetTop ?? 0,
            height: editor.getElementByKey(hovered.key)?.offsetHeight ?? 0,
          }}
        />
      ) : null}
      {hovered && menu ? (
        <div
          className="absolute left-0 flex w-6 items-center justify-center"
          style={{ top: hovered.top, height: hovered.height }}
        >
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onPointerDown={onGripDown}
                onPointerMove={onGripMove}
                onPointerUp={onGripUp}
                onPointerCancel={onGripCancel}
                aria-label="Block menu — drag to move"
                className={cn(
                  "grid size-5 cursor-grab touch-none place-items-center rounded-sm text-muted-foreground/40 transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-accent hover:text-muted-foreground active:cursor-grabbing",
                  (menuOpen || dragging) && "bg-accent text-muted-foreground",
                )}
              >
                <GripVertical className="size-3.5" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="bottom" className="w-52">
              {menu.turnInto ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Type aria-hidden />
                    Turn into
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {TURN_INTO.map((t) => (
                      <DropdownMenuItem
                        key={t.id}
                        onSelect={() =>
                          act((key) => {
                            const node = $getNodeByKey(key);
                            if (node) $turnBlockInto(node, t.id);
                          })
                        }
                      >
                        {t.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : null}
              {menu.duplicate ? (
                <DropdownMenuItem
                  onSelect={() =>
                    act((key) => {
                      const node = $getNodeByKey(key);
                      if (node) $duplicateBlock(node);
                    })
                  }
                >
                  <Copy aria-hidden />
                  Duplicate
                </DropdownMenuItem>
              ) : null}
              {bridge?.openComments ? (
                <DropdownMenuItem
                  onSelect={() => {
                    // Anchor a thread to the whole block (NR-8); a block with
                    // no text opens the panel's note-level thread instead.
                    let anchored = false;
                    if (hovered) {
                      editor.focus();
                      editor.update(
                        () => {
                          const node = $getNodeByKey(hovered.key);
                          anchored = node ? $selectBlockText(node) : false;
                        },
                        { discrete: true },
                      );
                    }
                    if (!anchored || !editor.dispatchCommand(ADD_COMMENT_COMMAND, undefined)) {
                      bridge.openComments?.();
                    }
                  }}
                >
                  <MessageSquare aria-hidden />
                  Comment
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() =>
                  act((key) => {
                    const node = $getNodeByKey(key);
                    if (node) $deleteBlock(node);
                  })
                }
              >
                <Trash2 aria-hidden />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </>
  );
}

/** Select every text run of a block, for anchoring a comment to it. */
function $selectBlockText(node: LexicalNode): boolean {
  // The code highlighter rebuilds a code block's runs and would drop the mark.
  if (!$isElementNode(node) || $isCodeNode(node)) return false;
  const texts = node.getAllTextNodes();
  const first = texts[0];
  const last = texts[texts.length - 1];
  if (!first || !last) return false;
  const sel = $createRangeSelection();
  sel.anchor.set(first.getKey(), 0, "text");
  sel.focus.set(last.getKey(), last.getTextContentSize(), "text");
  $setSelection(sel);
  return true;
}
