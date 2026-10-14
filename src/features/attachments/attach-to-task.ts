// Files dropped on a task where no strip shows (a List row, a Board card;
// AT-3, AT3-1): queue them for the task and say in one quiet toast what
// happens, since the tiles that would show progress and problems live in the
// task's panel. Problems are facts with one way forward, never red (AT2-4).

import { toast } from "sonner";
import { getRuntime } from "@/lib/runtime";
import { getUploadQueue } from "@/lib/uploads";
import {
  describeProblem,
  describeTooLarge,
  type ProblemCopy,
  type UploadProblem,
} from "@/lib/uploads/errors";
import type { UploadView } from "@/lib/uploads/queue";
import { dispatchOpenSettings } from "../settings/settings-events";

/**
 * What one drop's files came to: the line to show, whether the pool is full,
 * and whether to offer Upgrade (only the pool's owner, when a bigger plan
 * would take the files, the way the task's strip offers it).
 */
export function dropSummary(
  items: readonly Pick<UploadView, "fileName" | "sizeBytes" | "state" | "problem">[],
  title: string,
  isOwner = false,
): { text: string; description: string | null; full: boolean; upgrade: boolean } | null {
  if (items.length === 0) return null;
  const on = `on “${title.trim() || "Untitled"}”`;
  const refused = items.filter((i) => i.state === "rejected" && i.problem);
  const going = items.filter((i) => i.state !== "rejected");
  const full = going.find((i) => i.problem?.kind === "storage_full");
  const offers = (copy: ProblemCopy | null) => !!copy?.actions.includes("upgrade");
  if (full?.problem) {
    const copy = describeProblem(full.problem, { fileName: full.fileName, isOwner });
    return { text: copy.text, description: on, full: true, upgrade: offers(copy) };
  }
  const refusedCopy = ((): ProblemCopy | null => {
    if (refused.length === 0) return null;
    const tooBig = refused.filter((i) => i.problem?.kind === "too_large");
    const first = tooBig[0]?.problem as Extract<UploadProblem, { kind: "too_large" }> | undefined;
    if (first && tooBig.length === refused.length) {
      return describeTooLarge(
        tooBig.map((i) => ({ fileName: i.fileName, sizeBytes: i.sizeBytes })),
        { perFileBytes: first.perFileBytes, tier: first.tier, isOwner },
      );
    }
    const one = refused[0];
    return one?.problem ? describeProblem(one.problem, { fileName: one.fileName, isOwner }) : null;
  })();
  const refusedLine = refusedCopy?.text ?? null;
  const upgrade = offers(refusedCopy);
  if (going.length === 0)
    return { text: refusedLine ?? "Not attached", description: on, full: false, upgrade };
  const what = going.length === 1 ? (going[0]?.fileName ?? "1 file") : `${going.length} files`;
  return {
    text: `Attaching ${what}`,
    description: refusedLine ? `${on} · ${refusedLine}` : on,
    full: false,
    upgrade,
  };
}

/** Queue files for a task from a row or card drop, and say so. */
export async function attachFilesToTask({
  workspaceId,
  taskId,
  title,
  files,
  userId,
  onOpen,
  awaitTask = false,
}: {
  workspaceId: string;
  taskId: string;
  title: string;
  files: File[];
  userId: string;
  /** Opens the task (its strip shows the uploads). */
  onOpen?: () => void;
  /** The task waits on this device to sync (made offline): its files wait with it. */
  awaitTask?: boolean;
}): Promise<void> {
  if (files.length === 0) return;
  const queue = getUploadQueue();
  // The pool, read once here: the queue weighs the files against it, and the
  // toast knows whether you own it (only the owner is offered Upgrade).
  const api = getRuntime()?.attachments;
  const pool = api ? await api.status(workspaceId).catch(() => null) : null;
  let ids: string[];
  try {
    ids = await queue.add(
      files,
      { workspaceId, entityType: "task", entityId: taskId },
      userId,
      // Unread (offline, an older server): the queue tries itself.
      pool ?? undefined,
      { awaitTask },
    );
  } catch {
    toast("Couldn't add the files", { description: "Try again from the task." });
    return;
  }
  const items = queue.getSnapshot().items.filter((i) => ids.includes(i.id));
  const summary = dropSummary(items, title, pool?.isOwner ?? false);
  if (!summary) return;
  toast(summary.text, {
    ...(summary.description ? { description: summary.description } : {}),
    action: summary.full
      ? { label: "Free up space", onClick: () => dispatchOpenSettings({ section: "storage" }) }
      : onOpen
        ? { label: "Open", onClick: onOpen }
        : undefined,
    ...(summary.upgrade
      ? {
          cancel: { label: "Upgrade", onClick: () => dispatchOpenSettings({ section: "billing" }) },
        }
      : {}),
  });
  // The toast said why: refused files don't linger as tiles on the task.
  for (const item of items) if (item.state === "rejected") queue.dismiss(item.id);
}
