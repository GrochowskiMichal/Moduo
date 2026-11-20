// `t` on a selection (specs/mail-v3.md §6, AC20): one task per thread, as one
// step with one undo. All or nothing: when one convert fails, the tasks already
// made are removed again and the error surfaces, so nothing half-happens.

import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import type { MailSpineCommands, SpineResult } from "./spine";

export type ConvertManyResult = { count: number; undo: () => Promise<void> };

export async function convertEach(
  spine: Pick<MailSpineCommands, "convert">,
  rows: readonly MailThreadRow[],
): Promise<ConvertManyResult> {
  const made: SpineResult[] = [];
  const undoAll = async () => {
    for (const r of [...made].reverse()) await r.undo().catch(() => {});
  };
  try {
    for (const row of rows) made.push(await spine.convert(row));
  } catch (err) {
    await undoAll();
    throw err;
  }
  let undone = false;
  return {
    count: made.length,
    undo: async () => {
      if (undone) return;
      undone = true;
      await undoAll();
    },
  };
}
