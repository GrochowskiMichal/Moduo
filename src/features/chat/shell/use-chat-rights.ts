// What your role lets you do in chat, read from the workspace's chat rights
// (`chat_caps_get`: one row per role, the same rows the server's
// `chat_has_cap` reads) and the open channel's managers (`chat_channel_managers`,
// readable by anyone who reads the channel). The screen uses these only to
// show a line instead of a box; every write is still decided by the server.

import type { WorkspaceRole } from "@contracts/vocabularies";
import { useEffect, useState } from "react";
import { supabaseClient } from "@/lib/runtime.web";

type CapsRow = {
  role_key?: unknown;
  post?: unknown;
  manage_any?: unknown;
  create_public?: unknown;
  create_private?: unknown;
};

export type ChatRights = {
  /** Post, react to your own words, start a direct message (a viewer can't). */
  canPost: boolean;
  /** Manage any channel (an admin by default). */
  manageAny: boolean;
  /** Make a public / a private channel (New conversation, CV-8b). */
  createPublic: boolean;
  createPrivate: boolean;
};

/** The caps row a role reads (the server's mapping in `chat_has_cap`). */
export function capsRoleKey(role: WorkspaceRole | null, readOnly: boolean): string {
  if (readOnly || role === "viewer") return "viewer";
  if (role === "admin") return "admin";
  return "member";
}

export function rightsFrom(
  rows: readonly CapsRow[] | null,
  role: WorkspaceRole | null,
  readOnly: boolean,
): ChatRights {
  if (role === "owner") {
    return { canPost: true, manageAny: true, createPublic: true, createPrivate: true };
  }
  const key = capsRoleKey(role, readOnly);
  const row = rows?.find((r) => r.role_key === key);
  // Before the rows arrive (or if they can't be read): the role's usual rights.
  if (!row) {
    const writes = key !== "viewer";
    return {
      canPost: writes,
      manageAny: key === "admin",
      createPublic: writes,
      createPrivate: writes,
    };
  }
  return {
    canPost: row.post === true,
    manageAny: row.manage_any === true,
    createPublic: row.create_public === true,
    createPrivate: row.create_private === true,
  };
}

/** The workspace's chat rights rows (null while they load or can't be read). */
export function useChatCapsRows(workspaceId: string | null): CapsRow[] | null {
  const [rows, setRows] = useState<CapsRow[] | null>(null);
  useEffect(() => {
    setRows(null);
    if (!workspaceId) return;
    let live = true;
    void supabaseClient.rpc("chat_caps_get", { p_workspace_id: workspaceId }).then(({ data }) => {
      if (live && Array.isArray(data)) setRows(data as CapsRow[]);
    });
    return () => {
      live = false;
    };
  }, [workspaceId]);
  return rows;
}

export function useChatRights(
  workspaceId: string | null,
  role: WorkspaceRole | null,
  /** Chat is view-only for your role (a read-only custom role). */
  readOnly: boolean,
): ChatRights {
  return rightsFrom(useChatCapsRows(workspaceId), role, readOnly);
}

/**
 * Whether someone else's role posts (the server's `chat_has_cap(…, 'post')`):
 * only they can be made a manager. Unknown people read as members.
 */
export function personPosts(
  rows: readonly CapsRow[] | null,
  person: { role: string | null; readOnly?: boolean } | undefined,
): boolean {
  const role = (person?.role ?? null) as WorkspaceRole | null;
  return rightsFrom(rows, role, !!person?.readOnly).canPost;
}

/**
 * Who manages a channel in effect (§12, #13): a manager row counts only while
 * its holder is in the channel and their role posts (the server's
 * `chat__is_manager`); "Manage any channel" makes an admin one without a row.
 * Someone demoted (their row removed, or their role now a viewer's) loses the
 * controls at once.
 */
export function managesChannel(args: {
  selfId: string;
  managers: readonly string[] | null;
  inChannel: boolean;
  rights: Pick<ChatRights, "canPost" | "manageAny">;
}): { canManage: boolean; isManager: boolean } {
  const isManager =
    args.rights.canPost && args.inChannel && (args.managers ?? []).includes(args.selfId);
  return { isManager, canManage: args.rights.manageAny || isManager };
}

/**
 * The open channel's managers (empty for a direct message; null while they
 * load). Read again when its roster stamp moves (someone made or unmade a
 * manager, joined, left or was removed), never on a message.
 */
export function useChannelManagers(
  channelId: string | null,
  kind: string | null,
  rosterAt: string | null = null,
): string[] | null {
  // Held with the channel they belong to: another channel's never show for a moment.
  const [held, setHeld] = useState<{ channelId: string | null; ids: string[] | null }>({
    channelId: null,
    ids: null,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: the roster stamp is the trigger
  useEffect(() => {
    if (!channelId || kind !== "channel") return;
    let live = true;
    void supabaseClient
      .from("chat_channel_managers")
      .select("user_id")
      .eq("channel_id", channelId)
      .then(({ data }) => {
        if (!live) return;
        const ids = Array.isArray(data)
          ? data
              .map((r) => (r as { user_id?: unknown }).user_id)
              .filter((v): v is string => typeof v === "string")
          : [];
        setHeld({ channelId, ids });
      });
    return () => {
      live = false;
    };
  }, [channelId, kind, rosterAt]);
  if (kind !== "channel") return [];
  return held.channelId === channelId ? held.ids : null;
}

/**
 * The workspace's people under chat's own read of them. Chat's read knows no
 * roles: the workspace's role and read-only flag stay (they decide who can be
 * made a manager).
 */
export function mergePeople<P extends { userId: string; role: string | null; readOnly?: boolean }>(
  members: readonly P[],
  chatPeople: readonly P[],
): Record<string, P> {
  const out: Record<string, P> = {};
  for (const p of members) out[p.userId] = p;
  for (const p of chatPeople) {
    const ws = out[p.userId];
    out[p.userId] = { ...ws, ...p, role: p.role ?? ws?.role ?? null, readOnly: ws?.readOnly };
  }
  return out;
}
