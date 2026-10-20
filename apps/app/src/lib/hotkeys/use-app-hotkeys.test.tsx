// AC8: scope priority (a narrower scope wins a shared key, whatever mounted
// first) and input suppression (no hotkey from a field or an editor unless the
// binding says `inInputs`), through the real @tanstack/react-hotkeys manager.
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";

import { HotkeyScope } from "./scope";
import { type AppHotkeyHandlers, isMacPlatform, useAppHotkeys } from "./use-app-hotkeys";

afterEach(cleanup);

function Bind({ handlers, enabled }: { handlers: AppHotkeyHandlers; enabled?: boolean }) {
  useAppHotkeys(handlers, { enabled });
  return null;
}

function press(init: KeyboardEventInit, target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const mod = () => (isMacPlatform() ? { metaKey: true } : { ctrlKey: true });
const questionMark = { key: "?", code: "Slash", shiftKey: true };

describe("useAppHotkeys", () => {
  it("lets a route scope beat a global key, mounted in either order", () => {
    const help = rs.fn();
    const legend = rs.fn();
    const page = (children: ReactNode) => <HotkeyScope scope="email">{children}</HotkeyScope>;
    const { rerender } = render(
      <>
        {page(<Bind handlers={{ "email.legend": legend }} />)}
        <Bind handlers={{ help }} />
      </>,
    );
    const event = press(questionMark);
    expect(legend).toHaveBeenCalledTimes(1);
    expect(help).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);

    // The page goes away: the global sheet is back.
    rerender(<Bind handlers={{ help }} />);
    press(questionMark);
    expect(help).toHaveBeenCalledTimes(1);
    expect(legend).toHaveBeenCalledTimes(1);
  });

  it("accepts Shift+/ delivered as key '/' (some layouts, synthetic events)", () => {
    const help = rs.fn();
    render(<Bind handlers={{ help }} />);
    press({ key: "/", code: "Slash", shiftKey: true });
    expect(help).toHaveBeenCalledTimes(1);
  });

  it("lets a modal's ⌘1 beat the module switch while it is open", () => {
    const moduleOne = rs.fn();
    const captureType = rs.fn();
    const { rerender } = render(
      <>
        <Bind handlers={{ "module-1": moduleOne }} />
        <HotkeyScope scope="modal" enabled>
          <Bind handlers={{ "capture.type": captureType }} />
        </HotkeyScope>
      </>,
    );
    press({ key: "1", code: "Digit1", ...mod() });
    expect(captureType).toHaveBeenCalledTimes(1);
    expect(moduleOne).not.toHaveBeenCalled();

    rerender(
      <>
        <Bind handlers={{ "module-1": moduleOne }} />
        <HotkeyScope scope="modal" enabled={false}>
          <Bind handlers={{ "capture.type": captureType }} />
        </HotkeyScope>
      </>,
    );
    press({ key: "1", code: "Digit1", ...mod() });
    expect(moduleOne).toHaveBeenCalledTimes(1);
  });

  it("ranks a nested panel over its page", () => {
    const close = rs.fn();
    const back = rs.fn();
    render(
      <HotkeyScope scope="tasks">
        <HotkeyScope scope="task-page">
          <Bind handlers={{ "task-page.close": close }} />
          <HotkeyScope scope="panel">
            <Bind handlers={{ "panel.back": back }} />
          </HotkeyScope>
        </HotkeyScope>
      </HotkeyScope>,
    );
    press({ key: "Escape", code: "Escape" });
    expect(back).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it("never fires from a field or an editor unless the binding is inInputs", () => {
    const filter = rs.fn();
    const palette = rs.fn();
    const { container } = render(
      <HotkeyScope scope="tasks">
        <Bind handlers={{ "tasks.filter": filter, palette }} />
        <input aria-label="field" />
        <div contentEditable suppressContentEditableWarning>
          <span>editor text</span>
        </div>
      </HotkeyScope>,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    const span = container.querySelector("span") as HTMLSpanElement;
    const f = { key: "f", code: "KeyF" };
    const typed = press(f, input);
    press(f, span);
    expect(filter).not.toHaveBeenCalled();
    expect(typed.defaultPrevented).toBe(false);

    press({ key: "k", code: "KeyK", ...mod() }, span);
    expect(palette).toHaveBeenCalledTimes(1);

    press(f);
    expect(filter).toHaveBeenCalledTimes(1);
  });

  it("skips a key a handler nearer the target already claimed", () => {
    const filter = rs.fn();
    const { getByRole } = render(
      <HotkeyScope scope="tasks">
        <Bind handlers={{ "tasks.filter": filter }} />
        <button type="button" onKeyDown={(e) => e.preventDefault()}>
          row
        </button>
      </HotkeyScope>,
    );
    fireEvent.keyDown(getByRole("button"), { key: "f", code: "KeyF" });
    expect(filter).not.toHaveBeenCalled();
  });

  it("leaves a declined key alone and holds nothing while disabled", () => {
    const { rerender } = render(<Bind handlers={{ "tasks.filter": () => false }} />);
    expect(press({ key: "f", code: "KeyF" }).defaultPrevented).toBe(false);
    const filter = rs.fn();
    rerender(<Bind handlers={{ "tasks.filter": filter }} enabled={false} />);
    press({ key: "f", code: "KeyF" });
    expect(filter).not.toHaveBeenCalled();
  });
});
