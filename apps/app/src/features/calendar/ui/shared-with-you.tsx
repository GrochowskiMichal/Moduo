// Shared with you and Preview as… in the calendars panel (CALR-16, AC29, AC30):
// each teammate who shares with you, at their level, off until you turn them
// on (remembered per user and workspace); and a menu to see your week as one
// of your teammates sees it.

import { useEffect } from "react";

import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Switch } from "../../../components/ui/switch";
import { useWorkspace } from "../../workspaces/workspace-context";
import { toggleTeammate } from "../teammates";
import { setTeammates, useTeammatesStore } from "./teammates-store";

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

export function SharedWithYou({ userId, workspaceId }: { userId: string; workspaceId: string }) {
  const teammates = useTeammatesStore((s) => s.teammates);
  const shown = useTeammatesStore((s) => s.shown);
  const { selectedWorkspace } = useWorkspace();
  if (teammates.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 border-t border-border pt-3">
      <p className="px-1 text-xs text-muted-foreground">
        Shared with you · {selectedWorkspace?.name ?? "this workspace"} · view only
      </p>
      {teammates.map((t) => (
        <label key={t.userId} className="flex items-center gap-2 px-1 text-sm">
          <span className="min-w-0 flex-1 truncate text-foreground">{t.name}</span>
          <span className="text-xs text-muted-foreground">
            {t.level === "view" ? "All details" : "Busy only"}
          </span>
          <Switch
            checked={shown.includes(t.userId)}
            onCheckedChange={() =>
              saveShownTeammates(userId, workspaceId, toggleTeammate(shown, t.userId))
            }
            aria-label={`Show ${t.name} beside your week`}
          />
        </label>
      ))}
    </div>
  );
}

/** "Preview as…": your week as one of the workspace's active members sees it. */
export function PreviewAsMenu({ userId }: { userId: string }) {
  const { members } = useWorkspace();
  const people = members.filter((m) => m.isActive && !m.removedAt && m.userId !== userId);
  if (people.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="justify-start">
          Preview as…
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {people.map((m) => (
          <DropdownMenuItem key={m.userId} onSelect={() => setTeammates({ previewAs: m.userId })}>
            {m.displayName || "Teammate"}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The calendars panel's side of Preview as: publish your calendars (the
 * banner names them) and open Your calendar's share menu on "Change what … sees".
 */
export function usePreviewBridge(
  rows: { id: string; name: string; kind: string; owner_id: string }[],
  userId: string,
  openShare: (id: string) => void,
): void {
  useEffect(() => {
    setTeammates({
      myCalendars: rows
        .filter((r) => r.owner_id === userId)
        .map((r) => ({ id: r.id, name: r.name, main: r.kind === "moduo" })),
    });
  }, [rows, userId]);
  const shareOpen = useTeammatesStore((s) => s.shareOpen);
  useEffect(() => {
    if (!shareOpen) return;
    openShare(shareOpen);
    setTeammates({ shareOpen: null });
  }, [shareOpen, openShare]);
}
