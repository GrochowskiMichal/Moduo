// The agent session line under a task's title (Tasks v3 TV-D16, call 52, spec
// §12): "Claude · Writing tests · step 3 of 5 · 2m ago · PR #42 ↗", the run's
// earlier lines folded under it, and for whoever started it the hand-back
// summary with "Post as comment" and a way to clear the line. Status, not
// conversation: there is no reply box. Who sees a session is the server's
// (RLS); this renders the sessions the reader's store holds.

import { ArrowUpRight, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { cn } from "../../../lib/utils";
import {
  type AgentSession,
  agentLineParts,
  agentLineText,
  isOwnSession,
  linkWords,
  stepWords,
} from "../../spine/agent-session";
import { useMinuteTick } from "../use-today";

const NO_SESSIONS: readonly AgentSession[] = [];

export function AgentSessionLines({
  taskId,
  workspaceId,
  sessions,
  userId,
  runtime,
}: {
  taskId: string;
  workspaceId: string;
  sessions: readonly AgentSession[] | undefined;
  userId: string | null;
  runtime: ModuoRuntime | null;
}) {
  const mine = useMemo(
    () =>
      (sessions ?? NO_SESSIONS)
        .filter((s) => s.taskId === taskId && !s.deletedAt)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [sessions, taskId],
  );
  // The "2m ago" and "No update for 40m" words move on by the minute.
  const tick = useMinuteTick(mine.length > 0);
  if (mine.length === 0) return null;
  return (
    <div data-slot="agent-sessions" className="flex flex-col gap-1 pl-6" data-tick={tick}>
      {mine.map((s) => (
        <AgentSessionLine
          key={s.id}
          session={s}
          workspaceId={workspaceId}
          own={isOwnSession(s, userId)}
          runtime={runtime}
        />
      ))}
    </div>
  );
}

function AgentSessionLine({
  session,
  workspaceId,
  own,
  runtime,
}: {
  session: AgentSession;
  workspaceId: string;
  own: boolean;
  runtime: ModuoRuntime | null;
}) {
  const now = new Date();
  const parts = agentLineParts(session, now);
  const [open, setOpen] = useState(false);
  // The summary read, tagged with the summary it belongs to: a newer one (a
  // re-report, a new run) reads again, so the fold never shows text other
  // than what "Post as comment" would post.
  const [summary, setSummary] = useState<{ at: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const hasSummary = own && !!session.summaryAt;
  const summaryText = summary && summary.at === session.summaryAt ? summary.text : null;
  const canFold = session.earlier.length > 0 || hasSummary;
  const loud = !session.stoppedAt && (session.state === "needs_you" || session.state === "failed");

  // The summary is read only when its person opens the fold (it never rides the store).
  useEffect(() => {
    const at = session.summaryAt;
    if (!open || !hasSummary || !at || summaryText !== null || !runtime?.tasks.agentSessionsFor)
      return;
    let live = true;
    runtime.tasks
      .agentSessionsFor({ workspaceId, taskId: session.taskId })
      .then((list) => {
        if (!live) return;
        setSummary({ at, text: list.find((s) => s.id === session.id)?.summary ?? "" });
      })
      .catch(() => {
        if (live) setSummary({ at, text: "" });
      });
    return () => {
      live = false;
    };
  }, [
    open,
    hasSummary,
    summaryText,
    runtime,
    workspaceId,
    session.taskId,
    session.id,
    session.summaryAt,
  ]);

  const post = async () => {
    if (!runtime?.tasks.postAgentSummary || busy) return;
    setBusy(true);
    try {
      await runtime.tasks.postAgentSummary({ workspaceId, sessionId: session.id });
      toast("Posted as a comment.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't post the summary.");
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    if (!runtime?.tasks.dismissAgentSession || busy) return;
    setBusy(true);
    try {
      await runtime.tasks.dismissAgentSession({ workspaceId, sessionId: session.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't clear the line.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-slot="agent-session" data-state={session.stoppedAt ? "stopped" : session.state}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-sans text-xs text-muted-foreground">
        <span className="sr-only">{agentLineText(session, now)}</span>
        {parts.map((part, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: the line's parts are fixed in order.
            key={i}
            aria-hidden
            className={cn(
              "whitespace-nowrap",
              i === 0 && "font-medium text-foreground",
              i === 1 && loud && "text-foreground",
            )}
          >
            {i > 0 ? `· ${part}` : part}
          </span>
        ))}
        {session.links.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 whitespace-nowrap text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            · {linkWords(link)}
            <ArrowUpRight className="size-icon-xs" aria-hidden />
          </a>
        ))}
        {canFold ? (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="h-auto px-1 py-0 text-xs text-muted-foreground"
          >
            {open ? "Fold" : hasSummary ? "Summary" : `${session.earlier.length} earlier`}
          </Button>
        ) : null}
        {own && runtime?.tasks.dismissAgentSession ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Clear this line"
                disabled={busy}
                onClick={clear}
                className="hit-min size-4 text-muted-foreground"
              >
                <X className="size-icon-xs" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear this line</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {open ? (
        <div className="mt-1 flex flex-col gap-1 border-l border-hairline pl-2 font-sans text-xs text-muted-foreground">
          {session.earlier.map((line) => (
            <span key={`${line.at}-${line.state}`}>
              {[line.note ?? line.state, stepWords(line)].filter(Boolean).join(" · ")}
            </span>
          ))}
          {hasSummary ? (
            <div className="flex flex-col gap-1">
              <p className="whitespace-pre-wrap text-foreground">
                {summaryText === null ? "…" : summaryText || "No summary."}
              </p>
              {session.summaryPostedAt ? (
                <span>Posted as a comment.</span>
              ) : runtime?.tasks.postAgentSummary ? (
                <div>
                  <Button variant="outline" size="sm" disabled={busy} onClick={post}>
                    Post as comment
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
