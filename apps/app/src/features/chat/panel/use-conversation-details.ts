// What Details reads beyond the store (CV-8b): the conversation's people, its
// pinned messages, its decisions (CV-14) and its quiet history. Each read again when `refresh`
// changes (the screen folds the channel's stamp, your membership and the
// window's pins and edits into it), so Details follows what happens in the
// conversation without a subscription of its own.

import { useEffect, useState } from "react";

import type { ChatHistoryEntry, ChatMember, ChatMessage, ChatRuntime } from "../model";

export type ConversationDetails = {
  /** null while the first read is on its way. */
  members: ChatMember[] | null;
  pinned: ChatMessage[] | null;
  /** Marked decisions (CV-14). */
  decisions: ChatMessage[] | null;
  history: ChatHistoryEntry[] | null;
  /** CV-21: whose keys read this private channel. */
  keyReaders: Array<{ userId: string; name: string }> | null;
};

const NONE: ConversationDetails = {
  members: null,
  pinned: null,
  decisions: null,
  history: null,
  keyReaders: null,
};

export function useConversationDetails(
  chat: ChatRuntime | null,
  workspaceId: string | null,
  channelId: string | null,
  refresh: string,
): ConversationDetails {
  const [state, setState] = useState<{ id: string | null; details: ConversationDetails }>({
    id: null,
    details: NONE,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `refresh` is the re-read trigger
  useEffect(() => {
    if (!chat || !workspaceId || !channelId) return;
    let live = true;
    const settle = <K extends keyof ConversationDetails>(key: K, value: ConversationDetails[K]) => {
      if (!live) return;
      setState((prev) => ({
        id: channelId,
        details: { ...(prev.id === channelId ? prev.details : NONE), [key]: value },
      }));
    };
    // A failed read shows the section empty rather than spinning for ever.
    void chat
      .listChannelMembers(channelId)
      .then((rows) => settle("members", rows))
      .catch(() => settle("members", []));
    void chat
      .listPinned(channelId)
      .then((rows) => settle("pinned", rows))
      .catch(() => settle("pinned", []));
    void chat
      .listDecisions(channelId)
      .then((rows) => settle("decisions", rows))
      .catch(() => settle("decisions", []));
    void chat
      .listKeyReaders(channelId)
      .then((rows) => settle("keyReaders", rows))
      .catch(() => settle("keyReaders", []));
    void chat
      .history({ workspaceId, channelId })
      .then((rows) => settle("history", rows))
      .catch(() => settle("history", []));
    return () => {
      live = false;
    };
  }, [chat, workspaceId, channelId, refresh]);

  return state.id === channelId ? state.details : NONE;
}
