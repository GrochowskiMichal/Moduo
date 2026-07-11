import { useCallback } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { EmailPageView } from "../../features/email/ui/email-page-view";
import type { EmailSearch } from "../../features/email/url-search";

export function EmailPage() {
  // `?thread=` deep link (DF-2). Consume-once command: the page selects +
  // scrolls the thread (desktop) or its tissue card (web), then clears the
  // param with `replace` — the deep link is a jump, not a walk-back step, and
  // email selection is transient component state (not URL-held).
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as EmailSearch;
  const urlThreadId = search.thread ?? null;
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

  return (
    <EmailPageView urlThreadId={urlThreadId} onConsumeThreadDeepLink={clearThreadParam} />
  );
}
