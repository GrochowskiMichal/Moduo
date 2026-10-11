// The one Task capture draft (research §1.8): Esc, a click outside or another
// overlay closes the capture but keeps what was typed on the device; the next
// ⌘⇧K (or ⌘N) restores it ("Draft restored · Clear"). Create clears it.
//
// Kept per person AND workspace, so a second person on this device, or the
// same person in another workspace, never sees it; every draft goes when
// someone signs out on this device, and a deleted account's go with it.
// What's kept is the person's own words and ids only: no name or title of a
// linked item, person, team or tag (they're looked up again when the draft
// comes back, so an item the person can no longer open reads "Private item"),
// and never the "From:" item, files, or anything else. A private window
// without storage just doesn't keep drafts.

import type { PriorityLevel, RecurrenceRule } from "../model";
import type { CaptureToken, TitleSegment } from "../parse/capture-tokens";

/** What a hand pick set (tokens live in the title). */
export type DraftFields = {
  /** Undefined: you. Null: Unassigned. */
  assigneeId?: string | null;
  teamId?: string | null;
  dueDay?: string | null;
  scheduledAt?: string | null;
  recurrence?: RecurrenceRule | null;
  priority?: PriorityLevel | null;
  estimateMinutes?: number | null;
  remindAt?: string | null;
  tags: Array<{ id: string; name: string; color?: string | null }>;
  waitingOn: string[];
};

export type CaptureDraft = {
  segments: TitleSegment[];
  /** Date phrases kept as words. */
  keep: string[];
  description: string;
  subtasks: string[];
  fields: DraftFields;
};

export const EMPTY_FIELDS: DraftFields = { tags: [], waitingOn: [] };

export const EMPTY_DRAFT: CaptureDraft = {
  segments: [],
  keep: [],
  description: "",
  subtasks: [],
  fields: EMPTY_FIELDS,
};

const PREFIX = "moduo:capture-draft:task:";
const key = (userId: string, workspaceId: string) => `${PREFIX}${userId}:${workspaceId}`;

/** Does a draft hold anything worth restoring? */
export function draftHasContent(draft: CaptureDraft): boolean {
  const titled = draft.segments.some((s) => ("text" in s ? s.text.trim() !== "" : true));
  return titled || draft.description.trim() !== "" || draft.subtasks.some((s) => s.trim() !== "");
}

/**
 * A token as the device keeps it: ids, never the name it was shown with
 * (a linked item's title, a person's or team's name, a tag's). A new tag
 * keeps its name: it's the person's own word, and nothing else knows it.
 */
export function storableToken(token: CaptureToken): CaptureToken {
  switch (token.kind) {
    case "person":
      return { kind: "person", userId: token.userId, label: "" };
    case "team":
      return { kind: "team", teamId: token.teamId, label: "", letters: null };
    case "tag":
      return token.tagId
        ? { kind: "tag", tagId: token.tagId, label: "", color: null }
        : { kind: "tag", tagId: null, label: token.label, color: null };
    case "thing":
      return { kind: "thing", ref: { type: token.ref.type, id: token.ref.id }, label: "" };
    default:
      // Dates, priority, estimate, reminder, repeat: the person's own settings.
      return token;
  }
}

/** The draft as the device keeps it (see `storableToken`). */
export function storableDraft(draft: CaptureDraft): CaptureDraft {
  return {
    segments: draft.segments.map((s) =>
      "text" in s ? { text: s.text } : { token: storableToken(s.token) },
    ),
    keep: draft.keep,
    description: draft.description,
    subtasks: draft.subtasks,
    fields: {
      ...draft.fields,
      tags: draft.fields.tags.map((t) => ({ id: t.id, name: "" })),
    },
  };
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadDraft(userId: string | null, workspaceId: string | null): CaptureDraft | null {
  if (!userId || !workspaceId) return null;
  try {
    const raw = storage()?.getItem(key(userId, workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CaptureDraft>;
    if (!Array.isArray(parsed.segments)) return null;
    return storableDraft({
      segments: parsed.segments,
      keep: Array.isArray(parsed.keep) ? parsed.keep : [],
      description: typeof parsed.description === "string" ? parsed.description : "",
      subtasks: Array.isArray(parsed.subtasks) ? parsed.subtasks : [],
      fields: {
        ...EMPTY_FIELDS,
        ...(parsed.fields ?? {}),
        tags: Array.isArray(parsed.fields?.tags) ? parsed.fields.tags : [],
        waitingOn: Array.isArray(parsed.fields?.waitingOn) ? parsed.fields.waitingOn : [],
      },
    });
  } catch {
    return null;
  }
}

export function saveDraft(
  userId: string | null,
  workspaceId: string | null,
  draft: CaptureDraft,
): void {
  if (!userId || !workspaceId) return;
  try {
    const store = storage();
    if (!store) return;
    if (draftHasContent(draft)) {
      store.setItem(key(userId, workspaceId), JSON.stringify(storableDraft(draft)));
    } else store.removeItem(key(userId, workspaceId));
  } catch {
    // No storage (a private window): the draft lives as long as the capture.
  }
}

export function clearDraft(userId: string | null, workspaceId: string | null): void {
  if (!userId || !workspaceId) return;
  try {
    storage()?.removeItem(key(userId, workspaceId));
  } catch {
    // Nothing to clear.
  }
}

/** Keep only this person's drafts on the device (someone else signed in). */
export function keepCaptureDraftsOf(userId: string): void {
  const store = storage();
  if (!store) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(PREFIX) && !k.startsWith(`${PREFIX}${userId}:`)) doomed.push(k);
    }
    for (const k of doomed) store.removeItem(k);
  } catch {
    // Nothing kept.
  }
}

/**
 * Forget kept capture drafts on this device: one person's (their account was
 * deleted), or everyone's (someone signed out).
 */
export function forgetCaptureDrafts(userId?: string | null): void {
  const store = storage();
  if (!store) return;
  const prefix = userId ? `${PREFIX}${userId}:` : PREFIX;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(prefix)) doomed.push(k);
    }
    for (const k of doomed) store.removeItem(k);
  } catch {
    // Nothing kept.
  }
}
