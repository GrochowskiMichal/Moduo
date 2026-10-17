// CV-14 · Wrap up's "Also mark as decision": its default follows the
// conversation's link while the dialog is open, until you change it.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { message } from "../store/testing";
import { WrapUpDialog } from "./chain-dialogs";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(cleanup);

const C = "00000000-0000-4000-8000-0000000000c1";
const replies = [
  message("00000000-0000-4000-8000-000000000002", C, "2026-10-16T10:00:00Z", {
    body: "round",
    parentId: "00000000-0000-4000-8000-000000000001",
  }),
];

function dialog(linked: boolean, canDecide: boolean, onConfirm = rs.fn()) {
  return (
    <WrapUpDialog
      open
      onOpenChange={() => {}}
      replies={replies}
      loaded
      linked={linked}
      canDecide={canDecide}
      personOf={() => undefined}
      onConfirm={onConfirm}
    />
  );
}

const tick = () => screen.queryByRole("checkbox", { name: "Also mark as decision" });

describe("WrapUpDialog · Also mark as decision", () => {
  it("follows the link that arrives after it opens, and keeps your own choice", () => {
    const onConfirm = rs.fn();
    const view = render(dialog(false, true, onConfirm));
    expect(tick()?.getAttribute("aria-checked")).toBe("false");
    view.rerender(dialog(true, true, onConfirm));
    expect(tick()?.getAttribute("aria-checked")).toBe("true");

    act(() => {
      fireEvent.click(tick() as HTMLElement);
    });
    expect(tick()?.getAttribute("aria-checked")).toBe("false");
    view.rerender(dialog(false, true, onConfirm));
    view.rerender(dialog(true, true, onConfirm));
    expect(tick()?.getAttribute("aria-checked")).toBe("false");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Wrap up" }));
    });
    expect(onConfirm).toHaveBeenCalledWith(replies[0]!.id, false);
  });

  it("losing post rights takes the tick away and marks nothing", () => {
    const onConfirm = rs.fn();
    const view = render(dialog(true, true, onConfirm));
    expect(tick()?.getAttribute("aria-checked")).toBe("true");
    view.rerender(dialog(true, false, onConfirm));
    expect(tick()).toBeNull();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Wrap up" }));
    });
    expect(onConfirm).toHaveBeenCalledWith(replies[0]!.id, false);
  });
});
