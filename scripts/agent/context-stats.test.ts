import { describe, expect, it } from "bun:test";

import { projectSlug, sessionContext, summarize } from "./context-stats.ts";

// The context numbers of a session (2026-11-26 context diet): what its first call carried, what
// it carried at the first edit and at its peak. Synthetic transcripts in Claude Code's shape.
const call = (id: string, input: number, content: object[], extra: object = {}) =>
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-11-24T10:00:00.000Z",
    message: {
      id,
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: input - 10,
      },
      content,
    },
    ...extra,
  });
const text = { type: "text", text: "hello" };
const tool = (name: string, input: object) => ({ type: "tool_use", name, input });

describe("sessionContext", () => {
  it("reads the first call, the first edit and the peak", () => {
    const s = sessionContext([
      JSON.stringify({ type: "user", timestamp: "2026-11-24T09:59:00.000Z" }),
      call("a", 100_000, [text]),
      call("b", 120_000, [tool("Read", { file_path: "/repo/x.ts" })]),
      call("c", 160_000, [tool("Edit", { file_path: "/repo/x.ts" })]),
      call("d", 250_000, [text]),
      call("e", 90_000, [tool("Edit", { file_path: "/repo/y.ts" })]),
    ]);
    expect(s).toEqual({
      start: "2026-11-24T09:59:00.000Z",
      calls: 5,
      entrance: 100_000,
      atFirstEdit: 160_000,
      callsToFirstEdit: 3,
      peak: 250_000,
    });
  });

  it("counts a call once though it is written as one line per content block", () => {
    const s = sessionContext([
      call("a", 50_000, [text]),
      call("a", 50_000, [tool("Read", {})]),
      call("b", 60_000, [text]),
      call("c", 70_000, [text]),
    ]);
    expect(s?.calls).toBe(3);
    expect(s?.atFirstEdit).toBeNull();
  });

  it("takes a Code Mode script that edits as an edit, but not a scratchpad or memory write", () => {
    const repl = (code: string) => tool("REPL", { code });
    const s = sessionContext([
      call("a", 50_000, [repl("await write('/tmp/scratchpad/notes.md', x)")]),
      call("b", 60_000, [repl("await edit(W + '/src/a.ts', 'x', 'y')")]),
      call("c", 70_000, [text]),
    ]);
    expect(s?.callsToFirstEdit).toBe(2);
    expect(s?.atFirstEdit).toBe(60_000);
  });

  it("leaves out subagent lines, broken lines and sessions that barely started", () => {
    expect(
      sessionContext([
        "not json",
        call("a", 50_000, [text]),
        call("s", 900_000, [tool("Edit", {})], { isSidechain: true }),
        call("b", 60_000, [text]),
        call("c", 70_000, [text]),
      ])?.peak,
    ).toBe(70_000);
    expect(sessionContext([call("a", 50_000, [text]), call("b", 60_000, [text])])).toBeNull();
  });
});

describe("summarize", () => {
  const s = (start: string, entrance: number, atFirstEdit: number | null) => ({
    start,
    calls: 10,
    entrance,
    atFirstEdit,
    callsToFirstEdit: atFirstEdit === null ? null : 4,
    peak: entrance * 2,
  });
  const from = new Date("2026-11-23T00:00:00Z");
  const to = new Date("2026-11-30T00:00:00Z");

  it("takes medians over the window, first-edit figures over the sessions that edited", () => {
    const sum = summarize(
      [
        s("2026-11-24T10:00:00Z", 100, 150),
        s("2026-11-25T10:00:00Z", 200, null),
        s("2026-11-26T10:00:00Z", 300, 350),
        s("2026-11-10T10:00:00Z", 9000, 9000),
      ],
      from,
      to,
    );
    expect(sum).toEqual({
      sessions: 3,
      entrance: 200,
      atFirstEdit: 250,
      callsToFirstEdit: 4,
      peak: 400,
    });
  });

  it("is null for a week with no sessions", () => {
    expect(summarize([s("2026-11-10T10:00:00Z", 1, 1)], from, to)).toBeNull();
  });
});

describe("projectSlug", () => {
  it("matches Claude Code's folder name for a checkout and its worktrees", () => {
    const root = projectSlug("/Users/me/Documents/moduo_latest");
    expect(root).toBe("-Users-me-Documents-moduo-latest");
    expect(
      projectSlug("/Users/me/Documents/moduo_latest/.claude/worktrees/x").startsWith(root),
    ).toBe(true);
  });
});
