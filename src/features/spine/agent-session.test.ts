// AC3.4 · "status not conversation; private by default" (specs/tasks-v3.md
// §Tests: src/features/spine/agent-session.test.ts). Who reads a session is
// the server's (RLS: supabase/tests/agent_sessions.test.sql); this covers the
// one line, the row mark and the silence rule.

import { describe, expect, it } from "@rstest/core";

import {
  type AgentSession,
  agentLineParts,
  agentLineText,
  agentRowMark,
  agentRowMarks,
  isOwnSession,
  linkWords,
  silenceWords,
} from "./agent-session";

const NOW = new Date("2030-01-01T12:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const session = (extra: Partial<AgentSession> = {}): AgentSession => ({
  id: "s1",
  workspaceId: "w",
  taskId: "t1",
  userId: "alex",
  agent: "Claude",
  state: "working",
  note: "Writing tests",
  step: 3,
  steps: 5,
  links: [{ url: "https://github.com/x/y/pull/42", label: "PR #42" }],
  earlier: [],
  summaryAt: null,
  summaryPostedAt: null,
  startedAt: ago(20),
  updatedAt: ago(2),
  stoppedAt: null,
  ...extra,
});

describe("the one line under the title", () => {
  it("reads agent · what it's doing · step n of m · when", () => {
    expect(agentLineText(session(), NOW)).toBe("Claude · Writing tests · step 3 of 5 · 2m ago");
  });

  it("names the loud states, with the note", () => {
    expect(agentLineText(session({ state: "needs_you", note: "Which branch?", step: null, steps: null }), NOW)).toBe(
      "Claude · Needs you: Which branch? · 2m ago",
    );
    expect(agentLineParts(session({ state: "ready", note: null }), NOW)[1]).toBe("Ready for review");
    expect(agentLineParts(session({ state: "failed", note: "CI is down" }), NOW)[1]).toBe("Failed: CI is down");
  });

  it("says 'No update for 40m' after 30 quiet minutes, and no earlier", () => {
    expect(silenceWords(session({ updatedAt: ago(29) }), NOW)).toBeNull();
    expect(silenceWords(session({ updatedAt: ago(40) }), NOW)).toBe("No update for 40m");
    expect(agentLineText(session({ updatedAt: ago(40) }), NOW)).toBe(
      "Claude · Writing tests · step 3 of 5 · No update for 40m",
    );
    // Only while working: waiting on its person isn't silence.
    expect(silenceWords(session({ state: "needs_you", updatedAt: ago(90) }), NOW)).toBeNull();
  });

  it("reads 'Stopped (key revoked)' once the key is gone", () => {
    expect(agentLineText(session({ stoppedAt: ago(1) }), NOW)).toBe("Claude · Stopped (key revoked)");
  });

  it("shows a link by its label, else its host", () => {
    expect(linkWords({ url: "https://github.com/x/y/pull/42", label: "PR #42" })).toBe("PR #42");
    expect(linkWords({ url: "https://ci.example.com/run/9" })).toBe("ci.example.com");
  });
});

describe("the row's quiet mark", () => {
  it("is 'Claude · working' or 'Claude · needs you' on an open task", () => {
    expect(agentRowMark([session()], { status: "todo", statusCategory: "todo" })).toBe("Claude · working");
    expect(agentRowMark([session({ state: "needs_you" })], { status: "todo" })).toBe("Claude · needs you");
  });

  it("isn't there for ready, failed, stopped or a closed task", () => {
    expect(agentRowMark([session({ state: "ready" })], { status: "todo" })).toBeNull();
    expect(agentRowMark([session({ state: "failed" })], { status: "todo" })).toBeNull();
    expect(agentRowMark([session({ stoppedAt: ago(1) })], { status: "todo" })).toBeNull();
    expect(agentRowMark([session()], { status: "done", statusCategory: "done" })).toBeNull();
  });

  it("the newest live session wins; marks only for tasks the reader has", () => {
    const marks = agentRowMarks(
      [
        session({ id: "a", agent: "Cursor", updatedAt: ago(10) }),
        session({ id: "b", agent: "Claude", state: "needs_you", updatedAt: ago(1) }),
        session({ id: "c", taskId: "gone" }),
      ],
      (id) => (id === "t1" ? { status: "todo" } : null),
    );
    expect([...marks]).toEqual([["t1", "Claude · needs you"]]);
  });
});

describe("whose it is", () => {
  it("only whoever started it posts or clears it", () => {
    expect(isOwnSession(session(), "alex")).toBe(true);
    expect(isOwnSession(session(), "sam")).toBe(false);
    expect(isOwnSession(session(), null)).toBe(false);
  });
});
