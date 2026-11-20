// The role editor's chat rows (spec §15, CV-15, #13): the workspace's chat
// switches for this role, read from `chat_caps_get` and saved one at a time
// through `chat_caps_set` — the same rows the server's `chat_has_cap` reads,
// so what's on here is what the server allows. Chat's switches belong to the
// three built-in roles: a custom role uses Member's (Viewer's when it's
// read-only), shown here without switches. "Start calls" stays hidden until
// Meet ships; "Add custom emoji" shows once the workspace has the switch (CV-20).

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { GroupHeader } from "@/components/ui/group-header";
import { Switch } from "@/components/ui/switch";
import { supabaseClient } from "@/lib/runtime.web.client";

type CapsRow = Record<string, unknown> & { role_key?: unknown };

/** The rows shown, in order, with their words. `start_calls` is hidden (no calls yet). */
export const CHAT_RIGHT_ROWS: readonly { key: string; label: string; hint: string }[] = [
  { key: "post", label: "Post and reply", hint: "Off: they read and react only" },
  { key: "mention_everyone", label: "Mention everyone", hint: "@channel reaches everyone in it" },
  {
    key: "create_public",
    label: "Create public channels",
    hint: "Anyone in the workspace can find them",
  },
  {
    key: "create_private",
    label: "Create private channels",
    hint: "Only the people added see them",
  },
  { key: "delete_others", label: "Delete others' messages", hint: "Everyone can delete their own" },
  {
    key: "manage_any",
    label: "Manage any channel",
    hint: "Rename, archive, delete and add people anywhere",
  },
  { key: "add_emoji", label: "Add custom emoji", hint: "For everyone in the workspace" },
];

/** Which caps row a role reads (the server's mapping in `chat_has_cap`). */
export function chatCapsKey(systemKey: string | null | undefined, readOnly: boolean): string {
  if (readOnly || systemKey === "viewer") return "viewer";
  if (systemKey === "admin") return "admin";
  return "member";
}

/** The rows a caps row shows: only switches the workspace has (add_emoji arrives with CV-20). */
export function visibleRights(row: CapsRow | null): typeof CHAT_RIGHT_ROWS {
  if (!row) return CHAT_RIGHT_ROWS.filter((r) => r.key !== "add_emoji");
  return CHAT_RIGHT_ROWS.filter((r) => typeof row[r.key] === "boolean");
}

export function ChatRightsSection({
  workspaceId,
  systemKey,
  readOnly,
  editable,
  roleName,
}: {
  workspaceId: string | null;
  systemKey: string | null | undefined;
  readOnly: boolean;
  /** You may change roles (the owner, or ws.manage_roles on a role you may edit). */
  editable: boolean;
  roleName: string;
}) {
  const key = chatCapsKey(systemKey, readOnly);
  const builtIn = systemKey === "admin" || systemKey === "member" || systemKey === "viewer";
  const [row, setRow] = useState<CapsRow | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    setRow(null);
    if (!workspaceId) return;
    let live = true;
    void supabaseClient.rpc("chat_caps_get", { p_workspace_id: workspaceId }).then(({ data }) => {
      if (!live || !Array.isArray(data)) return;
      setRow(((data as CapsRow[]).find((r) => r.role_key === key) ?? null) as CapsRow | null);
    });
    return () => {
      live = false;
    };
  }, [workspaceId, key]);

  const toggle = async (cap: string, on: boolean) => {
    if (!workspaceId || !row) return;
    const before = row;
    setRow({ ...row, [cap]: on });
    setSaving(cap);
    const { error } = await supabaseClient.rpc("chat_caps_set", {
      p_workspace_id: workspaceId,
      p_role_key: key,
      p_caps: { [cap]: on },
    });
    setSaving(null);
    if (error) {
      setRow(before);
      toast.error(error.message || "Couldn't save that.");
    }
  };

  const viewer = key === "viewer";
  const rows = visibleRights(row);

  return (
    <section className="flex flex-col gap-1" aria-label="Chat" data-slot="role-chat-rights">
      <GroupHeader
        as="h3"
        label="Chat"
        sub={
          builtIn
            ? viewer
              ? "Viewers read, react and receive direct messages"
              : undefined
            : `${roleName} uses ${viewer ? "Viewer" : "Member"}'s chat rights`
        }
      />
      <div className="flex flex-col rounded-md border border-border px-3 py-1">
        {rows.map((r) => {
          const on = row ? row[r.key] === true : false;
          const locked = !builtIn || !editable || viewer || !row || saving !== null;
          return (
            <div
              key={r.key}
              className="flex min-h-(--row-h) items-center justify-between gap-3 py-1"
              data-cap={r.key}
            >
              <label htmlFor={`chat-cap-${r.key}`} className="flex min-w-0 flex-col text-sm">
                {r.label}
                <span className="text-xs text-muted-foreground">{r.hint}</span>
              </label>
              <Switch
                id={`chat-cap-${r.key}`}
                size="sm"
                checked={on}
                disabled={locked}
                onCheckedChange={(checked) => void toggle(r.key, checked)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
