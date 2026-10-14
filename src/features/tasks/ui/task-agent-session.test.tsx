// The agent session line (TV-D16, MOD-119): it may wrap, but no single item
// is ever wider than the line, so a long note or link label shortens with an
// ellipsis instead of widening the panel or Focus's Now card.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

rs.mock("../assignees", () => ({
  useAssignees: () => ({ assignees: [], currentUserId: "u1", byId: () => null }),
}));

import type { ModuoRuntime } from "@/lib/runtime.types";
import { TooltipProvider } from "../../../components/ui/tooltip";
import type { AgentSession } from "../../spine/agent-session";
import { AgentSessionLines } from "./task-agent-session";

afterEach(cleanup);

const LONG = "release-channel-".repeat(5);

function session(over: Partial<AgentSession> = {}): AgentSession {
  const now = new Date().toISOString();
  return {
    id: "s1",
    workspaceId: "w",
    taskId: "t1",
    userId: "u1",
    agent: "Claude",
    state: "needs_you",
    note: `Prod desktop build published to ${LONG}latest`,
    step: 3,
    steps: 5,
    links: [1, 2, 3].map((n) => ({
      url: `https://example.com/${n}`,
      label: `Pull request ${n}: ${LONG}`.slice(0, 80),
    })),
    earlier: [{ at: now, state: "working", note: "Building" }],
    summaryAt: null,
    summaryPostedAt: null,
    startedAt: now,
    updatedAt: now,
    stoppedAt: null,
    ...over,
  };
}

function renderLine(s: AgentSession) {
  const runtime = { tasks: { dismissAgentSession: rs.fn() } } as unknown as ModuoRuntime;
  render(
    <TooltipProvider>
      <AgentSessionLines taskId="t1" workspaceId="w" sessions={[s]} userId="u1" runtime={runtime} />
    </TooltipProvider>,
  );
  return document.querySelector('[data-slot="agent-session-line"]') as HTMLElement;
}

describe("the agent session line never widens its column (MOD-119)", () => {
  it("wraps, and every item can shrink: a long note, three long links, Fold and ×", () => {
    const line = renderLine(session());
    expect(line.className).toContain("flex-wrap");
    expect(line.className).toContain("min-w-0");
    expect(screen.getByRole("button", { name: "1 earlier" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear this line" })).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(3);

    for (const item of Array.from(line.children) as HTMLElement[]) {
      if (item.classList.contains("sr-only")) continue;
      // × is a fixed 16 px icon: it can't outgrow any line.
      if (item.getAttribute("aria-label") === "Clear this line") continue;
      expect(item.className, item.textContent ?? "").toContain("min-w-0");
      expect(item.className, item.textContent ?? "").toContain("max-w-full");
      const shortens = item.classList.contains("truncate") || !!item.querySelector(".truncate");
      expect(shortens, item.textContent ?? "").toBe(true);
    }
  });

  it("keeps the full words on hover: the note's line and each link's label", () => {
    const s = session();
    const line = renderLine(s);
    const head = line.querySelector("[title]") as HTMLElement;
    expect(head.getAttribute("title")).toContain(s.note ?? "");
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("title")).toMatch(/^Pull request \d: /);
      expect(link.querySelector(".truncate")?.className).toContain("max-w-40");
    }
  });
});
