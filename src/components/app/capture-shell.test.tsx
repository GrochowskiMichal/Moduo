// SH-1 (tasks-v3 calls 90/90b, AC10.1) — the capture shell. ⌘⇧K opens it as
// Task; inside it ⌘ + a module's number switches the type and never the module
// behind it; a number without a registered type (⌘1 Home, or anything but
// Tasks when only Task is registered) does nothing. The e2e version of this
// (tests/capture.spec.ts in the spec) waits for an e2e harness on the local
// stack; these run in `bun run verify`.
import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CheckSquare, FileText } from "lucide-react";

import type { CaptureBodyProps, CaptureTypeDef } from "../../lib/capture-registry";

const h = rs.hoisted(() => ({
  perms: {
    notes: "edit",
    tasks: "edit",
    calendar: "edit",
    contacts: "edit",
    chat: "edit",
  } as Record<string, string>,
}));

rs.mock("../../providers/workspace-provider", () => ({
  useWorkspace: () => ({ modulePermissions: h.perms }),
}));

import { shortcutEvent, useGlobalShortcuts } from "../../lib/shortcuts";
import { CaptureShell, dispatchOpenCapture } from "./capture-shell";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  // ⌘ on every platform in these tests.
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
});

beforeEach(() => {
  h.perms = { notes: "edit", tasks: "edit", calendar: "edit", contacts: "edit", chat: "edit" };
});
afterEach(cleanup);

/** A body that shows which type it belongs to and the shared draft. */
function testBody(label: string) {
  return function Body({ draft, onDraftChange, writable }: CaptureBodyProps) {
    return (
      <input
        aria-label={`${label} title`}
        data-writable={writable ? "yes" : "no"}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
      />
    );
  };
}

const TASK: CaptureTypeDef = {
  type: "task",
  module: "tasks",
  label: "Task",
  icon: CheckSquare,
  destination: "Inbox",
  canWrite: (p) => p.tasks === "edit" || p.tasks === "admin",
  Body: testBody("Task"),
};
const NOTE: CaptureTypeDef = {
  type: "note",
  module: "notes",
  label: "Note",
  icon: FileText,
  destination: "Notes",
  canWrite: (p) => p.notes === "edit" || p.notes === "admin",
  Body: testBody("Note"),
};

function GlobalKeys() {
  useGlobalShortcuts();
  return null;
}

/** The app's global keys plus the shell, and a log of module-N navigations. */
function renderShell(types: CaptureTypeDef[]) {
  const navigations: string[] = [];
  const listeners = [1, 2, 3, 4, 5, 6, 7].map((n) => {
    const name = shortcutEvent(`module-${n}` as never);
    const fn = () => navigations.push(`module-${n}`);
    window.addEventListener(name, fn);
    return () => window.removeEventListener(name, fn);
  });
  const utils = render(
    <>
      <GlobalKeys />
      <CaptureShell types={types} />
    </>,
  );
  const unlisten = () => {
    for (const off of listeners) off();
  };
  return { ...utils, navigations, unlisten };
}

function press(init: KeyboardEventInit) {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });
}

async function openWithShortcut() {
  press({ metaKey: true, shiftKey: true, key: "K" });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return screen.getByRole("dialog");
}

const chip = () => screen.getByRole("button", { name: /^Capture type: / });

describe("opening", () => {
  it("⌘⇧K opens the capture as Task, filed to the Inbox", async () => {
    const { unlisten } = renderShell([TASK, NOTE]);
    const dialog = await openWithShortcut();
    expect(chip().getAttribute("aria-label")).toBe("Capture type: Task");
    expect(within(dialog).getByText("Inbox")).toBeTruthy();
    expect(within(dialog).getByRole("textbox", { name: "Task title" })).toBeTruthy();
    unlisten();
  });

  it("always reopens as Task with an empty line", async () => {
    const { unlisten } = renderShell([TASK, NOTE]);
    await openWithShortcut();
    press({ metaKey: true, key: "2" });
    fireEvent.change(screen.getByRole("textbox", { name: "Note title" }), {
      target: { value: "Pick up keys" },
    });
    press({ metaKey: true, shiftKey: true, key: "K" }); // closes
    await act(async () => {
      dispatchOpenCapture();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(chip().getAttribute("aria-label")).toBe("Capture type: Task");
    expect((screen.getByRole("textbox", { name: "Task title" }) as HTMLInputElement).value).toBe(
      "",
    );
    unlisten();
  });
});

describe("⌘1–7 inside the capture", () => {
  it("⌘2 switches the type to a registered Note without leaving the page behind", async () => {
    const { navigations, unlisten } = renderShell([TASK, NOTE]);
    await openWithShortcut();
    fireEvent.change(screen.getByRole("textbox", { name: "Task title" }), {
      target: { value: "Lunch with Ana" },
    });
    press({ metaKey: true, key: "2" });
    expect(chip().getAttribute("aria-label")).toBe("Capture type: Note");
    // What was typed comes along.
    expect((screen.getByRole("textbox", { name: "Note title" }) as HTMLInputElement).value).toBe(
      "Lunch with Ana",
    );
    expect(navigations).toEqual([]);
    press({ metaKey: true, key: "3" });
    expect(chip().getAttribute("aria-label")).toBe("Capture type: Task");
    expect(navigations).toEqual([]);
    unlisten();
  });

  it("with only Task registered, ⌘2–7 do nothing and the app stays put", async () => {
    const { navigations, unlisten } = renderShell([TASK]);
    await openWithShortcut();
    for (const key of ["2", "3", "4", "5", "6", "7"]) {
      press({ metaKey: true, key });
      expect(chip().getAttribute("aria-label")).toBe("Capture type: Task");
    }
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(navigations).toEqual([]);
    unlisten();
  });

  it("⌘1 (Home) does nothing", async () => {
    const { navigations, unlisten } = renderShell([TASK, NOTE]);
    await openWithShortcut();
    press({ metaKey: true, key: "1" });
    expect(chip().getAttribute("aria-label")).toBe("Capture type: Task");
    expect(navigations).toEqual([]);
    unlisten();
  });

  it("a type you can't create doesn't take the number", async () => {
    h.perms = { ...h.perms, notes: "view" };
    const { navigations, unlisten } = renderShell([TASK, NOTE]);
    await openWithShortcut();
    press({ metaKey: true, key: "2" });
    expect(chip().getAttribute("aria-label")).toBe("Capture type: Task");
    expect(navigations).toEqual([]);
    unlisten();
  });

  it("with the capture closed, ⌘2 is the module key again", () => {
    const { navigations, unlisten } = renderShell([TASK, NOTE]);
    press({ metaKey: true, key: "2" });
    expect(navigations).toEqual(["module-2"]);
    unlisten();
  });
});

describe("the type chip", () => {
  it("lists the types with their numbers and switches on pick", async () => {
    const { unlisten } = renderShell([TASK, NOTE]);
    await openWithShortcut();
    fireEvent.pointerDown(chip(), { button: 0, ctrlKey: false, pointerType: "mouse" });
    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual(["Task⌘3", "Note⌘2"]);
    fireEvent.click(items[1]);
    expect(chip().getAttribute("aria-label")).toBe("Capture type: Note");
    unlisten();
  });
});
