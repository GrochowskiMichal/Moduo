// The Help menu in the desktop app (tasks-v3 call 96): Tauri opens only web
// links, so Contact support and Report a bug copy to the clipboard instead of
// opening a mail app.

import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = rs.hoisted(() => ({
  toast: rs.fn(),
  copied: [] as string[],
  clipboardFails: false,
}));

rs.mock("sonner", () => ({ toast: h.toast }));
rs.mock("../../features/settings/about", () => ({
  APP_VERSION: "1.4.0",
  APP_BUILD: "a1b2c3d",
  IS_DESKTOP: true,
}));
rs.mock("../../providers/auth-provider", () => ({
  useAuth: () => ({ runtime: { window: { openExternalUrl: () => Promise.resolve() } } }),
}));
rs.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: "/calendar" } }),
}));

import { TooltipProvider } from "../ui/tooltip";
import { HelpMenu } from "./help-menu";

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

let anchorClick: ReturnType<typeof rs.spyOn>;
beforeEach(() => {
  h.copied.length = 0;
  h.clipboardFails = false;
  h.toast.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        if (h.clipboardFails) return Promise.reject(new Error("denied"));
        h.copied.push(text);
        return Promise.resolve();
      },
    },
  });
  anchorClick = rs.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  anchorClick.mockRestore();
  Reflect.deleteProperty(navigator, "clipboard");
  cleanup();
});

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

async function choose(item: string) {
  render(
    <TooltipProvider>
      <HelpMenu />
    </TooltipProvider>,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "Help" }), { key: "Enter" });
  await settle();
  fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(item) }));
  await settle();
}

describe("HelpMenu on desktop", () => {
  it("copies the support address instead of opening a mail app", async () => {
    await choose("Contact support");
    expect(h.copied).toEqual(["support@moduo.app"]);
    expect(anchorClick).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith("support@moduo.app copied", expect.anything());
  });

  it("copies the bug report, with the version and page, and says where to send it", async () => {
    await choose("Report a bug");
    fireEvent.change(screen.getByLabelText("What happened?"), {
      target: { value: "Sync stalled" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy report" }));
    await settle();

    expect(anchorClick).not.toHaveBeenCalled();
    expect(h.copied).toHaveLength(1);
    expect(h.copied[0]).toContain("Sync stalled");
    expect(h.copied[0]).toContain("Moduo 1.4.0 (build a1b2c3d)");
    expect(h.copied[0]).toContain("Platform: desktop");
    expect(h.copied[0]).toContain("Page: /calendar");
    expect(h.toast).toHaveBeenCalledWith("Report copied", {
      description: "Paste it into an email to hello@moduo.app.",
    });
    expect(screen.queryByRole("dialog", { name: "Report a bug" })).toBeNull();
  });

  it("keeps the form open with the draft when copying fails", async () => {
    h.clipboardFails = true;
    await choose("Report a bug");
    fireEvent.change(screen.getByLabelText("What happened?"), {
      target: { value: "Sync stalled" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy report" }));
    await settle();

    expect(h.toast).toHaveBeenCalledWith("Couldn't copy the report", expect.anything());
    expect(screen.getByDisplayValue("Sync stalled")).not.toBeNull();
  });
});
