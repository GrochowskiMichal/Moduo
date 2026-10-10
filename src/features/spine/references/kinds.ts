// The registry's types as reference kinds, and the words a reference uses
// for them. The spine's entity types are open strings; a few have two names
// (an email is `email_thread` in the registry and `email` in older links; a
// project is a `bucket` in the database).

import type { ReferenceKind, ReferenceRef } from "./types";

const KIND_BY_TYPE: Record<string, ReferenceKind> = {
  task: "task",
  email: "email",
  email_thread: "email",
  contact: "contact",
  company: "company",
  note: "note",
  event: "event",
  project: "project",
  bucket: "project",
  task_project: "project",
  tag: "tag",
};

/** The reference kind for an entity type; anything unknown is `other`. */
export function referenceKind(type: string): ReferenceKind {
  return KIND_BY_TYPE[type] ?? "other";
}

/** The stable cache key of a reference: its kind and id (`email_thread:x` = `email:x`). */
export function referenceKey(ref: ReferenceRef): string {
  const kind = referenceKind(ref.type);
  return `${kind === "other" ? ref.type : kind}:${ref.id}`;
}

const NOUN: Record<ReferenceKind, string> = {
  task: "task",
  email: "email",
  contact: "contact",
  company: "company",
  note: "note",
  event: "event",
  project: "project",
  tag: "tag",
  other: "item",
};

/** The word for one of these: "task", "email", "item". */
export function referenceNoun(kind: ReferenceKind): string {
  return NOUN[kind];
}

/** A deleted item's whole label: "Deleted task", "Deleted note" (no title, call 55). */
export function deletedLabel(kind: ReferenceKind): string {
  return `Deleted ${NOUN[kind]}`;
}

/** What an item you can't open reads as, everywhere (no title, no type). */
export const PRIVATE_ITEM_LABEL = "Private item";

/** Where an "Open in …" action goes, for the panel's open-full button. */
export function openInLabel(kind: ReferenceKind): string | null {
  switch (kind) {
    case "task":
    case "project":
      return "Open in Tasks";
    case "email":
      return "Open in Email";
    case "contact":
    case "company":
      return "Open in Contacts";
    case "note":
      return "Open in Notes";
    case "event":
      return "Open in Calendar";
    default:
      return null;
  }
}

/** The kinds that can show as a card (a tag is only ever a link). */
export function canShowAsCard(kind: ReferenceKind): boolean {
  return kind !== "tag" && kind !== "other";
}
