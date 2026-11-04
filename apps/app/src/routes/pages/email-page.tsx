import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

import { mailEngineMode } from "../../features/email/engine/behavior";
import { useMailStore } from "../../features/email/store/use-mail-store";
import { EmailPageView } from "../../features/email/ui/email-page-view";
import { MailPage } from "../../features/email/ui/mail-page";
import type { EmailSearch } from "../../features/email/url-search";

const IS_DESKTOP = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Mail runs on the rebuilt engine (MR-16) on desktop, or on the fixture
 *  engine anywhere it's switched on; the web keeps its tissue view. */
export function useMailOnEngine(): boolean {
  const hasEngine = useMailStore((s) => s.engine !== null);
  const mode = mailEngineMode();
  return hasEngine || mode === "fixture" || (IS_DESKTOP && mode === "on");
}

export function EmailPage() {
  // `?thread=` deep link (DF-2). Consume-once command: the page selects +
  // scrolls the thread (desktop) or its tissue card (web), then clears the
  // param with `replace` — the deep link is a jump, not a walk-back step, and
  // email selection is transient component state (not URL-held).
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as EmailSearch;
  const urlThreadId = search.thread ?? null;
  const onEngine = useMailOnEngine();
  const clearThreadParam = useCallback(() => {
    void navigate({
      to: "/email",
      replace: true,
      search: (prev: Record<string, unknown>) => {
        const next = { ...prev };
        delete next.thread;
        return next;
      },
    });
  }, [navigate]);

  if (onEngine) {
    return <MailPage initialThreadId={urlThreadId} onConsumeThreadDeepLink={clearThreadParam} />;
  }
  return <EmailPageView urlThreadId={urlThreadId} onConsumeThreadDeepLink={clearThreadParam} />;
}
