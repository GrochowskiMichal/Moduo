/**
 * First-line-title extraction (Wave-3 NO-3, AC1). The doc's first line IS the
 * title — there is no separate title field. The editor derives the body text
 * on a debounce and this maps it to the stored/registry title.
 */

export const TITLE_DEBOUNCE_MS = 500;
export const TITLE_MAX_LENGTH = 200;

/** The first line of the derived body text, whitespace-collapsed and capped.
 * An empty doc (or an empty first line) titles as "" — display surfaces
 * render the fallback, storage keeps the honest empty string. */
export function firstLineTitle(bodyText: string): string {
  const firstLine = bodyText.split(/\r?\n/, 1)[0] ?? "";
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  return collapsed.length > TITLE_MAX_LENGTH
    ? collapsed.slice(0, TITLE_MAX_LENGTH).trimEnd()
    : collapsed;
}

export function displayTitle(title: string): string {
  return title.trim() === "" ? "Untitled" : title;
}
