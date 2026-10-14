// Multi-select (tasks-v3 §4, call 82b; TV-U12): which tasks are selected
// besides the cursor. Pure: the views hand in their visible order, so a
// range is what the person sees, and the selection lives apart from what's
// drawn (a virtualized list keeps off-screen rows selected, TV-D11b).
//
//   • A click selects one task (the cursor; no set).
//   • ⌘-click (Ctrl on Windows) adds or removes one, starting from the cursor.
//   • ⇧-click and ⇧↑↓ select the range from the anchor to the task.
//   • ⌘A selects every task the view shows; Esc goes back to the cursor alone.
//
// The cursor stays `selectedTaskId` (the panel, the URL, the keys); `ids` is
// the set only while two or more are selected, empty otherwise.

export type TaskSelection = {
  /** The selected tasks while two or more are; empty otherwise. */
  readonly ids: ReadonlySet<string>;
  /** Where a ⇧-click or ⇧↑↓ range starts. */
  readonly anchor: string | null;
};

const NO_IDS: ReadonlySet<string> = new Set();
export const NO_SELECTION: TaskSelection = { ids: NO_IDS, anchor: null };

/** What a click asks for: ⇧ (a range) or ⌘/Ctrl (one more or one less). */
export type SelectMods = { range: boolean; toggle: boolean };

export const PLAIN_SELECT: SelectMods = { range: false, toggle: false };

/** The modifiers of a click or key, as a selection reads them. */
export function selectModsOf(event: {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): SelectMods {
  return { range: event.shiftKey, toggle: event.metaKey || event.ctrlKey };
}

/** Two or more tasks are selected. */
export function isMulti(selection: TaskSelection): boolean {
  return selection.ids.size >= 2;
}

/** A selection and where the cursor goes with it. */
export type SelectResult = { selection: TaskSelection; cursor: string | null };

function single(id: string | null): SelectResult {
  return { selection: { ids: NO_IDS, anchor: id }, cursor: id };
}

/** The tasks from `from` to `to` in the view's order, both ends included. */
function rangeOf(order: readonly string[], from: string, to: string): string[] {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0) return [to];
  return a <= b ? order.slice(a, b + 1) : order.slice(b, a + 1);
}

/**
 * A click on `id` (with ⇧ or ⌘), against the view's visible order. ⌘ wins
 * over ⇧ when both are held (one more, as Finder does).
 */
export function selectWith(
  selection: TaskSelection,
  cursor: string | null,
  id: string,
  mods: SelectMods,
  order: readonly string[],
): SelectResult {
  if (mods.toggle) {
    const ids = new Set(selection.ids.size > 0 ? selection.ids : cursor ? [cursor] : []);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    if (ids.size < 2) {
      const left = [...ids][0] ?? null;
      return single(left ?? id);
    }
    // Adding moves the cursor there; taking one out leaves it on another one.
    const next = ids.has(id) ? id : cursor && ids.has(cursor) ? cursor : lastInOrder(ids, order);
    return { selection: { ids, anchor: id }, cursor: next };
  }
  if (mods.range) {
    // A range starts at the anchor of a set already made, else at the cursor
    // (the keys move the cursor without setting an anchor).
    const from = (selection.ids.size > 0 ? selection.anchor : null) ?? cursor ?? id;
    const ids = rangeOf(order, from, id);
    if (ids.length < 2) return single(id);
    return { selection: { ids: new Set(ids), anchor: from }, cursor: id };
  }
  return single(id);
}

/** ⇧↑ / ⇧↓: the range to the task above or below the cursor. */
export function extendSelection(
  selection: TaskSelection,
  cursor: string | null,
  step: 1 | -1,
  order: readonly string[],
): SelectResult | null {
  const at = cursor ? order.indexOf(cursor) : -1;
  if (at < 0) return null;
  const next = order[at + step];
  if (!next) return null;
  return selectWith(selection, cursor, next, { range: true, toggle: false }, order);
}

/** ⌘A: every task the view shows. The cursor stays when it's among them. */
export function selectAll(cursor: string | null, order: readonly string[]): SelectResult | null {
  if (order.length < 2) return null;
  const keep = cursor && order.includes(cursor) ? cursor : order[0];
  return { selection: { ids: new Set(order), anchor: order[0] }, cursor: keep };
}

/**
 * Drop the tasks that left (moved out of the scope, deleted, hidden): one
 * left alone is the cursor again. Null when nothing changed.
 */
export function pruneSelection(
  selection: TaskSelection,
  cursor: string | null,
  keep: (id: string) => boolean,
  order: readonly string[] = [],
): SelectResult | null {
  if (selection.ids.size === 0) return null;
  const ids = new Set([...selection.ids].filter(keep));
  if (ids.size === selection.ids.size) return null;
  if (ids.size >= 2) {
    const next = cursor && ids.has(cursor) ? cursor : lastInOrder(ids, order);
    return { selection: { ids, anchor: selection.anchor }, cursor: next };
  }
  const left = [...ids][0] ?? null;
  return single(cursor && keep(cursor) ? cursor : left);
}

/** The selected ids in the view's order; any it doesn't show come last. */
export function inViewOrder(ids: ReadonlySet<string>, order: readonly string[]): string[] {
  const shown = order.filter((id) => ids.has(id));
  if (shown.length === ids.size) return shown;
  const seen = new Set(shown);
  return [...shown, ...[...ids].filter((id) => !seen.has(id))];
}

function lastInOrder(ids: ReadonlySet<string>, order: readonly string[]): string | null {
  for (let i = order.length - 1; i >= 0; i -= 1) if (ids.has(order[i])) return order[i];
  return [...ids][ids.size - 1] ?? null;
}
