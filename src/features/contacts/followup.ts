// "Add follow-up" — the one CRM action (block CO-4, specs/contacts.md AC4).
// A follow-up is an ORDINARY task (created via the existing Tasks path) linked
// back to the contact with relation_kind 'follow-up' — never a new "deal" object
// (a deal is just a task/note linked to a contact). This is the pure builder; the
// page performs the two writes (tasks.upsertTask + contacts.link) optimistically.

import type { EntityRef } from "../../lib/entity-links";
import { endPosition, makeTask } from "../tasks/helpers";
import type { Task } from "../tasks/model";

export type BuildFollowupInput = {
  workspaceId: string;
  /** The bucket the follow-up lands in (the reserved Inbox). */
  bucketId: string;
  contactName: string;
  /** Optional due date (YYYY-MM-DD). */
  dueDate?: string | null;
};

/** "Follow up with Dana Lee" — or a bare "Follow up" for a nameless contact. */
export function followupTitle(contactName: string): string {
  const n = contactName.trim();
  return n ? `Follow up with ${n}` : "Follow up";
}

/**
 * Build the plain Task for a follow-up. The runtime mints the id and the server
 * records the creator on create (makeTask leaves both empty, and the assignee
 * unchosen = the creator); status is the ordinary "todo".
 */
export function buildFollowupTask(input: BuildFollowupInput): Task {
  return makeTask({
    workspaceId: input.workspaceId,
    bucketId: input.bucketId,
    title: followupTitle(input.contactName),
    position: endPosition([]),
    dueDate: input.dueDate ?? null,
  });
}

/** The contacts.link args that attach a follow-up task to its contact (AC4). */
export function followupLinkArgs(
  contact: EntityRef,
  taskId: string,
): { contact: EntityRef; target: EntityRef; relationKind: "follow-up"; origin: "manual" } {
  return {
    contact,
    target: { type: "task", id: taskId },
    relationKind: "follow-up",
    origin: "manual",
  };
}
