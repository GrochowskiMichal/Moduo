/**
 * Table controls. A table had no way to grow: no add-row, no add-column, no
 * delete. Hovering a table (or putting the caret in it) now shows:
 *
 * - a thin "+" bar under it (add a row) and one on its right (add a column);
 * - on the cell with the caret, a small menu: insert above/below/left/right,
 *   delete the row, the column or the table.
 *
 * Everything draws next to the contenteditable (Lexical reclaims foreign DOM
 * inside it), positioned against the reading column like the block handle.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $getTableCellNodeFromLexicalNode,
  $getTableNodeFromLexicalNodeOrThrow,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  type TableCellNode,
} from "@lexical/table";
import { mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_TAB_COMMAND,
  type NodeKey,
} from "lexical";
import { ChevronDown, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { noteColumn } from "../note-column";

type Box = { top: number; left: number; width: number; height: number };
type Spot = { tableKey: NodeKey; table: Box; cellKey: NodeKey | null; cell: Box | null };

/** `el`'s box relative to the reading column (the overlays' container). */
function boxIn(el: HTMLElement, container: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  return { top: r.top - c.top, left: r.left - c.left, width: r.width, height: r.height };
}

/** Put the caret in a cell, so the table commands act on it. */
function $selectCell(cell: TableCellNode): void {
  cell.selectEnd();
}

/** The table's last cell (its last row's last cell). */
function $lastCell(tableKey: NodeKey): TableCellNode | null {
  const table = $getNodeByKey(tableKey);
  if (!$isTableNode(table)) return null;
  const row = table.getLastChild();
  if (!$isTableRowNode(row)) return null;
  const cell = row.getLastChild();
  return $isTableCellNode(cell) ? cell : null;
}

