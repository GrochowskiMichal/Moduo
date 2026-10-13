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
export function stepWords(s: Pick<AgentSession, "step" | "steps">): string | null {
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
 * renders the links): "Claude", what it's doing ("Writing tests", or its
 * state when it needs you / is ready / failed), "step 3 of 5", when ("2m
 * ago", or "No update for 40m"). A revoked key reads "Stopped (key revoked)".
 */
export function agentLineParts(s: AgentSession, now: Date): string[] {
  if (s.stoppedAt) return [s.agent, "Stopped (key revoked)"];
  const parts = [s.agent];
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

/** The line as text (screen readers, tests). */
export function agentLineText(s: AgentSession, now: Date): string {
  return agentLineParts(s, now).join(" · ");
}

/**
 * The row's quiet mark: "Claude · working" or "Claude · needs you", for an
 * open task with a session in one of those states (ready and failed show on
 * the task's line, not its row). The newest session wins.
 */
export function agentRowMark(
  sessions: readonly AgentSession[],
  task: { status?: unknown; statusCategory?: unknown } | null,
): string | null {
  if (task && isClosedTask(task as Parameters<typeof isClosedTask>[0])) return null;
  let best: AgentSession | null = null;
  for (const s of sessions) {
    if (s.deletedAt || s.stoppedAt) continue;
    if (s.state !== "working" && s.state !== "needs_you") continue;
    if (!best || s.updatedAt > best.updatedAt) best = s;
  }
  return best ? `${best.agent} · ${STATE_WORDS[best.state]}` : null;
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
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [taskId, list] of agentSessionsByTask(sessions)) {
    const task = taskById(taskId);
    if (!task) continue;
    const mark = agentRowMark(list, task);
    if (mark) out.set(taskId, mark);
  }
  return out;
}

/** Can this reader post or clear the session? Only whoever started it. */
export function isOwnSession(s: Pick<AgentSession, "userId">, userId: string | null): boolean {
  return !!userId && s.userId === userId;
}
