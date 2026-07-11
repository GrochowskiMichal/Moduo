// DF-2 — the /email deep-link search: validate `?thread=` and resolve an
// inbound id (raw threadId OR `email_thread` ref id) to a select target.

import { describe, expect, it } from "vitest";
import { resolveEmailThreadTarget, validateEmailSearch } from "./url-search";

describe("validateEmailSearch", () => {
  it("keeps a non-empty thread id", () => {
    expect(validateEmailSearch({ thread: "t1" })).toEqual({ thread: "t1" });
  });

  it("drops empty / non-string / missing thread", () => {
    expect(validateEmailSearch({ thread: "" })).toEqual({});
    expect(validateEmailSearch({ thread: 7 })).toEqual({});
    expect(validateEmailSearch({})).toEqual({});
  });
});

describe("resolveEmailThreadTarget", () => {
  const threads = [{ threadId: "thread:1" }, { threadId: "thread:2" }];
  const refs = [
    { id: "ref-a", threadKey: "thread:1" },
    { id: "ref-b", threadKey: "thread:9" }, // tissue but not in the synced list
  ];

  it("resolves a ref/entity id to its raw threadKey (what the widget carries)", () => {
    expect(resolveEmailThreadTarget("ref-a", { threads, refs })).toEqual({
      kind: "thread",
      threadId: "thread:1",
      refId: "ref-a",
    });
  });

  it("resolves a ref whose thread isn't in the synced list (web tissue card)", () => {
    expect(resolveEmailThreadTarget("ref-b", { threads, refs })).toEqual({
      kind: "thread",
      threadId: "thread:9",
      refId: "ref-b",
    });
  });

  it("resolves a raw threadId, attaching its ref id when it's tissue", () => {
    expect(resolveEmailThreadTarget("thread:1", { threads, refs })).toEqual({
      kind: "thread",
      threadId: "thread:1",
      refId: "ref-a",
    });
  });

  it("resolves a raw threadId with no tissue ref (refId null)", () => {
    expect(resolveEmailThreadTarget("thread:2", { threads, refs })).toEqual({
      kind: "thread",
      threadId: "thread:2",
      refId: null,
    });
  });

  it("returns none for an unknown id or an empty id", () => {
    expect(resolveEmailThreadTarget("nope", { threads, refs })).toEqual({ kind: "none" });
    expect(resolveEmailThreadTarget("", { threads, refs })).toEqual({ kind: "none" });
  });
});
