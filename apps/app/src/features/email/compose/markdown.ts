// Markdown shortcuts in the compose body (AC23): typed at the start of a line,
// `- `/`* ` start a bullet list, `1. ` a numbered list, `> ` a quote and `# ` a
// heading; inline `**bold**`, `_italic_` and `` `code` `` format when closed.

export type BlockShortcut = "ul" | "ol" | "quote" | "h2";

export function blockShortcut(lineBeforeCaret: string): BlockShortcut | null {
  if (/^[-*] $/.test(lineBeforeCaret)) return "ul";
  if (/^1[.)] $/.test(lineBeforeCaret)) return "ol";
  if (/^> $/.test(lineBeforeCaret)) return "quote";
  if (/^#{1,3} $/.test(lineBeforeCaret)) return "h2";
  return null;
}

export type InlineShortcut = { format: "bold" | "italic" | "code"; text: string; length: number };

/** The closed inline mark that ends right at the caret, if any. */
export function inlineShortcut(textBeforeCaret: string): InlineShortcut | null {
  const rules: [RegExp, InlineShortcut["format"]][] = [
    [/\*\*([^*\n]+)\*\*$/, "bold"],
    [/(?:^|\s)_([^_\n]+)_$/, "italic"],
    [/`([^`\n]+)`$/, "code"],
  ];
  for (const [re, format] of rules) {
    const m = textBeforeCaret.match(re);
    if (m) {
      const length = m[0].trimStart().length;
      return { format, text: m[1], length };
    }
  }
  return null;
}
