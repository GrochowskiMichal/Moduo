import { describe, expect, it } from "vitest";

import type { WorkspaceApiKey } from "../../lib/runtime";
import { keyScope } from "./api-keys";

function makeKey(scopes: Record<string, string> | undefined): WorkspaceApiKey {
  return {
    id: "k1",
    workspaceId: "w1",
    name: "Claude",
    keyPrefix: "mk_live_abc",
    // Runtime-defensive: keyScope tolerates an absent scopes map even though the
    // type marks it required (a malformed row shouldn't crash the list).
    scopes: scopes as Record<string, string>,
    createdAt: "2026-07-11T00:00:00Z",
    lastUsedAt: null,
  };
}

describe("keyScope (AC8 — scope mapping)", () => {
  it("reads 'edit' only when the tasks scope is edit", () => {
    expect(keyScope(makeKey({ tasks: "edit" }))).toBe("edit");
  });

  it("defaults to 'view' for a view scope, a missing tasks scope, or no scopes", () => {
    expect(keyScope(makeKey({ tasks: "view" }))).toBe("view");
    expect(keyScope(makeKey({}))).toBe("view");
    expect(keyScope(makeKey(undefined))).toBe("view");
  });
});
