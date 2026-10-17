import { describe, expect, it } from "@rstest/core";
import { type Draft, type DraftEffect, draftReducer, hasDraftContent } from "./draft-note";

const A: Draft = { id: "a", parentId: null };
const B: Draft = { id: "b", parentId: null };

/** Run a sequence of events, collecting every effect in order. */
function run(events: Parameters<typeof draftReducer>[1][]) {
  let draft: Draft | null = null;
  const effects: DraftEffect[] = [];
  for (const e of events) {
    const step = draftReducer(draft, e);
    draft = step.draft;
    effects.push(...step.effects);
  }
  return { draft, effects };
}

describe("lazy create — draft lifecycle (NR-2, AC3)", () => {
  it("drops an untouched draft on navigation, with no create", () => {
    const { draft, effects } = run([
      { type: "open", draft: A },
      { type: "navigate", toId: "some-other-note" },
    ]);
    expect(draft).toBeNull();
    expect(effects).toEqual([{ type: "discard", id: "a" }]);
  });

  it("drops an untouched draft when the note closes entirely", () => {
    const { effects } = run([
      { type: "open", draft: A },
      { type: "navigate", toId: null },
    ]);
    expect(effects).toEqual([{ type: "discard", id: "a" }]);
  });

  it("creates exactly once on the first character, however much follows", () => {
    const { draft, effects } = run([
      { type: "open", draft: A },
      { type: "navigate", toId: "a" },
      { type: "content", id: "a" },
      { type: "content", id: "a" },
      { type: "content", id: "a" },
      { type: "navigate", toId: "elsewhere" },
    ]);
    expect(draft).toBeNull();
    expect(effects).toEqual([{ type: "materialize", draft: A }]);
  });

  it("keeps only the draft you typed into after a double ⌘N", () => {
    const { effects } = run([
      { type: "open", draft: A },
      { type: "open", draft: B },
      { type: "navigate", toId: "b" },
      { type: "content", id: "b" },
    ]);
    expect(effects).toEqual([
      { type: "discard", id: "a" },
      { type: "materialize", draft: B },
    ]);
  });

  it("ignores content events for a note that is not the draft", () => {
    const { draft, effects } = run([
      { type: "open", draft: A },
      { type: "content", id: "real-note" },
    ]);
    expect(draft).toEqual(A);
    expect(effects).toEqual([]);
  });

  it("carries the parent through to the create for a child draft", () => {
    const child: Draft = { id: "c", parentId: "page" };
    const { effects } = run([
      { type: "open", draft: child },
      { type: "content", id: "c" },
    ]);
    expect(effects).toEqual([{ type: "materialize", draft: child }]);
  });

  it("does not count the editor's empty bootstrap paragraph as content", () => {
    expect(hasDraftContent("")).toBe(false);
    expect(hasDraftContent("\n  \n")).toBe(false);
    expect(hasDraftContent("h")).toBe(true);
  });
});
