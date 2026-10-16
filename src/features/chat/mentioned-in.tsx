// "Mentioned in Acme · Oct 12" in an item's Linked (chat-v2 §8, CH11; CV-10).
// One quiet line per conversation that refers to the item, read through
// `chat_conversations_for_item`: only conversations the reader can read, for an
// item they can open; nobody else learns the line exists. A click opens the
// conversation. The rows behind them (`mentions` links from a conversation)
// stay out of the item's link cards (spine/rollup.ts).

import { useContext, useEffect, useState } from "react";

import { ENTITY_OPEN_EVENT } from "@/lib/entity-open";
import { formatDate } from "@/lib/time-format";
import { useAuth } from "@/providers/auth-provider";
import { resolveEntityIcon } from "../spine/icon-map";
import { WorkspaceContext } from "../workspaces/workspace-context";
import type { ChatItemConversation } from "./model";

/** What a line reads after "Mentioned in": the channel's name, or "a direct message". */
export function mentionedInName(
  row: Pick<ChatItemConversation, "channelKind" | "channelName">,
): string {
  return row.channelKind === "channel" ? (row.channelName ?? "a channel") : "a direct message";
}

/** Whether a link is a conversation's "Mentioned in" (drawn as a line, not a card). */
export function isMentionedInLink(otherType: string, relationKind: string): boolean {
  return otherType === "chat_channel" && relationKind === "mentions";
}

export function MentionedInLines({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) {
  const { runtime } = useAuth();
  // Optional: a host without a workspace (a story, a test) shows no lines.
  const workspace = useContext(WorkspaceContext);
  const selectedWorkspaceId = workspace?.selectedWorkspaceId ?? null;
  const [rows, setRows] = useState<ChatItemConversation[]>([]);
  const canChat = !!workspace && workspace.modulePermissions.chat !== "none";

  useEffect(() => {
    setRows([]);
    if (!runtime?.chat || !canChat || !entityId) return;
    let live = true;
    void runtime.chat
      .conversationsForItem(entityType, entityId)
      .then((list) => {
        if (live) setRows(list.filter((r) => r.workspaceId === selectedWorkspaceId));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [runtime, canChat, entityType, entityId, selectedWorkspaceId]);

  if (rows.length === 0) return null;
  const now = new Date();
  return (
    <ul data-slot="mentioned-in" className="flex flex-col gap-0.5">
      {rows.map((r) => {
        const Icon = resolveEntityIcon(
          r.channelKind === "dm" ? "chat_dm" : r.channelPrivate ? "chat_private" : "chat_channel",
        );
        return (
          <li key={r.channelId}>
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent(ENTITY_OPEN_EVENT, {
                    detail: { type: "chat_channel", id: r.channelId },
                  }),
                )
              }
              className="flex min-w-0 items-center gap-1.5 rounded-sm text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="size-icon-xs shrink-0" aria-hidden />
              <span className="truncate">
                Mentioned in {mentionedInName(r)} · {formatDate(r.since, now)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
