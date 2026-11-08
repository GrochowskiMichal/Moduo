// Middle truncation (specs/mail-improve.md §4, §5): a long attachment name or a failed
// action's subject keeps its end ("…v3.2 final.pdf") visible. The head truncates with
// one ellipsis in CSS; the tail never does, so the layout decides how much head fits.

/** Splits `name` into a head (truncates) and a tail (kept): the extension plus the last
 *  `keep` characters of the stem, or the last `keep` characters with no extension. */
export function middleParts(name: string, keep = 9): { head: string; tail: string } {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : "";
  const stem = ext ? name.slice(0, dot) : name;
  const cut = Math.max(0, stem.length - keep);
  return { head: stem.slice(0, cut), tail: stem.slice(cut) + ext };
}
