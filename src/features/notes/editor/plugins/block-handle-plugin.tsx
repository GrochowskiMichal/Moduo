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

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  type NodeKey,
} from "lexical";
import { Copy, GripVertical, MessageSquare, Trash2, Type } from "lucide-react";
import { type DragEvent as ReactDragEvent, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
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
import { type BlockMoveDirection, moveBlockInDoc, stepTarget } from "../block-move";
import { NOTES_DOC_ROOT } from "../doc-markdown";
import { useNotesEditorBridge } from "../notes-editor-bridge";

const BLOCK_MIME = "application/x-moduo-block";

type Hovered = { key: NodeKey; top: number; height: number };

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
  const dragFrom = useRef<number | null>(null);
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
    return moveBlockInDoc(doc, from, to);
  };

  // ── hover tracking on the scrolling pane that holds the editor ─────────────
  useEffect(() => {
    let pane: HTMLElement | null = null;
    const onMove = (event: MouseEvent) => {
      if (menuOpenRef.current) return;
      const root = editor.getRootElement();
      if (!root) return;
      const block = blockElements(root).find((el) => {
        const r = el.getBoundingClientRect();
        return event.clientY >= r.top && event.clientY < r.bottom;
      });
      if (!block) return;
      const key = editor.read(() => $getNearestNodeFromDOMNode(block)?.getKey() ?? null);
      if (!key) return;
      const next = { key, top: block.offsetTop, height: block.offsetHeight };
      setHovered((prev) =>
        prev && prev.key === next.key && prev.top === next.top && prev.height === next.height
          ? prev
          : next,
      );
    };
    const onLeave = () => {
      if (!menuOpenRef.current) setHovered(null);
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

  // ── drag: the handle starts it, the pane resolves it ───────────────────────
  useEffect(() => {
    let pane: HTMLElement | null = null;
    const isOurs = (event: DragEvent) => event.dataTransfer?.types.includes(BLOCK_MIME) ?? false;
    const target = (event: DragEvent): number | null => {
      const root = editor.getRootElement();
      if (!root) return null;
      const rects = blockElements(root).map((el) => el.getBoundingClientRect());
      return dropIndexAt(rects, event.clientY);
    };
    // Capture phase + stopPropagation: Lexical's own drop handling (text and
    // file drops) and the page's entity drop zone never see a block drag.
    const onOver = (event: DragEvent) => {
      if (!isOurs(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const at = target(event);
      const root = editor.getRootElement();
      if (at === null || !root) return;
      const els = blockElements(root);
      const el = els[Math.min(at, els.length - 1)];
      if (!el) return;
      setDropLine(at < els.length ? el.offsetTop : el.offsetTop + el.offsetHeight);
    };
    const onDrop = (event: DragEvent) => {
      if (!isOurs(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setDropLine(null);
      const from = dragFrom.current;
      const at = target(event);
      dragFrom.current = null;
      if (from === null || at === null) return;
      // Dropping before index `at` lands the block at `at` (or `at - 1` once
      // it has left its old place above).
      move(from, at > from ? at - 1 : at);
    };
    const onLeave = (event: DragEvent) => {
      if (isOurs(event) && event.target === pane) setDropLine(null);
    };
    const unregister = editor.registerRootListener((root) => {
      pane?.removeEventListener("dragover", onOver, true);
      pane?.removeEventListener("drop", onDrop, true);
      pane?.removeEventListener("dragleave", onLeave, true);
      pane = root?.parentElement ?? null;
      pane?.addEventListener("dragover", onOver, true);
      pane?.addEventListener("drop", onDrop, true);
      pane?.addEventListener("dragleave", onLeave, true);
    });
    return () => {
      unregister();
      pane?.removeEventListener("dragover", onOver, true);
      pane?.removeEventListener("drop", onDrop, true);
      pane?.removeEventListener("dragleave", onLeave, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, doc]);

  const onDragStart = (event: ReactDragEvent<HTMLButtonElement>) => {
    if (!hovered) return;
    const el = editor.getElementByKey(hovered.key);
    const index = el ? indexOfElement(el) : null;
    if (index === null) {
      event.preventDefault();
      return;
    }
    dragFrom.current = index;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(BLOCK_MIME, String(index));
    if (el) event.dataTransfer.setDragImage(el, 0, 0);
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
      {hovered && menu ? (
        <div
          className="absolute left-0 flex w-6 items-start justify-center"
          style={{ top: hovered.top, height: hovered.height }}
        >
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                draggable
                onDragStart={onDragStart}
                onDragEnd={() => {
                  dragFrom.current = null;
                  setDropLine(null);
                }}
                aria-label="Block menu — drag to move"
                className={cn(
                  "mt-1 grid size-5 cursor-grab place-items-center rounded-sm text-muted-foreground/40 transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-accent hover:text-muted-foreground active:cursor-grabbing",
                  menuOpen && "bg-accent text-muted-foreground",
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
                <DropdownMenuItem onSelect={() => bridge.openComments?.()}>
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
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>
                Move
                <DropdownMenuShortcut>⌥⇧↑ ↓</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </>
  );
}
