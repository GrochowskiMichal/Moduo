// The people a comment surface knows: who can be @mentioned (active members
// other than me) and how an author's name reads (any member the workspace still
// lists, so a former member's old comments keep their name while it does).
// From the workspace's member list, already loaded; no request per keystroke.

import { useMemo } from "react";

import { useAuth } from "@/providers/auth-provider";
import { useWorkspace } from "../../workspaces/workspace-context";
import type { CommentPerson } from "../comments";

export function useCommentPeople(): {
  currentUserId: string | null;
  /** Active members other than me, by name. */
  mentionable: CommentPerson[];
  /** Every listed member's name: what reads as a mention in a comment body. */
  names: string[];
  nameOf: (userId: string) => string | null;
  personOf: (userId: string) => CommentPerson | null;
} {
  const { members } = useWorkspace();
  const { userId } = useAuth();
  return useMemo(() => {
    const byId = new Map<string, CommentPerson & { active: boolean }>();
    for (const m of members) {
      byId.set(m.userId, {
        id: m.userId,
        name: m.displayName?.trim() || "Member",
        avatarUrl: m.avatarUrl,
        active: m.isActive && !m.removedAt,
      });
    }
    const mentionable = [...byId.values()]
      .filter((p) => p.active && p.id !== userId)
      .map(({ active: _active, ...p }) => p)
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      currentUserId: userId,
      mentionable,
      names: [...byId.values()].map((p) => p.name),
      nameOf: (id) => byId.get(id)?.name ?? null,
      personOf: (id) => {
        const p = byId.get(id);
        return p ? { id: p.id, name: p.name, avatarUrl: p.avatarUrl } : null;
      },
    };
  }, [members, userId]);
}
