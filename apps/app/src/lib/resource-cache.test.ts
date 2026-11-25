import { describe, expect, it } from "@rstest/core";

import { createIdentityGate, createResourceCache } from "./resource-cache";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("resource cache (session-lived reads)", () => {
  it("is empty and not loading before any read", () => {
    const cache = createResourceCache();
    expect(cache.peek("k")).toEqual({
      data: undefined,
      loading: false,
      error: false,
      refreshing: false,
    });
  });

  it("loads only while there is no value; a refresh keeps the last value showing", async () => {
    const cache = createResourceCache();
    const first = deferred<number>();
    const p1 = cache.fetch("k", () => first.promise);
    expect(cache.peek("k").loading).toBe(true);
    first.resolve(1);
    await p1;
    expect(cache.peek("k")).toMatchObject({ data: 1, loading: false, refreshing: false });

    const second = deferred<number>();
    const p2 = cache.fetch("k", () => second.promise);
    expect(cache.peek("k")).toMatchObject({ data: 1, loading: false, refreshing: true });
    second.resolve(2);
    await p2;
    expect(cache.peek("k").data).toBe(2);
  });

  it("keeps the same snapshot object until something changes", async () => {
    const cache = createResourceCache();
    await cache.fetch("k", async () => 1);
    const a = cache.peek("k");
    expect(cache.peek("k")).toBe(a);
  });

  it("the latest read wins when answers arrive out of order", async () => {
    const cache = createResourceCache();
    const old = deferred<string>();
    const fresh = deferred<string>();
    const p1 = cache.fetch("k", () => old.promise);
    const p2 = cache.fetch("k", () => fresh.promise);
    fresh.resolve("fresh");
    await p2;
    old.resolve("old");
    await p1;
    expect(cache.peek("k").data).toBe("fresh");
  });

  it("shares a read in flight only with a caller giving the same tag", async () => {
    const cache = createResourceCache();
    let calls = 0;
    const gate = deferred<number>();
    const fetcher = () => {
      calls += 1;
      return gate.promise;
    };
    const a = cache.fetch("k", fetcher, { shareTag: "mount:0" });
    const b = cache.fetch("k", fetcher, { shareTag: "mount:0" });
    expect(calls).toBe(1);
    void cache.fetch("k", fetcher, { shareTag: "mount:1" });
    expect(calls).toBe(2);
    gate.resolve(1);
    await Promise.all([a, b]);
  });

  it("a failed read keeps the last good value and flags the error", async () => {
    const cache = createResourceCache();
    await cache.fetch("k", async () => "good");
    await cache.fetch("k", async () => {
      throw new Error("offline");
    });
    expect(cache.peek("k")).toMatchObject({ data: "good", error: true, loading: false });
  });

  it("notifies subscribers of the key only", async () => {
    const cache = createResourceCache();
    let a = 0;
    let b = 0;
    const offA = cache.subscribe("a", () => (a += 1));
    cache.subscribe("b", () => (b += 1));
    await cache.fetch("a", async () => 1);
    expect(a).toBeGreaterThan(0);
    expect(b).toBe(0);
    offA();
    const before = a;
    cache.set("a", 2);
    expect(a).toBe(before);
  });

  it("clear drops every value and ignores reads still in flight", async () => {
    const cache = createResourceCache();
    cache.set("k", "mine");
    const late = deferred<string>();
    const p = cache.fetch("k", () => late.promise);
    cache.clear();
    late.resolve("someone else's");
    await p;
    expect(cache.peek("k").data).toBeUndefined();
  });

  it("a tab refocus's SIGNED_IN for the same person keeps every value", () => {
    const cache = createResourceCache();
    const gate = createIdentityGate(cache);
    gate("INITIAL_SESSION", "u1");
    cache.set("k", "mine");
    gate("SIGNED_IN", "u1");
    gate("TOKEN_REFRESHED", "u1");
    gate("USER_UPDATED", "u1");
    expect(cache.peek("k").data).toBe("mine");
  });

  it("a different person or a sign-out drops every value", () => {
    const cache = createResourceCache();
    const gate = createIdentityGate(cache);
    gate("SIGNED_IN", "u1");
    cache.set("k", "u1's");
    gate("SIGNED_IN", "u2");
    expect(cache.peek("k").data).toBeUndefined();
    cache.set("k", "u2's");
    gate("SIGNED_OUT", null);
    expect(cache.peek("k").data).toBeUndefined();
  });
});
