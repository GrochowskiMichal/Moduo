// The agent session line (TV-D16, MOD-119), as round-1c's rows draw it: a
// chip with its controls at the row's right end, one sentence that shortens,
// and the links (inline when there's one, a wrapping row of small chips when
// there are more). No item is ever wider than the line, so a long note or link
// label shortens with an ellipsis instead of widening the panel or Focus.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, within } from "@testing-library/react";

rs.mock("../assignees", () => ({
  useAssignees: () => ({ assignees: [], currentUserId: "u1", byId: () => null }),
}));

import type { ModuoRuntime } from "@/lib/runtime.types";
import { TooltipProvider } from "../../../components/ui/tooltip";
import type { AgentSession } from "../../spine/agent-session";
import { AgentSessionLines } from "./task-agent-session";

afterEach(cleanup);

const LONG = "release-channel-".repeat(5);
const NOTE = `Prod desktop build published to ${LONG}latest`;

function session(over: Partial<AgentSession> = {}): AgentSession {
  const now = new Date().toISOString();
  return {
    id: "s1",
    workspaceId: "w",
    taskId: "t1",
    userId: "u1",
    agent: "Claude",
    state: "needs_you",
    note: NOTE,
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
  const line = document.querySelector('[data-slot="agent-session-line"]') as HTMLElement;
  return {
    line,
    chip: line.querySelector('[data-slot="agent-session-chip"]') as HTMLElement,
    sentence: line.querySelector('[data-slot="agent-session-sentence"]') as HTMLElement,
  };
}

describe("the agent session line, as round-1c's rows (MOD-119)", () => {
  it("a chip with Fold and × at its row's right end, then one sentence that shortens", () => {
    const { chip, sentence } = renderLine(session());
    expect(chip.textContent).toBe("Claude · needs you");
    expect(chip.dataset.tone).toBe("loud");
    expect(chip.className).toContain("min-w-0");
    expect(chip.className).toContain("max-w-full");
    // Fold and × share the chip's row, pushed to its end.
    const row = chip.parentElement as HTMLElement;
    const fold = within(row).getByRole("button", { name: "1 earlier" });
    const clear = within(row).getByRole("button", { name: "Clear this line" });
    expect(fold.closest(".ml-auto")).toBe(clear.closest(".ml-auto"));
    expect(fold.closest(".ml-auto")).toBeTruthy();
    // One sentence, no leading "·", cut with an ellipsis, the full line on hover.
    expect(sentence.textContent).toBe(`Needs you: ${NOTE} · step 3 of 5 · just now`);
    expect(sentence.className).toContain("min-w-0");
    expect(sentence.className).toContain("max-w-full");
    expect(sentence.className).toContain("truncate");
    expect(sentence.getAttribute("title")).toBe(
      `Claude · Needs you: ${NOTE} · step 3 of 5 · just now`,
    );
  });

  it("several links: one wrapping row of small chips under the sentence, none wider than the line", () => {
    const { line, sentence } = renderLine(session());
    const row = line.querySelector('[data-slot="agent-session-links"]') as HTMLElement;
    expect(row.className).toContain("flex-wrap");
    const links = within(row).getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(within(sentence.parentElement as HTMLElement).queryAllByRole("link")).toHaveLength(0);
    for (const link of links) {
      expect(link.className).toContain("min-w-0");
      expect(link.className).toContain("max-w-full");
      expect(link.textContent?.startsWith("·")).toBe(false);
      expect(link.getAttribute("title")).toMatch(/^Pull request \d: /);
      const label = link.querySelector(".truncate") as HTMLElement;
      expect(label.className).toContain("max-w-40");
    }
  });

  it("one link: inline at the end of the sentence's row, its label shortened", () => {
    const { line, sentence } = renderLine(
      session({ links: [{ url: "https://example.com/pr", label: `Desktop release ${LONG}` }] }),
    );
    expect(line.querySelector('[data-slot="agent-session-links"]')).toBeNull();
    const link = within(sentence.parentElement as HTMLElement).getByRole("link");
    expect(link.className).toContain("min-w-0");
    expect(link.className).toContain("max-w-full");
    expect(link.querySelector(".truncate")?.className).toContain("max-w-40");
  });

  it("marks the state: a dot while working or waiting, a check when ready, an x when failed", () => {
    const { chip } = renderLine(session({ state: "working", note: "Writing tests" }));
    expect(chip.textContent).toBe("Claude · working");
    expect(chip.querySelector(".rounded-full")).toBeTruthy();
    cleanup();
    expect(
      renderLine(session({ state: "ready" })).chip.querySelector(".lucide-circle-check"),
    ).toBeTruthy();
    cleanup();
    expect(
      renderLine(session({ state: "failed" })).chip.querySelector(".lucide-circle-x"),
    ).toBeTruthy();
  });
});
