// An item's conversations in its Linked (chat-v2 §8, CH11; CV-10, CV-13):
// "Conversation: Acme · 3 new" for each channel linked to the item (CV-13),
// then "Mentioned in Acme · Oct 12", one quiet line per other conversation that
// refers to it. Read through `chat_conversations_for_item`: only conversations
// the reader can read, for an item they can open; nobody else learns the line
// exists. A click opens the conversation. The rows behind them (`mentions` and
// `conversation-of` links from a conversation) stay out of the item's link
// cards (spine/rollup.ts).

import { type ReactNode, useContext, useEffect, useState } from "react";

import { ENTITY_OPEN_EVENT } from "@/lib/entity-open";
import { formatDate } from "@/lib/time-format";
import { useAuth } from "@/providers/auth-provider";
import { resolveEntityIcon } from "../spine/icon-map";
import { WorkspaceContext } from "../workspaces/workspace-context";
import { DecisionLines } from "./decisions";
import type { ChatItemConversation } from "./model";

/** What a line reads after "Mentioned in": the channel's name, or "a direct message". */
export function mentionedInName(
  row: Pick<ChatItemConversation, "channelKind" | "channelName">,
): string {
  return row.channelKind === "channel" ? (row.channelName ?? "a channel") : "a direct message";
}

/** "Conversation: Acme · 3 new", "Conversation: Acme", "Conversation: Acme · archived". */
export function conversationLine(
  row: Pick<ChatItemConversation, "channelKind" | "channelName" | "unread" | "archived">,
): string {
  const base = `Conversation: ${mentionedInName(row)}`;
  if (row.archived) return `${base} · archived`;
  return row.unread > 0 ? `${base} · ${row.unread} new` : base;
}

/** The lines to draw: linked conversations first, then the mentions of the others. */
export function itemConversationLines(rows: readonly ChatItemConversation[]): {
  linked: ChatItemConversation[];
  mentioned: ChatItemConversation[];
} {
  const linked = rows.filter((r) => r.relation === "conversation-of");
  const linkedIds = new Set(linked.map((r) => r.channelId));
  const mentioned = rows.filter((r) => r.relation === "mentions" && !linkedIds.has(r.channelId));
  return { linked, mentioned };
}

/** The item's conversations as the reader sees them (empty when chat is off for them). */
export function useItemConversations(entityType: string, entityId: string): ChatItemConversation[] {
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
    const read = () =>
      runtime.chat
        ?.conversationsForItem(entityType, entityId)
        .then((list) => {
          if (live) setRows(list.filter((r) => r.workspaceId === selectedWorkspaceId));
        })
        .catch(() => {});
    void read();
    // A conversation just started for this item shows without a reload.
    const onStarted = (e: Event) => {
      const d = (e as CustomEvent<{ type?: string; id?: string }>).detail;
      if (d?.id === entityId) void read();
    };
    window.addEventListener(CONVERSATION_STARTED_EVENT, onStarted);
    // Coming back to the window refreshes the "3 new".
    window.addEventListener("focus", read);
    return () => {
      live = false;
      window.removeEventListener(CONVERSATION_STARTED_EVENT, onStarted);
      window.removeEventListener("focus", read);
    };
  }, [runtime, canChat, entityType, entityId, selectedWorkspaceId]);

  return rows;
}

/** Fired with `{ type, id }` of the item when a conversation is started for it. */
export const CONVERSATION_STARTED_EVENT = "moduo:chat-conversation-started";

function openConversation(channelId: string) {
  window.dispatchEvent(
    new CustomEvent(ENTITY_OPEN_EVENT, { detail: { type: "chat_channel", id: channelId } }),
  );
}

function iconFor(r: ChatItemConversation) {
  return resolveEntityIcon(
    r.channelKind === "dm" ? "chat_dm" : r.channelPrivate ? "chat_private" : "chat_channel",
  );
}

const LINE =
  "flex min-w-0 items-center gap-1.5 rounded-sm text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The project overview's two chat slots from one read: "Conversation: Acme ·
 * 3 new" lines (CV-13) and its decisions (CV-14), read only when the item has
 * a conversation the reader can see.
 */
export function useItemChatSlots(
  entityType: string,
  entityId: string,
): { conversation: ReactNode; decisions: ReactNode } {
  const rows = useItemConversations(entityType, entityId);
  const { linked } = itemConversationLines(rows);
  return {
    conversation: linked.length > 0 ? <LinkedLines rows={linked} /> : null,
    decisions: (
      <DecisionLines entityType={entityType} entityId={entityId} enabled={rows.length > 0} />
    ),
  };
}

function LinkedLines({ rows }: { rows: readonly ChatItemConversation[] }) {
  return (
    <ul data-slot="item-conversation" className="flex flex-col gap-0.5">
      {rows.map((r) => {
        const Icon = iconFor(r);
        return (
          <li key={r.channelId}>
            <button
              type="button"
              onClick={() => openConversation(r.channelId)}
              data-unread={r.unread > 0 ? "" : undefined}
              className={LINE}
            >
              <Icon className="size-icon-xs shrink-0" aria-hidden />
              <span className="truncate">{conversationLine(r)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function MentionedInLines({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) {
  const rows = useItemConversations(entityType, entityId);
  const { linked, mentioned } = itemConversationLines(rows);
  // The item's decisions (CV-14) follow its conversations; with none, there's nothing to read.
  const decisions = (
    <DecisionLines entityType={entityType} entityId={entityId} enabled={rows.length > 0} />
  );
  if (linked.length === 0 && mentioned.length === 0) return decisions;
  const now = new Date();
  return (
    <div className="flex flex-col gap-0.5">
      {linked.length > 0 ? <LinkedLines rows={linked} /> : null}
      {mentioned.length > 0 ? (
        <ul data-slot="mentioned-in" className="flex flex-col gap-0.5">
          {mentioned.map((r) => {
            const Icon = iconFor(r);
            return (
              <li key={r.channelId}>
                <button
                  type="button"
                  onClick={() => openConversation(r.channelId)}
                  className={LINE}
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
      ) : null}
      {decisions}
    </div>
  );
}
