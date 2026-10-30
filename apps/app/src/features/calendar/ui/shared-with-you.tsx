// Workspace members who share with you, off until you turn them on in the
// rail (remembered per user and workspace; CALR-16, AC29, AC30).

import { setTeammates } from "./teammates-store";

const shownKey = (userId: string, workspaceId: string) =>
  `moduo:calendar:teammates-shown:${userId}:${workspaceId}`;

export function readShownTeammates(userId: string, workspaceId: string): string[] {
  try {
    const raw: unknown = JSON.parse(
      window.localStorage.getItem(shownKey(userId, workspaceId)) ?? "[]",
    );
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveShownTeammates(userId: string, workspaceId: string, shown: string[]): void {
  setTeammates({ shown });
  try {
    window.localStorage.setItem(shownKey(userId, workspaceId), JSON.stringify(shown));
  } catch {
    /* storage disabled: the choice lasts this session */
  }
}
