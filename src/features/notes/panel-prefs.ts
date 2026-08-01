// Notes right-panel variant persistence (NO-7) — which switcher variant is
// active, remembered per user+workspace in localStorage (mirrors calendar's
// `readPanelVariant`/`writePanelVariant`). The "task" variant is transient
// (driven by a focused task line, not persisted), so it's excluded here.

export type NotesPanelVariantId = "detail" | "comments" | "outline";

const DEFAULT_VARIANT: NotesPanelVariantId = "detail";
const VALID: readonly NotesPanelVariantId[] = ["detail", "comments", "outline"];

function panelVariantKey(userId: string, workspaceId: string): string {
  return `moduo:notes:panel-variant:${userId}:${workspaceId}`;
}

export function readNotesPanelVariant(userId: string, workspaceId: string): NotesPanelVariantId {
  try {
    const raw = localStorage.getItem(panelVariantKey(userId, workspaceId));
    return VALID.includes(raw as NotesPanelVariantId)
      ? (raw as NotesPanelVariantId)
      : DEFAULT_VARIANT;
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
