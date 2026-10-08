/** Chat capability grid (PERM-7). Viewer stays read-only. */

import { CHAT_CAPABILITIES } from "@contracts/vocabularies";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "../../components/ui/checkbox";

import { supabaseClient } from "../../lib/runtime.web";
import { CHAT_CAP_DEFAULTS } from "./rules";

const LABELS: Record<string, string> = {
  create_public: "Create public channels",
  create_private: "Create private channels",
  manage_any: "Manage any channel",
  delete_others: "Delete others' messages",
  mention_everyone: "Mention everyone",
  post: "Post in channels",
  start_calls: "Start calls",
};

type Row = { role_key: string } & Record<string, boolean | string>;

export function ChatCapsPanel({ workspaceId }: { workspaceId: string }) {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    void supabaseClient.rpc("chat_caps_get", { p_workspace_id: workspaceId }).then(({ data }) => {
      if (Array.isArray(data) && data.length > 0) setRows(data as Row[]);
      else {
        setRows(
          (["admin", "member", "viewer"] as const).map((role_key) => ({
            role_key,
            ...CHAT_CAP_DEFAULTS[role_key],
          })),
        );
      }
    });
  }, [workspaceId]);

  const toggle = async (role: string, cap: string, on: boolean) => {
    if (role === "viewer") return;
    const { error } = await supabaseClient.rpc("chat_caps_set", {
      p_workspace_id: workspaceId,
      p_role_key: role,
      p_caps: { [cap]: on },
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((prev) => prev.map((row) => (row.role_key === role ? { ...row, [cap]: on } : row)));
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="font-display text-base">Chat</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Viewers can read. They can't post. Channel managers and announcement channels are set on
          the channel.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-3 font-normal">Capability</th>
              <th className="px-2 font-normal">Admin</th>
              <th className="px-2 font-normal">Member</th>
              <th className="px-2 font-normal">Viewer</th>
            </tr>
          </thead>
          <tbody>
            {CHAT_CAPABILITIES.map((cap) => (
              <tr key={cap} className="border-t border-border">
                <td className="py-2 pr-3">{LABELS[cap]}</td>
                {(["admin", "member", "viewer"] as const).map((role) => {
                  const row = rows.find((r) => r.role_key === role);
                  const on = row ? row[cap] === true : CHAT_CAP_DEFAULTS[role][cap];
                  return (
                    <td key={role} className="px-2">
                      <Checkbox
                        checked={on}
                        disabled={role === "viewer"}
                        aria-label={`${role} ${LABELS[cap]}`}
                        onCheckedChange={(checked) => void toggle(role, cap, checked === true)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
