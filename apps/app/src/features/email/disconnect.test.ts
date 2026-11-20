import { describe, expect, it } from "@rstest/core";

import { disconnectMailAccount, unsentCopy } from "./disconnect";

describe("disconnectMailAccount", () => {
  it("purges at once with an empty Outbox", async () => {
    const calls: unknown[] = [];
    let purged = 0;
    const ok = await disconnectMailAccount(
      {
        disconnect: async (id, o) => {
          calls.push([id, o]);
          return { status: "purged" as const };
        },
      },
      "a",
      () => {
        throw new Error("must not ask");
      },
      () => (purged += 1),
    );
    expect(ok).toBe(true);
    expect(purged).toBe(1);
    expect(calls).toEqual([["a", undefined]]);
  });

  it("asks first with unsent mail and purges only on yes", async () => {
    const calls: unknown[] = [];
    let proceed: (() => void) | null = null;
    let asked = 0;
    let purged = 0;
    const ok = await disconnectMailAccount(
      {
        disconnect: async (id, o) => {
          calls.push([id, o]);
          return o?.confirmed ? { status: "purged" } : { status: "needs_confirm", unsent: 2 };
        },
      },
      "a",
      (n, go) => {
        asked = n;
        proceed = go;
      },
      () => (purged += 1),
    );
    expect(ok).toBe(false);
    expect(asked).toBe(2);
    expect(purged).toBe(0);
    proceed!();
    await new Promise((r) => setTimeout(r, 0));
    expect(purged).toBe(1);
    expect(calls).toEqual([
      ["a", undefined],
      ["a", { confirmed: true }],
    ]);
    expect(unsentCopy(1)).toBe("1 unsent message will be discarded.");
  });
});
