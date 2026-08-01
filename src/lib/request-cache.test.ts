import { describe, expect, it } from "vitest";

import { createRequestCache } from "./request-cache";

/** A controllable clock so TTL expiry is deterministic. */
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("createRequestCache", () => {
  it("dedupes concurrent reads into a single fetch (in-flight)", async () => {
    const cache = createRequestCache();
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      await Promise.resolve();
      return "v";
    };
    // Two callers before either settles → one underlying fetch.
    const [a, b] = await Promise.all([cache.read("k", fetcher), cache.read("k", fetcher)]);
    expect(a).toBe("v");
    expect(b).toBe("v");
    expect(calls).toBe(1);
  });

  it("with ttl 0 (default), a sequential read after settle re-fetches", async () => {
    const cache = createRequestCache();
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return calls;
    };
    expect(await cache.read("k", fetcher)).toBe(1);
    expect(await cache.read("k", fetcher)).toBe(2); // no retention → fresh
    expect(calls).toBe(2);
  });

  it("caches the resolved value within the TTL, then re-fetches after expiry", async () => {
    const clock = fakeClock();
    const cache = createRequestCache(clock.now);
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return calls;
    };

    expect(await cache.read("k", fetcher, 5_000)).toBe(1);
    clock.advance(4_000);
    expect(await cache.read("k", fetcher, 5_000)).toBe(1); // still cached
    expect(calls).toBe(1);

    clock.advance(2_000); // now 6_000 > 5_000 → expired
    expect(await cache.read("k", fetcher, 5_000)).toBe(2);
    expect(calls).toBe(2);
  });

  it("Infinity TTL caches until invalidated", async () => {
    const clock = fakeClock();
    const cache = createRequestCache(clock.now);
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return calls;
    };

    expect(await cache.read("user", fetcher, Number.POSITIVE_INFINITY)).toBe(1);
    clock.advance(10_000_000);
    expect(await cache.read("user", fetcher, Number.POSITIVE_INFINITY)).toBe(1);
    expect(calls).toBe(1);

    cache.invalidate("user");
    expect(await cache.read("user", fetcher, Number.POSITIVE_INFINITY)).toBe(2);
    expect(calls).toBe(2);
  });

  it("does not cache a rejected fetch — the next caller retries", async () => {
    const cache = createRequestCache();
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return "ok";
    };
    await expect(cache.read("k", fetcher, 5_000)).rejects.toThrow("boom");
    expect(await cache.read("k", fetcher, 5_000)).toBe("ok"); // retried, cached now
    expect(calls).toBe(2);
  });

  it("an invalidate during an in-flight fetch prevents stale repopulation", async () => {
    const cache = createRequestCache();
    let release!: (v: number) => void;
    const gate = new Promise<number>((r) => {
      release = r;
    });
    let calls = 0;
    const fetcher = () => {
      calls += 1;
      return gate; // never settles until we release it
    };
    // Start a read (in flight), then invalidate before it resolves.
    const inflight = cache.read("k", fetcher, Number.POSITIVE_INFINITY);
    cache.invalidate("k");
    release(1);
    expect(await inflight).toBe(1); // the caller still gets its value…
    // …but it was NOT written to the cache (invalidated mid-flight), so the next
    // read re-fetches rather than serving the stale snapshot.
    let second = 0;
    expect(
      await cache.read(
        "k",
        async () => {
          second += 1;
          return 99;
        },
        Number.POSITIVE_INFINITY,
      ),
    ).toBe(99);
    expect(calls).toBe(1);
    expect(second).toBe(1);
  });

  it("keys are isolated; clear drops everything", async () => {
    const cache = createRequestCache();
    let a = 0;
    let b = 0;
    await cache.read(
      "a",
      async () => {
        a += 1;
        return a;
      },
      Number.POSITIVE_INFINITY,
    );
    await cache.read(
      "b",
      async () => {
        b += 1;
        return b;
      },
      Number.POSITIVE_INFINITY,
    );
    // Both cached independently.
    await cache.read(
      "a",
      async () => {
        a += 1;
        return a;
      },
      Number.POSITIVE_INFINITY,
    );
    expect(a).toBe(1);

    cache.clear();
    await cache.read(
      "a",
      async () => {
        a += 1;
        return a;
      },
      Number.POSITIVE_INFINITY,
    );
    expect(a).toBe(2);
  });
});
