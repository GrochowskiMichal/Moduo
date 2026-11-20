// TS-1 smoke test: the pinned TanStack DB and Pacer resolve, build a local
// collection, answer a live query and debounce, before any app code uses them
// (specs/tanstack-spine.md). TS-2 replaces this with the kernel adapter's tests.
import { describe, expect, it } from "@rstest/core";
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  localOnlyCollectionOptions,
} from "@tanstack/db";
import { Debouncer } from "@tanstack/pacer";
import { useLiveQuery } from "@tanstack/react-db";
import { useDebouncedCallback } from "@tanstack/react-pacer";

type Row = { id: string; title: string; done: boolean };

describe("TanStack DB + Pacer smoke", () => {
  it("resolves the React adapters", () => {
    expect(typeof useLiveQuery).toBe("function");
    expect(typeof useDebouncedCallback).toBe("function");
  });

  it("answers a live query over a local collection and follows an update", async () => {
    const rows = createCollection(
      localOnlyCollectionOptions<Row>({
        getKey: (r) => r.id,
        initialData: [
          { id: "a", title: "One", done: false },
          { id: "b", title: "Two", done: true },
        ],
      }),
    );
    const open = createLiveQueryCollection((q) =>
      q.from({ r: rows }).where(({ r }) => eq(r.done, false)),
    );
    await open.preload();
    expect(open.toArray.map((r) => r.id)).toEqual(["a"]);

    rows.update("b", (draft) => {
      draft.done = false;
    });
    expect(open.toArray.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("debounces with Pacer", async () => {
    const seen: number[] = [];
    const d = new Debouncer((n: number) => seen.push(n), { wait: 10 });
    d.maybeExecute(1);
    d.maybeExecute(2);
    await new Promise((r) => setTimeout(r, 30));
    expect(seen).toEqual([2]);
  });
});
