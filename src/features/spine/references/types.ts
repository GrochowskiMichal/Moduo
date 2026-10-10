// References (tasks-v3 §11, call 55, Assumptions #13): the shared primitive
// that shows a linked item anywhere, as a link, a chip, a card or a hover
// preview. These are the shapes the registry's resolvers hand the UI. A
// reference is only ever stored as `{type, id, display}`; everything here is
// worked out per reader, at read time, so nobody sees more than the item
// would show them.

/** How a reference reads: inline text, a pill with one live fact, or a card. */
export type ReferenceDisplay = "link" | "chip" | "card";

export const REFERENCE_DISPLAYS: readonly ReferenceDisplay[] = ["link", "chip", "card"];

export function isReferenceDisplay(value: unknown): value is ReferenceDisplay {
  return value === "link" || value === "chip" || value === "card";
}

/** The kinds the registry knows; `other` is any registry type without its own resolver. */
export type ReferenceKind =
  | "task"
  | "email"
  | "contact"
  | "company"
  | "note"
  | "event"
  | "project"
  | "tag"
  | "other";

/** A stored reference: a polymorphic `(type, id)`, never a title. */
export type ReferenceRef = { type: string; id: string };

/** How much a reader asked for: the chip's facts, or the card's (a superset). */
export type ReferenceLevel = "chip" | "card";

/** A task's status category: the icon is the category's, never edited (53a). */
export type TaskCategory = "backlog" | "todo" | "in_progress" | "done" | "wont_do";

/** A person on a reference (an assignee, a contact, a sender). */
export type ReferencePerson = { name: string; id: string | null; avatarUrl: string | null };

/** What leads a reference: a status icon, a person, a colour dot, or the type's icon. */
export type ReferenceLead =
  | { kind: "status"; category: TaskCategory }
  | { kind: "person"; person: ReferencePerson }
  | { kind: "dot"; color: string | null }
  | { kind: "icon"; type: string };

/** One fact on a card's meta line ("MOD-142", "Acme › Design", "Fri", "2/5"). */
export type ReferenceMeta = {
  key: string;
  text: string;
  /** A type glyph name for {@link resolveEntityIcon}, when the fact has an icon. */
  icon?: string | null;
  /** A late due date reads in the quiet late tone, never red (call 23). */
  tone?: "late" | null;
  /** A full sentence for the tooltip, when the text is short ("2 of 5 subtasks done"). */
  title?: string | null;
};

/** The card's key facts and its one action (55; research §6 table). */
export type ReferenceCard = {
  /** A line above the title: an email's sender and date. */
  overline?: { person: ReferencePerson | null; text: string; trailing: string | null } | null;
  /** Up to two lines under the title: an email's snippet, a note's excerpt. */
  excerpt?: string | null;
  meta: ReferenceMeta[];
  /** The person at the end of the meta line (a task's assignee). */
  person?: ReferencePerson | null;
  /** The card's one action. A task completes from its status circle. */
  action?: { kind: "complete"; done: boolean } | null;
};

/** What a reader may see of an item they can open. */
export type ReferenceFacts = {
  kind: ReferenceKind;
  title: string;
  lead: ReferenceLead;
  /** The chip's one live fact ("Fri" for a task's due date), or null. */
  fact: string | null;
  factTone?: "late" | null;
  /** A task's handle (`MOD-142`). */
  handle?: string | null;
  /** A task's project id (not shown): a project rename re-reads only its tasks. */
  bucketId?: string | null;
  /** The card's facts; null when only the chip level has loaded. */
  card: ReferenceCard | null;
};

/** One resolver answer for one id. */
export type ReferenceResolution =
  | { status: "ready"; facts: ReferenceFacts }
  /** The reader can't open it (or it doesn't exist): no title, no type, no preview. */
  | { status: "private" }
  /** It was deleted: "Deleted task", with no title. */
  | { status: "deleted" };

/** What a reference shows right now. */
export type ReferenceState =
  | { status: "loading" }
  | { status: "ready"; facts: ReferenceFacts }
  | { status: "private" }
  | { status: "deleted"; kind: ReferenceKind }
  | { status: "error" };
