// An agent's work, as status, not conversation (Tasks v3 TV-D16; spec §12,
// §Assumptions #15; REPLAN 52): one line under a task's title ("Claude ·
// Writing tests · step 3 of 5 · 2m ago · PR #42") and a quiet mark on its
// row ("Claude · working"). Sessions are private to whoever started them
// unless they show their agent work to teammates; the server decides who
// reads a session (RLS), so everything here works on the sessions a reader
// already has. Pure, so the rules are tested without a component.

import { type AgentSessionState, isClosedTask } from "@contracts/vocabularies";
import { formatAge } from "../../lib/time-format";

export type AgentSessionLink = { url: string; label?: string };
export type AgentSessionLine = {
  at: string;
  state: AgentSessionState;
  note?: string | null;
  step?: number | null;
  steps?: number | null;
};

/** One agent session on a task, as the store keeps it. */
export type AgentSession = {
  id: string;
  workspaceId: string;
  taskId: string;
  /** Whoever started it: the key's person. */
  userId: string;
  /** The name on the line ("Claude"). */
  agent: string;
  state: AgentSessionState;
  note: string | null;
  step: number | null;
  steps: number | null;
  links: readonly AgentSessionLink[];
  /** The run's earlier lines, newest first. */
  earlier: readonly AgentSessionLine[];
  /** A hand-back summary arrived (only its person reads the text). */
  summaryAt: string | null;
  summaryPostedAt: string | null;
  startedAt: string;
  updatedAt: string;
  /** Its key was revoked while it was working or waiting on its person. */
  stoppedAt: string | null;
  deletedAt?: string | null;
};

/** "No update for 40m" shows once a working session has been quiet this long (spec). */
export const AGENT_SILENCE_MS = 30 * 60_000;

const STATE_WORDS: Record<AgentSessionState, string> = {
  working: "working",
  needs_you: "needs you",
  ready: "ready for review",
  failed: "failed",
};

/** "step 3 of 5", or null. */
export function stepWords(s: { step?: number | null; steps?: number | null }): string | null {
  return s.step != null && s.steps != null ? `step ${s.step} of ${s.steps}` : null;
}

/** "No update for 40m" for a working session quiet past 30 minutes; else null. Never a notice. */
export function silenceWords(
  s: Pick<AgentSession, "state" | "updatedAt" | "stoppedAt">,
  now: Date,
): string | null {
  if (s.state !== "working" || s.stoppedAt) return null;
  const quiet = now.getTime() - new Date(s.updatedAt).getTime();
  if (!Number.isFinite(quiet) || quiet < AGENT_SILENCE_MS) return null;
  return `No update for ${formatAge(s.updatedAt, now)}`;
}

/**
 * Who a session's line names: the agent alone on your own ("Claude"), and
 * whose agent it is on a teammate's ("Anna's Claude"), so an agent's chosen
 * name never reads as a person. A person the reader can't name reads
 * "A teammate's".
 */
export function agentWho(
  s: Pick<AgentSession, "agent" | "userId">,
  viewerId: string | null,
  ownerName: (userId: string) => string | null | undefined,
): string {
  if (viewerId && s.userId === viewerId) return s.agent;
  const owner = ownerName(s.userId)?.trim();
  return `${owner || "A teammate"}'s ${s.agent}`;
}

/** A link's words: its label, else its host. */
export function linkWords(link: AgentSessionLink): string {
  if (link.label?.trim()) return link.label.trim();
  try {
    return new URL(link.url).host || link.url;
  } catch {
    return link.url;
  }
}

/**
 * The line under the title, as parts (the panel joins them with " · " and
 * renders the links): "Claude" (or `who`, see agentWho), what it's doing
 * ("Writing tests", or its state when it needs you / is ready / failed),
 * "step 3 of 5", when ("2m ago", or "No update for 40m"). A revoked key reads
 * "Stopped (key revoked)".
 */
