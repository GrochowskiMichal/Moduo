/**
 * Sidebar tree keyboard map (specs/notes-refresh.md NR-2, AC4) — pure.
 *
 * The sidebar is a real tree (`role="tree"`). Given the VISIBLE rows in
 * order and the focused row, a key resolves to one action, the way a file
 * tree does it:
 *   ↑ / ↓        previous / next visible row (Home / End: first / last)
 *   →            expand a collapsed row, or step into its first child
 *   ←            collapse an expanded row, or step out to its parent
 *   ↵            open the note
 *   ⌫ / Delete   move it to the trash (editors only; the undo toast follows)
 *   ⌥⇧↑ / ⌥⇧↓    move it up / down among its siblings (editors only)
 *
 * Rows carry a `key` unique across sections, since one note can show twice
 * (as a Favorite and in Pages).
 */

export type TreeRow = {
  /** Unique across the whole sidebar, e.g. `pages:<id>` or `favorites:<id>`. */
  key: string;
  /** The note this row shows. */
  id: string;
  /** The row's parent ROW key, or null at a section's top level. */
  parentKey: string | null;
  expandable: boolean;
  expanded: boolean;
};

export type TreeKeyAction =
  | { type: "focus"; key: string }
  | { type: "expand"; key: string }
  | { type: "collapse"; key: string }
  | { type: "open"; id: string }
  | { type: "trash"; id: string }
  | { type: "reorder"; key: string; direction: "up" | "down" };

export type TreeKey = {
  key: string;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
};

export function treeKeyAction(
  rows: TreeRow[],
  focusedKey: string | null,
  event: TreeKey,
  opts: { canEdit: boolean },
): TreeKeyAction | null {
  if (rows.length === 0) return null;
  const index = focusedKey ? rows.findIndex((r) => r.key === focusedKey) : -1;
  const row = index >= 0 ? rows[index] : null;
  const plain = !event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey;
  const reorderChord = event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey;

  if (reorderChord && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    if (!row || !opts.canEdit) return null;
    return { type: "reorder", key: row.key, direction: event.key === "ArrowUp" ? "up" : "down" };
  }
  if (!plain) return null;

  switch (event.key) {
    case "ArrowDown":
      if (!row) return { type: "focus", key: rows[0].key };
      return index < rows.length - 1 ? { type: "focus", key: rows[index + 1].key } : null;
    case "ArrowUp":
      if (!row) return { type: "focus", key: rows[rows.length - 1].key };
      return index > 0 ? { type: "focus", key: rows[index - 1].key } : null;
    case "Home":
      return { type: "focus", key: rows[0].key };
    case "End":
      return { type: "focus", key: rows[rows.length - 1].key };
    case "ArrowRight": {
      if (!row || !row.expandable) return null;
      if (!row.expanded) return { type: "expand", key: row.key };
      const next = rows[index + 1];
      return next && next.parentKey === row.key ? { type: "focus", key: next.key } : null;
    }
    case "ArrowLeft": {
      if (!row) return null;
      if (row.expandable && row.expanded) return { type: "collapse", key: row.key };
      return row.parentKey ? { type: "focus", key: row.parentKey } : null;
    }
    case "Enter":
      return row ? { type: "open", id: row.id } : null;
    case "Backspace":
    case "Delete":
      return row && opts.canEdit ? { type: "trash", id: row.id } : null;
    default:
      return null;
  }
}
