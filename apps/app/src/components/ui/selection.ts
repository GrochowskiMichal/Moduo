// The two selection recipes (DESIGN_RULES R5, DS-2). Selection is tint-only,
// never a bar; src/components/selection-guard.test.ts fails on a bar. Use these
// rather than spelling the classes out, so every list and card keeps one look.
// A rail or nav's CURRENT destination is not "selected": it takes the neutral
// `bg-state-active` instead.

/** A selected row in a list (task, note, email thread, contact, picker row):
 *  the accent tint plus the row hairline switch, `--state-selected-edge` in
 *  tokens.css (the 32% ring by default, `transparent` for tint only). */
export const SELECTED_ROW = "bg-state-selected ring-1 ring-inset ring-state-selected-edge";

/** A selected card or bordered option (board card, booking chip, option card):
 *  the tint plus the 32% ring, always, drawn on a transparent border so the
 *  box keeps its size. */
export const SELECTED_OPTION =
  "border-transparent bg-state-selected ring-1 ring-inset ring-state-selected";
