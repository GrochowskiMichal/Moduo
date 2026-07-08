// Contacts custom-field definitions — single-select option helpers (block FX-8,
// AC11). A `select` field def carries its choices in `ContactFieldDef.options`
// (stored as a jsonb string array; the model exposes `string[]`). These pure
// helpers parse the comma-entry input, serialize options back for editing, and
// compute the option list to render — always preserving a stored value that is
// no longer in the def's options (like status does). No I/O, no React —
// unit-tested in field-defs.test.ts.

import type { ContactFieldDef } from "./model";

/**
 * Parse the inline "comma-separated options" input into a clean option list:
 * split on commas, trim, drop blanks, dedupe (first-seen order). Forgiving —
 * "a, b, ,a ,c," → ["a","b","c"].
 */
export function parseFieldOptions(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (input ?? "").split(",")) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Serialize an option list back to the comma-entry string (for editing later). */
export function serializeFieldOptions(options: string[]): string {
  return options.join(", ");
}

/**
 * The options to show in a select field's dropdown: the def's options, plus the
 * current stored value appended if it is non-empty and not already listed — so a
 * value from a since-removed option still renders and stays selectable (AC11),
 * never silently dropped. Returns the def's options unchanged for a blank value.
 */
export function selectOptionsFor(def: ContactFieldDef, currentValue: string): string[] {
  const options = def.options ?? [];
  const value = (currentValue ?? "").trim();
  if (!value || options.includes(value)) return options;
  return [...options, value];
}
