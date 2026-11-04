import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

import { mailEngineMode } from "../../features/email/engine/behavior";
import { useMailPageWiring } from "../../features/email/hooks/use-mail-page-wiring";
import { useMailStore } from "../../features/email/store/use-mail-store";
import { EmailWebPage } from "../../features/email/ui/email-web-view";
import { MailPage } from "../../features/email/ui/mail-page";
import type { EmailSearch } from "../../features/email/url-search";
import { TasksProvider } from "../../features/tasks/tasks-context";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";

const IS_DESKTOP = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Mail runs on the rebuilt engine (MR-16) on desktop, or on the fixture
 *  engine anywhere it's switched on; the web shows its tissue view. */
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
    return (
      <EngineMailPage initialThreadId={urlThreadId} onConsumeThreadDeepLink={clearThreadParam} />
    );
  }
  return <EmailWebPage urlThreadId={urlThreadId} onConsumeThreadDeepLink={clearThreadParam} />;
}

type DeepLink = { initialThreadId: string | null; onConsumeThreadDeepLink: () => void };

/** The engine page under the Tasks root its spine gestures and Today panel read. */
function EngineMailPage(props: DeepLink) {
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();
  return (
    <TasksProvider
      runtime={runtime}
      userId={userId}
      workspaceId={selectedWorkspaceId}
      modulePermission={modulePermissions.tasks}
    >
      <WiredMailPage {...props} />
    </TasksProvider>
  );
}

function WiredMailPage(props: DeepLink) {
  const wiring = useMailPageWiring();
  return <MailPage {...props} {...wiring} />;
}
