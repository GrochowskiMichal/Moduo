// Chat (specs/chat-v2.md): a thin adapter for `/chat?c=&m=`. The link names
// the open conversation (`c`) and a message to land on (`m`), so notices,
// copied links and back/forward all land in the same place; the screen is
// `features/chat/shell/chat-screen.tsx`. A chain (`t`, v1's thread links and
// chain notices) opens at its first message until reply chains (CV-12).

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import type { ChatPerson } from "../../features/chat/model";
import type { ChatSearch } from "../../features/chat/search";
import { ChatScreen } from "../../features/chat/shell/chat-screen";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";

export function ChatPage() {
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId, selectedWorkspace, members, modulePermissions } = useWorkspace();
  const search = useSearch({ strict: false }) as ChatSearch;
  const navigate = useNavigate();

  const people = useMemo<ChatPerson[]>(
    () =>
      members
        .filter((m) => m.isActive && !m.removedAt)
        .map((m) => ({
          userId: m.userId,
          name: m.displayName?.trim() || "Member",
          avatarUrl: m.avatarUrl,
          role: m.role,
          // In the workspace now: never a former member.
          former: false,
        })),
    [members],
  );
  const ownerName = members.find((m) => m.role === "owner")?.displayName?.trim() || null;

  const onOpen = useCallback(
    (c: string | null, opts: { messageId?: string; chainId?: string; replace?: boolean } = {}) => {
      const next: ChatSearch = c
        ? {
            c,
            ...(opts.chainId ? { t: opts.chainId } : {}),
            ...(opts.messageId ? { m: opts.messageId } : {}),
          }
        : {};
      void navigate({ to: "/chat", search: next as Record<string, string>, replace: opts.replace });
    },
    [navigate],
  );
  // Browse channels keeps the open conversation (its Details stay in the panel).
  const onBrowse = useCallback(() => {
    const next: ChatSearch = { ...(search.c ? { c: search.c } : {}), view: "browse" };
    void navigate({ to: "/chat", search: next as Record<string, string> });
  }, [navigate, search.c]);

  return (
    <ChatScreen
      key={selectedWorkspaceId ?? "none"}
      runtime={runtime}
      userId={userId}
      workspaceId={selectedWorkspaceId}
      workspaceName={selectedWorkspace?.name ?? null}
      role={selectedWorkspace?.role ?? null}
      readOnly={modulePermissions.chat === "view"}
      members={people}
      ownerName={ownerName}
      conversationId={search.c ?? null}
      // A chain's link lands on its first message (`t`) until CV-12.
      messageId={search.m ?? search.t ?? null}
      browsing={search.view === "browse"}
      onOpen={onOpen}
      onBrowse={onBrowse}
    />
  );
}
