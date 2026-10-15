// The agent session line under a task's title (Tasks v3 TV-D16, call 52, spec
// §12), as round-1c's rows draw it: a chip "Claude · working" (a dot, or a
// check or an x once it's ready or failed), one sentence "Writing tests ·
// step 3 of 5 · 2m ago" with its link "PR #42 ↗", or several links as small
// chips under it; the run's earlier lines folded under that, and for whoever
// started it the hand-back summary with "Post as comment" and a way to clear
// the line. Status, not conversation: there is no reply box. Who sees a
// session is the server's (RLS); this renders the sessions the reader's
// store holds.

import { ArrowUpRight, CircleCheck, CircleX, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { chipClasses } from "../../../components/ui/chip";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { cn } from "../../../lib/utils";
import {
  type AgentChipTone,
  type AgentSession,
  type AgentSessionLink,
  agentChip,
  agentLineText,
  agentSentence,
  agentWho,
  isOwnSession,
  linkWords,
  stepWords,
} from "../../spine/agent-session";
import { useAssignees } from "../assignees";
import { useMinuteTick } from "../use-today";

const NO_SESSIONS: readonly AgentSession[] = [];

export function AgentSessionLines({
  taskId,
  workspaceId,
  sessions,
  userId,
  runtime,
  className,
}: {
  taskId: string;
  workspaceId: string;
  sessions: readonly AgentSession[] | undefined;
  userId: string | null;
  runtime: ModuoRuntime | null;
  /** The panel indents the line under its title; Focus's card doesn't (TV-F8). */
  className?: string;
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
  // A teammate's line says whose agent it is ("Anna's Claude").
  const { byId } = useAssignees();
  if (mine.length === 0) return null;
  return (
    <div
      data-slot="agent-sessions"
      className={cn("flex flex-col gap-1 pl-6", className)}
      data-tick={tick}
    >
      {mine.map((s) => (
        <AgentSessionLine
          key={s.id}
          session={s}
          who={agentWho(s, userId, (id) => byId(id)?.fullName)}
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
  who,
  workspaceId,
  own,
  runtime,
}: {
  session: AgentSession;
  /** The line's first words: "Claude", or "Anna's Claude" on a teammate's. */
  who: string;
  workspaceId: string;
  own: boolean;
  runtime: ModuoRuntime | null;
}) {
  const now = new Date();
  const [open, setOpen] = useState(false);
  // The summary read, tagged with the summary it belongs to: a newer one (a
  // re-report, a new run) reads again, so the fold never shows text other
  // than what "Post as comment" would post.
  const [summary, setSummary] = useState<{ at: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const hasSummary = own && !!session.summaryAt;
  const summaryText = summary && summary.at === session.summaryAt ? summary.text : null;
  const canFold = session.earlier.length > 0 || hasSummary;

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

  const text = agentLineText(session, now, who);
  const chip = agentChip(session, now, who);
  const sentence = agentSentence(session, now);
  const links = session.links;
  // round-1c `.lr`: a chip ("Claude · needs you") with its controls at the
  // row's right end, then ONE sentence cut with an ellipsis (a lone link
  // rides at its end), then several links as one wrapping row of small chips.
  // No item is ever wider than the line (MOD-119).
  return (
    <div data-slot="agent-session" data-state={session.stoppedAt ? "stopped" : session.state}>
      <div
        data-slot="agent-session-line"
        className="flex min-w-0 flex-col gap-0.5 font-sans text-xs text-muted-foreground"
      >
        <span className="sr-only">{text}</span>
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            data-slot="agent-session-chip"
            data-tone={chip.tone}
            className={cn(
              "inline-flex min-w-0 max-w-full items-center gap-1.5",
              chip.tone === "loud" && "text-foreground",
              chip.tone === "stale" && "text-subtle-foreground",
            )}
          >
            <AgentMark tone={chip.tone} />
            <span className="min-w-0 truncate">{chip.words}</span>
          </span>
          {canFold || (own && runtime?.tasks.dismissAgentSession) ? (
            <span className="ml-auto flex shrink-0 items-center gap-1">
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
                      className="hit-min size-4 shrink-0 text-muted-foreground"
                    >
                      <X className="size-icon-xs" aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Clear this line</TooltipContent>
                </Tooltip>
              ) : null}
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 ps-4.5">
          <span
            aria-hidden
            title={text}
            data-slot="agent-session-sentence"
            className={cn("min-w-0 max-w-full truncate", chip.tone === "loud" && "text-foreground")}
          >
            {sentence}
          </span>
          {links.length === 1 ? <AgentLink link={links[0]} /> : null}
        </div>
        {links.length > 1 ? (
          <div data-slot="agent-session-links" className="flex min-w-0 flex-wrap gap-1 ps-4.5">
            {links.map((link) => (
              <AgentLink key={link.url} link={link} chip />
            ))}
          </div>
        ) : null}
      </div>
      {open ? (
        <div className="mt-1 flex min-w-0 flex-col gap-1 border-l border-hairline pl-2 font-sans text-xs break-words text-muted-foreground">
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

/** The chip's mark (round-1c `.adot`): a dot, filled when it needs you, hollow when quiet or stopped; a check or an x once it's done. */
function AgentMark({ tone }: { tone: AgentChipTone }) {
  return (
    <span aria-hidden className="flex w-3 shrink-0 items-center justify-center">
      {tone === "ready" ? (
        <CircleCheck className="size-icon-xs text-muted-foreground" />
      ) : tone === "failed" ? (
        <CircleX className="size-icon-xs text-muted-foreground" />
      ) : (
        <span
          className={cn(
            "size-1.5 rounded-full",
            tone === "loud"
              ? "bg-foreground"
              : tone === "stale"
                ? "ring-1 ring-subtle-foreground ring-inset"
                : "bg-subtle-foreground",
          )}
        />
      )}
    </span>
  );
}

/** A link the agent sent: inline at the sentence's end, or a small chip in the links row. Its words cut, never the line. */
function AgentLink({ link, chip = false }: { link: AgentSessionLink; chip?: boolean }) {
  const words = linkWords(link);
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={words}
      className={
        chip
          ? cn(
              chipClasses({ size: "xs", interactive: true }),
              "text-muted-foreground hover:text-foreground",
            )
          : "inline-flex min-w-0 max-w-full items-center gap-0.5 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      }
    >
      <span className="min-w-0 max-w-40 truncate">{words}</span>
      <ArrowUpRight className="size-icon-xs shrink-0" aria-hidden />
    </a>
  );
}
