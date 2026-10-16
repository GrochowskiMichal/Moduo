// The web app asks once (CV-6b, CH44): the first time Chat opens in a browser,
// "Get a notice when someone messages you · Allow · Not now". Allow asks the
// browser and subscribes it (`enableBrowserPush`); the answer is kept, so it
// never asks again; Settings → Preferences turns it on later.

import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { browserPushState, enableBrowserPush } from "../../lib/notices/browser-push";
import {
  CHAT_ASK_TITLE,
  readChatAsk,
  rememberChatAsk,
  shouldAskChat,
} from "../../lib/notices/chat-ask";
import { useAuth } from "../../providers/auth-provider";

export function ChatNoticeAsk() {
  const { runtime, userId } = useAuth();
  const onChat = useRouterState({
    select: (state) =>
      state.location.pathname === "/chat" || state.location.pathname.startsWith("/chat/"),
  });
  const asked = useRef(false);

  useEffect(() => {
    if (!onChat || !runtime || !userId || asked.current) return;
    if (readChatAsk() !== null) return;
    let cancelled = false;
    void browserPushState().then((state) => {
      if (cancelled || asked.current || !shouldAskChat(readChatAsk(), state)) return;
      asked.current = true;
      let answered = false;
      const answer = (value: "allowed" | "refused" | "later") => {
        if (answered) return;
        answered = true;
        rememberChatAsk(value);
      };
      toast(CHAT_ASK_TITLE, {
        id: "chat-notice-ask",
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Allow",
          onClick: () => {
            enableBrowserPush(runtime, userId).then(
              (after) =>
                answer(after === "on" ? "allowed" : after === "denied" ? "refused" : "later"),
              () => {
                answer("later");
                toast("Couldn't turn on notifications. Try it in Settings → Preferences.");
              },
            );
          },
        },
        cancel: { label: "Not now", onClick: () => answer("later") },
        onDismiss: () => answer("later"),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [onChat, runtime, userId]);

  return null;
}