export function agentLineParts(s: AgentSession, now: Date, who: string = s.agent): string[] {
  if (s.stoppedAt) return [who, "Stopped (key revoked)"];
  const parts = [who];
  const note = s.note?.trim() || null;
  if (s.state === "working") parts.push(note ?? "Working");
  else {
    const state = STATE_WORDS[s.state];
    parts.push(`${state.charAt(0).toUpperCase()}${state.slice(1)}${note ? `: ${note}` : ""}`);
  }
  const step = stepWords(s);
  if (step) parts.push(step);
  const silent = silenceWords(s, now);
  if (silent) parts.push(silent);
  else {
    const age = formatAge(s.updatedAt, now);
    parts.push(age === "now" ? "just now" : `${age} ago`);
  }
  return parts;
}

/** What the line's chip says (round-1c `.agent`): "Claude · needs you", "Claude · no update for 40m". */
export type AgentChipTone = "quiet" | "loud" | "stale" | "ready" | "failed";

export function agentChip(
  s: AgentSession,
  now: Date,
  who: string = s.agent,
): { words: string; tone: AgentChipTone } {
  if (s.stoppedAt) return { words: `${who} · stopped`, tone: "stale" };
  const silent = silenceWords(s, now);
  if (silent) {
    return { words: `${who} · ${silent.charAt(0).toLowerCase()}${silent.slice(1)}`, tone: "stale" };
  }
  const tone: AgentChipTone =
    s.state === "needs_you"
      ? "loud"
      : s.state === "ready"
        ? "ready"
        : s.state === "failed"
          ? "failed"
          : "quiet";
  return { words: `${who} · ${STATE_WORDS[s.state]}`, tone };
}

/** The sentence after the chip: the line without its "who" ("Needs you: … · step 3 of 5 · 2m ago"). */
export function agentSentence(s: AgentSession, now: Date): string {
  return agentLineParts(s, now).slice(1).join(" · ");
}

/** The line as text (screen readers, tests). */
export function agentLineText(s: AgentSession, now: Date, who: string = s.agent): string {
  return agentLineParts(s, now, who).join(" · ");
}

/**
 * The row's quiet mark: "Claude · working" or "Claude · needs you", for an
 * open task with a session in one of those states (ready and failed show on
 * the task's line, not its row). The newest session wins; `who` names it
 * (agentWho: a teammate's reads "Anna's Claude").
 */
export function agentRowMark(
  sessions: readonly AgentSession[],
  task: { status?: unknown; statusCategory?: unknown } | null,
  who: (s: AgentSession) => string = (s) => s.agent,
): string | null {
  if (task && isClosedTask(task as Parameters<typeof isClosedTask>[0])) return null;
  let best: AgentSession | null = null;
  for (const s of sessions) {
    if (s.deletedAt || s.stoppedAt) continue;
    if (s.state !== "working" && s.state !== "needs_you") continue;
    if (!best || s.updatedAt > best.updatedAt) best = s;
  }
  return best ? `${who(best)} · ${STATE_WORDS[best.state]}` : null;
}

/** Live sessions per task, newest first. */
export function agentSessionsByTask(
  sessions: readonly AgentSession[],
): Map<string, AgentSession[]> {
  const out = new Map<string, AgentSession[]>();
  for (const s of sessions) {
    if (s.deletedAt) continue;
    const list = out.get(s.taskId) ?? [];
    list.push(s);
    out.set(s.taskId, list);
  }
  for (const list of out.values()) list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

/** Row marks for every task with a live working / needs-you session. */
export function agentRowMarks(
  sessions: readonly AgentSession[],
  taskById: (id: string) => { status?: unknown; statusCategory?: unknown } | null | undefined,
  who?: (s: AgentSession) => string,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [taskId, list] of agentSessionsByTask(sessions)) {
    const task = taskById(taskId);
    if (!task) continue;
    const mark = agentRowMark(list, task, who);
    if (mark) out.set(taskId, mark);
  }
  return out;
}

/** Can this reader post or clear the session? Only whoever started it. */
export function isOwnSession(s: Pick<AgentSession, "userId">, userId: string | null): boolean {
  return !!userId && s.userId === userId;
}
