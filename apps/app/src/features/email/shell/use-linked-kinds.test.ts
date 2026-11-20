import { describe, expect, it } from "@rstest/core";

import { mergeLinkedKinds } from "./use-linked-kinds";

describe("mergeLinkedKinds (decision 7)", () => {
  it("replaces the window's threads, keeps the rest and unchanged identities", () => {
    const task = ["task" as const];
    const cache = { a: task, b: ["note" as const], outside: ["task" as const] };
    const next = mergeLinkedKinds(cache, ["a", "b", "c"], { a: ["task"], c: ["note"] });
    expect(next).toEqual({ a: ["task"], c: ["note"], outside: ["task"] });
    expect(next.a).toBe(task);
    // Nothing changed: the same object back, so the store doesn't notify.
    expect(mergeLinkedKinds(next, ["a"], { a: ["task"] })).toBe(next);
  });
});
