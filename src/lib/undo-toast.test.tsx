// Pins the DF-5 grammar contract: neutral toast() voice, the 8s window, Undo
// in the action slot, and the destructive escalation NEVER in sonner's
// `cancel` slot (critique §8.3 — a destructive verb in the dismiss position).
import { describe, expect, it, rs } from "@rstest/core";

const toastMock = rs.hoisted(() => {
  const fn = rs.fn((..._args: unknown[]) => "toast-1");
  return Object.assign(fn, { dismiss: rs.fn() });
});
rs.mock("sonner", () => ({ toast: toastMock }));

import { UNDO_TOAST_MS, undoToast } from "./undo-toast";

describe("undoToast", () => {
  it("uses the neutral voice with the standard 8s window and an Undo action", () => {
    const onUndo = rs.fn();
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
      onUndo: rs.fn(),
      danger: { label: "Delete task too", onClick: rs.fn() },
    });
    const opts = toastMock.mock.calls.at(-1)?.[1] as unknown as Record<string, unknown>;
    expect(opts.cancel).toBeUndefined();
    // The escalation rides the description body instead.
    expect(opts.description).toBeTruthy();
  });

  it("dismisses the toast before running the escalation", () => {
    const onDanger = rs.fn();
    undoToast("Moved to Trash", {
      onUndo: rs.fn(),
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

  type CloseOpts = {
    action: { onClick: () => void };
    onAutoClose?: () => void;
    onDismiss?: () => void;
  };
  const lastOpts = () => toastMock.mock.calls.at(-1)?.[1] as unknown as CloseOpts;

  it("runs onCommit once when the toast closes without Undo", () => {
    const onCommit = rs.fn();
    undoToast("Bucket deleted", { onUndo: rs.fn(), onCommit });
    const opts = lastOpts();
    opts.onAutoClose?.();
    opts.onDismiss?.(); // a late dismiss of the same toast doesn't commit twice
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it("commits when the toast is swiped or dismissed away", () => {
    const onCommit = rs.fn();
    undoToast("Bucket deleted", { onUndo: rs.fn(), onCommit });
    lastOpts().onDismiss?.();
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it("never commits after Undo", () => {
    const onUndo = rs.fn();
    const onCommit = rs.fn();
    undoToast("Bucket deleted", { onUndo, onCommit });
    const opts = lastOpts();
    opts.action.onClick();
    opts.onDismiss?.();
    opts.onAutoClose?.();
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("adds no close callbacks without onCommit", () => {
    undoToast("Task deleted", { onUndo: rs.fn() });
    const opts = lastOpts();
    expect(opts.onAutoClose).toBeUndefined();
    expect(opts.onDismiss).toBeUndefined();
  });
});
