import { describe, expect, it } from "@rstest/core";

import { deadSymbols, findSymbolRefs } from "./rule-symbols.ts";

// HV-14b (AC31): a rule naming a symbol in a file fails once the file loses it.
const files: Record<string, string> = {
  "apps/app/src/lib/undo-toast.tsx":
    "export const UNDO_TOAST_MS = 8000;\nexport function undoToast() {}",
  "apps/app/src/lib/sync/react.ts": "export function $readSnapshot() {}",
};
const read = (rel: string) => files[rel];

describe("rule symbols", () => {
  it("reads `path` `symbol` pairs, not lone spans or fenced code", () => {
    const text = [
      "- Use `apps/app/src/lib/undo-toast.tsx` `undoToast` for Undo.",
      "- `UNDO_TOAST_MS` alone is no pair; nor is `a.ts`, then `b`.",
      "```",
      "`apps/app/src/x.ts` `gone`",
      "```",
    ].join("\n");
    expect(findSymbolRefs(text)).toEqual([
      { line: 1, file: "apps/app/src/lib/undo-toast.tsx", symbol: "undoToast" },
    ]);
  });

  it("passes a symbol the file has, fails one it lost, leaves missing files to deadRefs", () => {
    const text = [
      "`apps/app/src/lib/undo-toast.tsx` `UNDO_TOAST_MS`",
      "`apps/app/src/lib/undo-toast.tsx` `undoToastLegacy`",
      "`apps/app/src/lib/sync/react.ts` `$readSnapshot`",
      "`apps/app/src/lib/gone.ts` `anything`",
    ].join("\n");
    expect(deadSymbols(".claude/rules/x.md", text, read)).toEqual([
      {
        file: ".claude/rules/x.md",
        line: 2,
        reason:
          "names `undoToastLegacy` in `apps/app/src/lib/undo-toast.tsx`, which no longer has it",
      },
    ]);
  });

  it("matches whole words only", () => {
    expect(deadSymbols("r.md", "`apps/app/src/lib/undo-toast.tsx` `undo`", read)).toHaveLength(1);
  });
});
