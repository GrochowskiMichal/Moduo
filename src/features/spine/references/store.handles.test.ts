// The reference store's handle lookups (RF-1, MOD-28): `resolveHandle` reads
// a failed lookup as "not found" (chips, autolinks), `lookupHandle` rejects
// so a deep link can tell offline from gone; a failure is never cached.

import { describe, expect, it, rs } from "@rstest/core";

import { ReferenceStore } from "./store";

function storeWith(resolve: (input: { handle: string }) => Promise<string | null>) {
  const previews = { resolveHandle: rs.fn(resolve) };
  const store = new ReferenceStore({
    context: () =>
      ({
        workspaceId: "w",
        previews,
        taskKey: "MOD",
        personOf: () => null,
        now: () => new Date(),
      }) as never,
    now: () => 0,
  });
  return { store, previews };
}

describe("handle lookups", () => {
  it("answers the task, or null when the server has none", async () => {
    const { store } = storeWith(async ({ handle }) => (handle === "MOD-1" ? "t1" : null));
    expect(await store.lookupHandle("mod-1")).toBe("t1");
    expect(await store.lookupHandle("MOD-2")).toBeNull();
    expect(await store.resolveHandle("MOD-2")).toBeNull();
  });

  it("offline, lookupHandle rejects while resolveHandle still reads null; neither keeps the failure", async () => {
    let online = false;
    const { store, previews } = storeWith(async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return "t5";
    });
    await expect(store.lookupHandle("MOD-5")).rejects.toThrow("Failed to fetch");
    expect(await store.resolveHandle("MOD-5")).toBeNull();
    online = true;
    // Asked again (not the cached failure), and now found.
    expect(await store.lookupHandle("MOD-5")).toBe("t5");
    expect(previews.resolveHandle).toHaveBeenCalledTimes(3);
  });
});
