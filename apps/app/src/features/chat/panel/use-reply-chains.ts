// A conversation's reply chains (CV-12): the Reply chains view and Details'
// section share this one read. It reads again when `refresh` changes (the
// screen folds the window's reply counts and wrap states into it, never a
// plain new message), and a root the store holds is drawn from the store, so
// a live wrap-up or a new reply shows without another read.

import { useEffect, useState } from "react";

import type { ChatMessage, ChatRuntime } from "../model";

export function useReplyChains(
  chat: ChatRuntime | null,
  channelId: string | null,
  refresh: string,
  rowById: (id: string) => ChatMessage | undefined,
): ChatMessage[] | null {
  const [state, setState] = useState<{ id: string | null; roots: ChatMessage[] | null }>({
    id: null,
    roots: null,
  });

  // `refresh` is the re-read trigger.
  useEffect(() => {
    if (!chat || !channelId) return;
    let live = true;
    void chat.chains(channelId).then((res) => {
      if (!live) return;
      // A failed read shows the section empty rather than spinning for ever.
      setState({ id: channelId, roots: res.data ?? [] });
    });
    return () => {
      live = false;
    };
  }, [chat, channelId, refresh]);

  if (state.id !== channelId || !state.roots) return null;
  return state.roots.map((r) => rowById(r.id) ?? r);
}
