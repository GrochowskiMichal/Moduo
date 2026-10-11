// The one Task capture draft (research §1.8): Esc, a click outside or another
// overlay closes the capture but keeps what was typed on the device; the next
// ⌘⇧K (or ⌘N) restores it ("Draft restored · Clear"). Create clears it.
// Per workspace, in localStorage; a private window without storage just
// doesn't keep drafts.

import type { PriorityLevel, RecurrenceRule } from "../model";
import type { TitleSegment } from "../parse/capture-tokens";

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

const key = (workspaceId: string) => `moduo:capture-draft:task:${workspaceId}`;

/** Does a draft hold anything worth restoring? */
export function draftHasContent(draft: CaptureDraft): boolean {
  const titled = draft.segments.some((s) => ("text" in s ? s.text.trim() !== "" : true));
  return titled || draft.description.trim() !== "" || draft.subtasks.some((s) => s.trim() !== "");
}

export function loadDraft(workspaceId: string | null): CaptureDraft | null {
  if (!workspaceId) return null;
  try {
    const raw = window.localStorage.getItem(key(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CaptureDraft>;
    if (!Array.isArray(parsed.segments)) return null;
    return {
      segments: parsed.segments,
      keep: Array.isArray(parsed.keep) ? parsed.keep : [],
      description: typeof parsed.description === "string" ? parsed.description : "",
      subtasks: Array.isArray(parsed.subtasks) ? parsed.subtasks : [],
      fields: { ...EMPTY_FIELDS, ...(parsed.fields ?? {}) },
    };
  } catch {
    return null;
  }
}

export function saveDraft(workspaceId: string | null, draft: CaptureDraft): void {
  if (!workspaceId) return;
  try {
    if (draftHasContent(draft))
      window.localStorage.setItem(key(workspaceId), JSON.stringify(draft));
    else window.localStorage.removeItem(key(workspaceId));
  } catch {
    // No storage (a private window): the draft lives as long as the capture.
  }
}

export function clearDraft(workspaceId: string | null): void {
  if (!workspaceId) return;
  try {
    window.localStorage.removeItem(key(workspaceId));
  } catch {
    // Nothing to clear.
  }
}
