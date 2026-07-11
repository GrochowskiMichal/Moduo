// Pins the DF-5 grammar contract: neutral toast() voice, the 8s window, Undo
// in the action slot, and the destructive escalation NEVER in sonner's
// `cancel` slot (critique §8.3 — a destructive verb in the dismiss position).
import { describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => {
  const fn = vi.fn((..._args: unknown[]) => "toast-1");
  return Object.assign(fn, { dismiss: vi.fn() });
});
vi.mock("sonner", () => ({ toast: toastMock }));

import { UNDO_TOAST_MS, undoToast } from "./undo-toast";

describe("undoToast", () => {
  it("uses the neutral voice with the standard 8s window and an Undo action", () => {
    const onUndo = vi.fn();
    undoToast("Task deleted", { onUndo });
    expect(toastMock).toHaveBeenCalledWith(
      "Task deleted",
      expect.objectContaining({
        duration: UNDO_TOAST_MS,
        action: expect.objectContaining({ label: "Undo", onClick: onUndo }),
      }),
    );
    expect(UNDO_TOAST_MS).toBe(8000);
  });

  it("never puts the destructive escalation in the cancel slot", () => {
    undoToast("Moved to Trash", {
      onUndo: vi.fn(),
      danger: { label: "Delete task too", onClick: vi.fn() },
    });
    const opts = toastMock.mock.calls.at(-1)?.[1] as unknown as Record<string, unknown>;
    expect(opts.cancel).toBeUndefined();
    // The escalation rides the description body instead.
    expect(opts.description).toBeTruthy();
  });

  it("dismisses the toast before running the escalation", () => {
    const onDanger = vi.fn();
    undoToast("Moved to Trash", {
      onUndo: vi.fn(),
      danger: { label: "Delete tasks too", onClick: onDanger },
    });
    const opts = toastMock.mock.calls.at(-1)?.[1] as unknown as {
      description: { props: { children: [unknown, { props: { onClick: () => void } }] } };
    };
    // Fire the embedded button's onClick (second child of the description span).
    opts.description.props.children[1].props.onClick();
    expect(toastMock.dismiss).toHaveBeenCalledWith("toast-1");
    expect(onDanger).toHaveBeenCalledOnce();
  });
});
