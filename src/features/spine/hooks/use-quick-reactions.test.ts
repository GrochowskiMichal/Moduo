// CV-7c (CH16a): your quick row keeps the latest save when answers arrive out
// of order.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, renderHook } from "@testing-library/react";

const fake = rs.hoisted(() => {
  type Prefs = { reactionRow: string[] | null };
  const deferred = () => {
    let resolve!: (p: Prefs) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<Prefs>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const state = {
    loads: [] as ReturnType<typeof deferred>[],
    saves: [] as ReturnType<typeof deferred>[],
  };
  const chat = {
    myPrefs: () => {
      const d = deferred();
      state.loads.push(d);
      return d.promise;
    },
    setMyPrefs: (_patch: Prefs) => {
      const d = deferred();
      state.saves.push(d);
      return d.promise;
    },
  };
  return { state, chat };
});

rs.mock("@/lib/runtime", () => ({ getRuntime: () => ({ chat: fake.chat }) }));

import { resetQuickReactionsForTest, saveQuickRow, useQuickReactions } from "./use-quick-reactions";

const flush = () => act(async () => {});

beforeEach(() => {
  resetQuickReactionsForTest();
  fake.state.loads.length = 0;
  fake.state.saves.length = 0;
});
afterEach(cleanup);

describe("your quick row (CV-7c)", () => {
  it("keeps a save when the first load answers after it", async () => {
    const { result } = renderHook(() => useQuickReactions("u1"));
    expect(fake.state.loads).toHaveLength(1);
    let saving!: Promise<void>;
    act(() => {
      saving = saveQuickRow(["🎉"]);
    });
    expect(result.current.saved).toEqual(["🎉"]);
    // The load started before the save answers late with the old row.
    fake.state.loads[0].resolve({ reactionRow: ["👀"] });
    await flush();
    expect(result.current.saved).toEqual(["🎉"]);
    fake.state.saves[0].resolve({ reactionRow: ["🎉"] });
    await act(async () => saving);
    expect(result.current.saved).toEqual(["🎉"]);
  });

  it("keeps the newer save when an older one fails after it", async () => {
    const { result } = renderHook(() => useQuickReactions("u1"));
    fake.state.loads[0].resolve({ reactionRow: null });
    await flush();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = saveQuickRow(["🎉"]);
      second = saveQuickRow(["🙏"]);
    });
    fake.state.saves[1].resolve({ reactionRow: ["🙏"] });
    await act(async () => second);
    fake.state.saves[0].reject(new Error("offline"));
    await act(async () => {
      await expect(first).rejects.toThrow("offline");
    });
    expect(result.current.saved).toEqual(["🙏"]);
  });

  it("puts the old row back when the latest save fails", async () => {
    const { result } = renderHook(() => useQuickReactions("u1"));
    fake.state.loads[0].resolve({ reactionRow: ["👀"] });
    await flush();
    let saving!: Promise<void>;
    act(() => {
      saving = saveQuickRow(["🎉"]);
    });
    expect(result.current.saved).toEqual(["🎉"]);
    fake.state.saves[0].reject(new Error("offline"));
    await act(async () => {
      await expect(saving).rejects.toThrow("offline");
    });
    expect(result.current.saved).toEqual(["👀"]);
  });
});
