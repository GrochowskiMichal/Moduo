// D15-11 · the copy dialogs ask whether you may copy their source: the
// answer belongs to that source only, a late answer for another one is
// ignored, and a question that fails leaves it to the server (yes).

import { describe, expect, it } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useCopyAccess } from "./use-copy-access";

type Source = { kind: "task" | "project"; id: string } | null;

function runtimeAnswering(answer: (id: string) => Promise<boolean>) {
  return { tasks: { canCopyTemplateSource: ({ id }: { id: string }) => answer(id) } } as never;
}

describe("useCopyAccess (D15-11)", () => {
  it("asks for the open source, and never shows another source's answer", async () => {
    const pending = new Map<string, (ok: boolean) => void>();
    const runtime = runtimeAnswering(
      (id) => new Promise<boolean>((resolve) => pending.set(id, resolve)),
    );
    const { result, rerender } = renderHook(
      ({ source }: { source: Source }) => useCopyAccess(runtime, source),
      {
        initialProps: { source: { kind: "project", id: "p1" } as Source },
      },
    );
    expect(result.current).toBeNull();
    await act(async () => pending.get("p1")?.(false));
    expect(result.current).toBe(false);

    // Another source: null at once (not p1's "no"), and p1's late answer is ignored.
    rerender({ source: { kind: "project", id: "p2" } });
    expect(result.current).toBeNull();
    await act(async () => pending.get("p1")?.(true));
    expect(result.current).toBeNull();
    await act(async () => pending.get("p2")?.(true));
    expect(result.current).toBe(true);

    rerender({ source: null });
    expect(result.current).toBeNull();
  });

  it("a question that fails, or a runtime without it, leaves it to the server", async () => {
    const failing = runtimeAnswering(() => Promise.reject(new Error("offline")));
    const a = renderHook(() => useCopyAccess(failing, { kind: "task", id: "t1" }));
    await waitFor(() => expect(a.result.current).toBe(true));
    const older = { tasks: {} } as never;
    const b = renderHook(() => useCopyAccess(older, { kind: "task", id: "t1" }));
    await waitFor(() => expect(b.result.current).toBe(true));
  });
});
