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

export function useChatRights(
  workspaceId: string | null,
  role: WorkspaceRole | null,
  /** Chat is view-only for your role (a read-only custom role). */
  readOnly: boolean,
): ChatRights {
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
  return rightsFrom(rows, role, readOnly);
}

/** The open channel's managers (empty for a direct message; null while they load). */
export function useChannelManagers(channelId: string | null, kind: string | null): string[] | null {
  const [ids, setIds] = useState<string[] | null>(null);
  useEffect(() => {
    setIds(kind === "channel" ? null : []);
    if (!channelId || kind !== "channel") return;
    let live = true;
    void supabaseClient
      .from("chat_channel_managers")
      .select("user_id")
      .eq("channel_id", channelId)
      .then(({ data }) => {
        if (!live) return;
        if (!Array.isArray(data)) {
          setIds([]);
          return;
        }
        setIds(
          data
            .map((r) => (r as { user_id?: unknown }).user_id)
            .filter((v): v is string => typeof v === "string"),
        );
      });
    return () => {
      live = false;
    };
  }, [channelId, kind]);
  return ids;
}
