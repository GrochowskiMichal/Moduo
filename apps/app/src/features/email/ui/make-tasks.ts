// `t` on a selection (specs/mail-v3.md §6, AC20): one task per picked thread,
// one toast, one Undo that removes them all.

import { toast } from "sonner";

import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";
import { undoToast } from "@/lib/undo-toast";

import { convertEach } from "../commands/convert-many";
import type { MailSpineCommands } from "../commands/spine";

export async function makeTasks(
  spine: Pick<MailSpineCommands, "convert">,
  threadIds: readonly string[],
  rowOf: (threadId: string) => Promise<MailThreadRow | null>,
): Promise<void> {
  const rows = (await Promise.all(threadIds.map(rowOf))).filter((r) => r !== null);
  if (rows.length === 0) return;
  try {
    const res = await convertEach(spine, rows);
    undoToast(res.count === 1 ? "Task created" : `${res.count} tasks created`, {
      onUndo: () => void res.undo(),
    });
  } catch (e) {
    toast.error(
      e instanceof Error && e.message ? e.message : "That didn't go through. Nothing was changed.",
    );
  }
}
