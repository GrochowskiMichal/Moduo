/**
 * Note outline (NO-7, AC8) — the headings TOC for the Outline rail variant,
 * derived from the note's markdown (the live doc's `deriveBody(...).md`). Each
 * `#`..`######` line becomes a TOC entry. Pure + testable; the panel renders
 * the list and a click scrolls the editor to the matching heading.
 */

export type OutlineHeading = {
  level: number; // 1..6
  text: string;
  /** 1-based ordinal among ALL headings — a stable scroll key even when two
   * headings share the same text. */
  index: number;
};

/** Extract headings from markdown, ignoring `#` inside fenced code blocks. */
export function extractOutline(md: string): OutlineHeading[] {
  const out: OutlineHeading[] = [];
  let inFence = false;
  let index = 0;
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (!m) continue;
    index += 1;
    out.push({ level: m[1].length, text: m[2].trim(), index });
  }
  return out;
}
