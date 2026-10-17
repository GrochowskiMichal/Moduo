// Notes right-panel variant persistence (NO-7) — which switcher variant is
// active, remembered per user+workspace in localStorage (mirrors calendar's
// `readPanelVariant`/`writePanelVariant`). The "task" variant is transient
// (driven by a focused task line, not persisted), so it's excluded here.

import { z } from "zod";

export type NotesPanelVariantId = "detail" | "comments" | "outline";

const DEFAULT_VARIANT: NotesPanelVariantId = "detail";

function panelVariantKey(userId: string, workspaceId: string): string {
  return `moduo:notes:panel-variant:${userId}:${workspaceId}`;
}

const variantSchema = z.enum(["detail", "comments", "outline"]).catch(DEFAULT_VARIANT);

export function readNotesPanelVariant(userId: string, workspaceId: string): NotesPanelVariantId {
  try {
    const raw = localStorage.getItem(panelVariantKey(userId, workspaceId));
    return variantSchema.parse(raw ?? DEFAULT_VARIANT);
  } catch {
    return DEFAULT_VARIANT;
  }
}

export function writeNotesPanelVariant(
  userId: string,
  workspaceId: string,
  variant: NotesPanelVariantId,
): void {
  try {
    localStorage.setItem(panelVariantKey(userId, workspaceId), variant);
  } catch {
    // ignore — a lost panel preference is not worth surfacing
  }
}

// The refreshed shell (NR-2) opens with the right panel CLOSED: the first time
// someone uses it, it closes the Notes right panel once; after that the panel
// stays wherever they leave it (the shared per-feature panel state).
function nextPanelDefaultKey(userId: string): string {
  return `moduo:notes-next:panel-closed-default:v1:${userId}`;
}

/** True exactly once per user: the shell should close the right panel now. */
export function consumeNotesNextPanelDefault(userId: string): boolean {
  try {
    if (localStorage.getItem(nextPanelDefaultKey(userId)) === "done") return false;
    localStorage.setItem(nextPanelDefaultKey(userId), "done");
    return true;
  } catch {
    return false;
  }
}
