// The workspaces you had, kept on this device so the app can open offline
// (TV-D11a, default g): with no network at launch the workspace list can't be
// read, and without a selected workspace nothing else opens, not even the
// Tasks device copy. One person's list only (a different person never reads
// it), forgotten on sign-out. Names, roles and module access — never a token.

import type { WorkspaceSummary } from "./types";

const KEY = "moduo:workspaces-on-device";

type Remembered = { userId: string; list: WorkspaceSummary[] };

export function rememberWorkspaces(userId: string, list: WorkspaceSummary[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ userId, list } satisfies Remembered));
  } catch {
    // Storage full or blocked: opening offline just won't have it.
  }
}

/** This person's remembered list, or null (none, or someone else's). */
export function rememberedWorkspaces(userId: string): WorkspaceSummary[] | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Remembered>;
    if (parsed.userId !== userId || !Array.isArray(parsed.list)) return null;
    return parsed.list;
  } catch {
    return null;
  }
}

export function forgetRememberedWorkspaces(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
