import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Problem } from "./rules.ts";

// HV-14b (specs/harness-v3.md AC31, the "symbol" half): a rule that names a file
// and then a symbol in it, as two code spans side by side
// (`apps/app/src/lib/undo-toast.tsx` `UNDO_TOAST_MS`), fails `lint:rules` when
// the file no longer contains that symbol. rules.ts already fails a missing
// file; this catches the rename that leaves the file in place.

const FILE_SPAN = /^[\w@.-]+(?:\/[\w@.[\]-]+)+\.\w+$/;
const SYMBOL_SPAN = /^[A-Za-z_$][\w$]*$/;

export type SymbolRef = { line: number; file: string; symbol: string };

/** Each `path` `symbol` pair (two code spans with only spaces between), outside fenced blocks. */
export function findSymbolRefs(text: string): SymbolRef[] {
  const out: SymbolRef[] = [];
  let fenced = false;
  text.split("\n").forEach((raw, i) => {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    for (const m of raw.matchAll(/`([^`]+)`(?=\s+`([^`]+)`)/g)) {
      const file = (m[1] ?? "").replace(/:\d+$/, "");
      const symbol = m[2] ?? "";
      if (FILE_SPAN.test(file) && SYMBOL_SPAN.test(symbol)) out.push({ line: i + 1, file, symbol });
    }
  });
  return out;
}

/** Pairs whose file exists but doesn't contain the symbol as a whole word. */
export function deadSymbols(
  doc: string,
  text: string,
  read: (rel: string) => string | undefined,
): Problem[] {
  return findSymbolRefs(text).flatMap(({ line, file, symbol }) => {
    const body = read(file);
    // A missing file is rules.ts's finding (deadRefs); don't report it twice.
    if (body === undefined) return [];
    const word = new RegExp(`(^|[^\\w$])${symbol.replace(/\$/g, "\\$")}($|[^\\w$])`);
    return word.test(body)
      ? []
      : [{ file: doc, line, reason: `names \`${symbol}\` in \`${file}\`, which no longer has it` }];
  });
}

export const readFrom =
  (root: string) =>
  (rel: string): string | undefined => {
    const abs = path.join(root, rel);
    return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
  };
