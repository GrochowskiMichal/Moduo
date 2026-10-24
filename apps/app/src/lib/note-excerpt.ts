/**
 * A note's text cut to about two card lines for a reference card or a linked
 * row (whole words, no trailing space). The first line is the note's title,
 * which the card already shows, so it is left out; blocks read as " · "
 * separated, never run together ("Decisions Notes ships…").
 */
export function noteExcerpt(text: string | null, title?: string | null): string | null {
  const lines = (text ?? "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (lines.length > 0 && title && lines[0] === title.replace(/\s+/g, " ").trim()) lines.shift();
  const flat = lines.join(" · ");
  if (!flat) return null;
  if (flat.length <= 240) return flat;
  const cut = flat.slice(0, 240);
  const space = cut.lastIndexOf(" ");
  return `${(space > 160 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
