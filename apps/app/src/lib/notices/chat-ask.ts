// The web app's one question about notifications (CV-6b, CH44): the first time
// you open Chat in a browser it asks "Get a notice when someone messages you ·
// Allow · Not now", once per browser; the answer is kept here. Refused (by
// you in the browser, or before), Catch up says "Notifications are off in this
// browser" (#33) and Settings reads "Not allowed by the browser".

import { useEffect, useState } from "react";
import { type BrowserPushState, browserPushState } from "./browser-push";

export const CHAT_ASK_KEY = "moduo:chat-notice-ask";
export const CHAT_ASK_TITLE = "Get a notice when someone messages you";
export const NOTICES_OFF_LINE = "Notifications are off in this browser";

export type ChatAskAnswer = "allowed" | "refused" | "later";

export function readChatAsk(): ChatAskAnswer | null {
  try {
    const value = window.localStorage.getItem(CHAT_ASK_KEY);
    return value === "allowed" || value === "refused" || value === "later" ? value : null;
  } catch {
    return null;
  }
}

export function rememberChatAsk(answer: ChatAskAnswer): void {
  try {
    window.localStorage.setItem(CHAT_ASK_KEY, answer);
  } catch {
    // Private mode: it may ask again next time, never twice in a session.
  }
}

/** Ask only a browser that has never answered and can still say yes. */
export function shouldAskChat(answer: ChatAskAnswer | null, state: BrowserPushState): boolean {
  return answer === null && state === "off";
}

/** Whether Catch up's "Notifications are off in this browser" line shows. */
export function noticesOffInBrowser(state: BrowserPushState): boolean {
  return state === "denied";
}

/** The browser's notification state, read once on mount (web only). */
export function useBrowserNoticesOff(): boolean {
  const [off, setOff] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void browserPushState().then((state) => {
      if (!cancelled) setOff(noticesOffInBrowser(state));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return off;
}
