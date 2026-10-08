/**
 * Reads the hand-drawn masters in brand/masters/. A master is a flat SVG:
 * a viewBox and one or more filled <path> elements, nothing else. That keeps
 * recolouring exact (every export just swaps the fill) and makes a design-tool
 * export that smuggles in transforms, clips or strokes fail loudly instead of
 * rendering subtly wrong. See brand/README.md for how to export one.
 */

export type MasterPath = { d: string; fillRule: "evenodd" | "nonzero" };

export type Master = {
  name: string;
  /** [minX, minY, width, height] */
  viewBox: [number, number, number, number];
  paths: MasterPath[];
};

const FORBIDDEN: [RegExp, string][] = [
  [/\btransform\s*=/i, "a transform (flatten the artwork first)"],
  [/<use\b/i, "a <use> reference"],
  [/<clipPath\b|\bclip-path\s*=/i, "a clip path (turn off 'Clip content' on the frame)"],
  [/<mask\b|\bmask\s*=/i, "a mask"],
  [/<image\b/i, "an embedded image"],
  [/<text\b/i, "live text (outline the letters)"],
  [/<(linear|radial)Gradient\b/i, "a gradient"],
  [/<filter\b|\bfilter\s*=/i, "a filter"],
  [/<style\b|\bstyle\s*=/i, "inline CSS"],
  [/\bstroke\s*=\s*["'](?!none["'])/i, "a stroke (outline strokes first)"],
  [/\bfill\s*=\s*["']none["']/i, "an unfilled path (delete invisible guides)"],
  [/\b(?:fill-)?opacity\s*=\s*["'](?!1(?:\.0*)?["'])/i, "transparency (masters are solid)"],
  [/<(rect|circle|ellipse|polygon|polyline|line)\b/i, "a non-path shape (convert to outlines)"],
];

/** An attribute's value, single- or double-quoted. */
function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, "is"))?.[2];
}

export function parseMaster(name: string, svg: string): Master {
  const root = svg.match(/<svg\b[^>]*>/i)?.[0];
  // Check what's inside the root, not the root itself: design tools put
  // presentation defaults there (Figma always writes fill="none" on it).
  const body = root ? svg.replace(root, "") : svg;
  for (const [pattern, what] of FORBIDDEN) {
    if (pattern.test(body)) {
      throw new Error(
        `brand/masters/${name}: contains ${what}. Masters must be flat filled paths.`,
      );
    }
  }
  const viewBoxRaw = root ? attr(root, "viewBox") : undefined;
  if (!viewBoxRaw) throw new Error(`brand/masters/${name}: missing viewBox on <svg>.`);
  const box = viewBoxRaw
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box.length !== 4 || box.some((n) => !Number.isFinite(n)) || box[2] <= 0 || box[3] <= 0) {
    throw new Error(
      `brand/masters/${name}: viewBox "${viewBoxRaw}" is not four numbers with a positive size.`,
    );
  }
  const paths: MasterPath[] = [];
  for (const [tag] of svg.matchAll(/<path\b[^>]*>/gi)) {
    const d = attr(tag, "d");
    if (!d) throw new Error(`brand/masters/${name}: a <path> has no d attribute.`);
    const rule = attr(tag, "fill-rule");
    // SVG's own default is nonzero; keep whatever the design tool wrote.
    // Collapse whitespace: some tools wrap long path data across lines, which
    // would break the generated TS string literal.
    const data = d.replace(/\s+/g, " ").trim();
    paths.push({ d: data, fillRule: rule === "evenodd" ? "evenodd" : "nonzero" });
  }
  if (paths.length === 0) throw new Error(`brand/masters/${name}: no <path> found.`);
  return { name, viewBox: box as Master["viewBox"], paths };
}
