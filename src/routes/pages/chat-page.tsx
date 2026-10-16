// Chat (specs/chat-v2.md): a thin adapter for `/chat?c=&m=`. The link names
// the open conversation (`c`) and a message to land on (`m`), so notices,
// copied links and back/forward all land in the same place; the screen is
// `features/chat/shell/chat-screen.tsx`. A chain (`t`, v1's thread links and
// chain notices) opens on the right and the stream lands on its root (CV-12).

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import type { ChatPerson } from "../../features/chat/model";
import type { ChatSearch } from "../../features/chat/search";
import { ChatScreen } from "../../features/chat/shell/chat-screen";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";

export function ChatPage() {
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId, selectedWorkspace, members, roles, modulePermissions } =
    useWorkspace();
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
          // A read-only custom role reads chat as a viewer (the server's chat_has_cap).
          readOnly: roles.find((r) => r.id === m.roleId)?.readOnly ?? false,
          // In the workspace now: never a former member.
          former: false,
        })),
    [members, roles],
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
      // A chain's link (`t`) lands on its root and opens the chain on the right.
      messageId={search.m ?? search.t ?? null}
      chainId={search.t ?? null}
      browsing={search.view === "browse"}
      onOpen={onOpen}
      onBrowse={onBrowse}
    />
  );
}
