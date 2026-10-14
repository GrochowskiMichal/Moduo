// A toast raised from inside a dialog (an Undo) is pressable without closing
// the dialog; any other press outside still closes it.

import { afterEach, describe, expect, it } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

afterEach(() => cleanup());

/** Radix arms its outside-press listener on the next tick after opening. */
const armed = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

/** A mouse press, the way Radix listens for it. */
function press(el: Element) {
  fireEvent.pointerDown(el, { button: 0, pointerType: "mouse" });
  fireEvent.mouseDown(el, { button: 0 });
  fireEvent.pointerUp(el, { button: 0, pointerType: "mouse" });
  fireEvent.mouseUp(el, { button: 0 });
  fireEvent.click(el, { button: 0 });
}

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Viewer</DialogTitle>
          <DialogDescription>A file</DialogDescription>
        </DialogContent>
      </Dialog>
      <ol data-sonner-toaster="">
        <li>
          <button type="button">Undo</button>
        </li>
      </ol>
      <button type="button">Elsewhere</button>
    </>
  );
}

describe("DialogContent", () => {
  it("stays open when a toast is pressed", async () => {
    render(<Harness />);
    await armed();
    press(screen.getByText("Undo"));
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("still closes on a press anywhere else outside", async () => {
    render(<Harness />);
    await armed();
    press(screen.getByText("Elsewhere"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
