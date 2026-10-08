/**
 * Task lines — the pure half (Wave-3 NO-5, AC3). Mint/link argument builders,
 * the `/task` picker's candidate shaping, and the title-sync mapper. The
 * editor plugin and page execute these; keeping them runtime-free makes the
 * mint/link contract unit-testable (task-line.test.ts).
 *
 * Contract (DESIGN_BRIEF §3b): minted tasks land in the Tasks INBOX with no
 * due date, back-linked to the note — minted = `spawned-from`, linking an
 * existing task = `references`. VALUE imports stay relative (vitest gotcha).
 */

import type { EntityRef, LinkOrigin, RelationKind } from "../../../lib/entity-links";
import type { NewTaskFields } from "../../tasks/helpers";
import type { Task } from "../../tasks/model";

/** Fields for minting a note-born task: Inbox bucket, todo, nothing scheduled. */
export function buildMintTaskFields(input: {
  workspaceId: string;
  inboxBucketId: string;
  title: string;
  position: string;
}): NewTaskFields {
  return {
    workspaceId: input.workspaceId,
    bucketId: input.inboxBucketId,
    title: input.title.trim() || "Untitled task",
    position: input.position,
    dueDate: null,
    scheduledAt: null,
  };
}

export type TaskLinkInput = {
  workspaceId: string;
  source: EntityRef;
  target: EntityRef;
  relationKind: RelationKind;
  origin: LinkOrigin;
  sourceLabel?: string;
  targetLabel?: string;
  sourceIcon?: string | null;
};

/** The note→task back-link for a task line. Minted = `spawned-from`; linking
 * an existing task = `references` (spec assumption 6). */
export function buildTaskLineLink(input: {
  workspaceId: string;
  note: EntityRef;
  noteLabel: string;
  taskId: string;
  taskTitle: string;
  minted: boolean;
  origin?: LinkOrigin;
}): TaskLinkInput {
  return {
    workspaceId: input.workspaceId,
    source: input.note,
    target: { type: "task", id: input.taskId },
    relationKind: input.minted ? "spawned-from" : "references",
    origin: input.origin ?? "ref",
    sourceLabel: input.noteLabel,
    targetLabel: input.taskTitle,
    sourceIcon: "note",
  };
}

/**
 * Title-sync mapper (note line → task): a minimal `{ title }` patch — renames,
 * never clobbers other fields. Returns null when there is nothing to write
 * (unchanged, or the line emptied out — an empty title never overwrites).
 */
export function applyTaskRename(
  task: Pick<Task, "title">,
  lineText: string,
): { title: string } | null {
  const title = lineText.trim();
  if (title === "" || title === task.title) return null;
  return { title };
}

/** A task is offerable in the `/task` picker while it's still open work. */
export function isLinkableTask(task: Task): boolean {
  return task.deletedAt === null && task.status !== "done" && task.status !== "archived";
}

/**
 * The `/task` picker's fuzzy candidates over the loaded tasks bundle
 * (client-side — the registry only knows tasks that were already linked).
 * Empty query → most recently touched first.
 */
export function filterTaskCandidates(tasks: Task[], query: string, limit = 8): Task[] {
  const q = query.trim().toLowerCase();
  const linkable = tasks.filter(isLinkableTask);
  const matches = q === "" ? linkable : linkable.filter((t) => t.title.toLowerCase().includes(q));
  return matches.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, limit);
}

/** Offer "Create task '<text>'" as the top row unless an existing task
 * already matches the typed text exactly (DESIGN_BRIEF §3b). */
export function shouldOfferCreate(query: string, candidates: Task[]): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return false;
  return !candidates.some((t) => t.title.trim().toLowerCase() === q);
}