export function TableActionsPlugin() {
  const [editor] = useLexicalComposerContext();
  const [spot, setSpot] = useState<Spot | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const hoverTable = useRef<NodeKey | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;

  const recompute = useCallback(() => {
    const root = editor.getRootElement();
    const container = noteColumn(root);
    if (!root || !container) return setSpot(null);
    const next = editor.getEditorState().read((): Spot | null => {
      let cell: TableCellNode | null = null;
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        cell = $getTableCellNodeFromLexicalNode(selection.anchor.getNode());
      }
      const tableKey = cell
        ? $getTableNodeFromLexicalNodeOrThrow(cell).getKey()
        : hoverTable.current;
      if (!tableKey || !$getNodeByKey(tableKey)) return null;
      const tableEl = editor.getElementByKey(tableKey);
      const tableTag = tableEl?.tagName === "TABLE" ? tableEl : tableEl?.querySelector("table");
      if (!tableTag) return null;
      const cellEl = cell ? editor.getElementByKey(cell.getKey()) : null;
      return {
        tableKey,
        table: boxIn(tableTag, container),
        cellKey: cell?.getKey() ?? null,
        cell: cellEl ? boxIn(cellEl, container) : null,
      };
    });
    setSpot((prev) =>
      prev &&
      next &&
      prev.tableKey === next.tableKey &&
      prev.cellKey === next.cellKey &&
      JSON.stringify(prev.table) === JSON.stringify(next.table) &&
      JSON.stringify(prev.cell) === JSON.stringify(next.cell)
        ? prev
        : next,
    );
  }, [editor]);

  // The caret moving, the document changing, or the layout moving.
  useEffect(() => {
    const offUpdate = editor.registerUpdateListener(() => recompute());
    const observer = new ResizeObserver(() => recompute());
    const offRoot = editor.registerRootListener((root, prev) => {
      if (prev) observer.unobserve(prev);
      if (root) observer.observe(root);
    });
    return () => {
      offUpdate();
      offRoot();
      observer.disconnect();
    };
  }, [editor, recompute]);

  // Keys and clicks a table should answer like a document's table:
  // - Tab in the last cell adds a row (it left the table);
  // - ↓ on the last row leaves the table (it moved to the next cell);
  // - a click on a cell's empty space puts the caret in that cell (only a
  //   click on its text did, so typing landed in another cell).
  useEffect(() => {
    const cellAtCaret = () => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
      return $getTableCellNodeFromLexicalNode(selection.anchor.getNode());
    };
    const onPointerDown = (event: PointerEvent) => {
      const cellEl = (event.target as HTMLElement | null)?.closest("td, th");
      // Only a press on the cell itself (its padding), never on its text.
      if (!cellEl || event.target !== cellEl) return;
      event.preventDefault();
      editor.update(() => {
        const node = $getNearestNodeFromDOMNode(cellEl);
        if ($isTableCellNode(node)) node.selectEnd();
      });
      editor.focus();
    };
    const offRoot = editor.registerRootListener((root, prev) => {
      prev?.removeEventListener("pointerdown", onPointerDown);
      root?.addEventListener("pointerdown", onPointerDown);
    });
    return mergeRegister(
      offRoot,
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          if (event.shiftKey) return false;
          const cell = cellAtCaret();
          if (!cell) return false;
          const row = cell.getParent();
          const table = row?.getParent();
          if (!$isTableRowNode(row) || !$isTableNode(table)) return false;
          if (!row.is(table.getLastChild()) || !cell.is(row.getLastChild())) return false;
          event.preventDefault();
          $insertTableRowAtSelection(true);
          const added = row.getNextSibling();
          if ($isTableRowNode(added)) added.getFirstChild<TableCellNode>()?.selectStart();
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => {
          const cell = cellAtCaret();
          if (!cell) return false;
          const row = cell.getParent();
          const table = row?.getParent();
          if (!$isTableRowNode(row) || !$isTableNode(table) || !row.is(table.getLastChild())) {
            return false;
          }
          event?.preventDefault();
          const next = table.getNextSibling();
          if ($isElementNode(next)) next.selectStart();
          else {
            const line = $createParagraphNode();
            table.insertAfter(line);
            line.select();
          }
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      () => editor.getRootElement()?.removeEventListener("pointerdown", onPointerDown),
    );
  }, [editor]);

  // Hover: the pointer over a table shows its bars even without the caret.
  useEffect(() => {
    let pane: HTMLElement | null = null;
    // Cleared AND forgotten: a cleared id left in the ref read as "a leave is
    // already pending", so after a quick out-and-back the bars never hid.
    const cancelLeave = () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    };
    const onMove = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-table-actions]")) {
        cancelLeave();
        return;
      }
      const tableEl = target?.closest("table");
      const nextKey = tableEl
        ? editor.read(() => {
            for (let n = $getNearestNodeFromDOMNode(tableEl); n; n = n.getParent()) {
              if ($isTableNode(n)) return n.getKey();
            }
            return null;
          })
        : null;
      if (nextKey) {
        cancelLeave();
        if (hoverTable.current !== nextKey) {
          hoverTable.current = nextKey;
          recompute();
        }
        return;
      }
      if (hoverTable.current && !leaveTimer.current) {
        leaveTimer.current = setTimeout(() => {
          leaveTimer.current = null;
          if (menuOpenRef.current) return;
          hoverTable.current = null;
          recompute();
        }, 300);
      }
    };
    const offRoot = editor.registerRootListener((root) => {
      pane?.removeEventListener("mousemove", onMove);
      pane = noteColumn(root);
      pane?.addEventListener("mousemove", onMove);
    });
    return () => {
      offRoot();
      pane?.removeEventListener("mousemove", onMove);
      cancelLeave();
    };
  }, [editor, recompute]);

  if (!spot || !editor.isEditable()) return null;
  const { table, cell, tableKey, cellKey } = spot;

  const addRow = () =>
    editor.update(() => {
      const last = $lastCell(tableKey);
      if (!last) return;
      $selectCell(last);
      $insertTableRowAtSelection(true);
    });
  const addColumn = () =>
    editor.update(() => {
      const last = $lastCell(tableKey);
      if (!last) return;
      $selectCell(last);
      $insertTableColumnAtSelection(true);
    });
  const inCell = (fn: () => void) => () =>
    editor.update(() => {
      const node = cellKey ? $getNodeByKey(cellKey) : null;
      if (!$isTableCellNode(node)) return;
      $selectCell(node);
      fn();
    });
  const deleteTable = () =>
    editor.update(() => {
      $getNodeByKey(tableKey)?.remove();
    });

  const bar =
    "absolute flex items-center justify-center rounded-sm text-muted-foreground/60 transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground";

  return (
    <div data-table-actions="">
      <button
        type="button"
        aria-label="Add a row"
        title="Add a row"
        onMouseDown={(e) => e.preventDefault()}
        onClick={addRow}
        className={cn(bar, "h-4")}
        style={{ top: table.top + table.height + 2, left: table.left, width: table.width }}
      >
        <Plus aria-hidden className="size-3" />
      </button>
      <button
        type="button"
        aria-label="Add a column"
        title="Add a column"
        onMouseDown={(e) => e.preventDefault()}
        onClick={addColumn}
        className={cn(bar, "w-4")}
        style={{ top: table.top, left: table.left + table.width + 2, height: table.height }}
      >
        <Plus aria-hidden className="size-3" />
      </button>
      {cell ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Row and column actions"
              onMouseDown={(e) => e.preventDefault()}
              className="absolute grid size-5 place-items-center rounded-sm bg-popover text-muted-foreground shadow-sm hover:text-foreground"
              style={{ top: cell.top + 4, left: cell.left + cell.width - 24 }}
            >
              <ChevronDown aria-hidden className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem onSelect={inCell(() => $insertTableRowAtSelection(false))}>
              Insert row above
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={inCell(() => $insertTableRowAtSelection(true))}>
              Insert row below
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={inCell(() => $insertTableColumnAtSelection(false))}>
              Insert column left
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={inCell(() => $insertTableColumnAtSelection(true))}>
              Insert column right
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={inCell($deleteTableRowAtSelection)}>
              Delete row
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={inCell($deleteTableColumnAtSelection)}
            >
              Delete column
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={deleteTable}>
              Delete table
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
