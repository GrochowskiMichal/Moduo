// The top bar's Help menu (tasks-v3 call 96): what each item opens. Items that
// open a dialog wait for the menu to close (gotchas/ui.md). jsdom doesn't
// reproduce the focus hand-back that closes a dialog opened too early, so the
// live check covers that; these tests check the dialog is open afterwards.

import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = rs.hoisted(() => ({
  openExternalUrl: rs.fn((_url: string) => Promise.resolve()),
  toast: rs.fn(),
  mailtos: [] as string[],
}));

rs.mock("sonner", () => ({ toast: h.toast }));
rs.mock("../../providers/auth-provider", () => ({
  useAuth: () => ({ runtime: { window: { openExternalUrl: h.openExternalUrl } } }),
}));
rs.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: "/tasks" } }),
}));

import { APP_VERSION } from "../../features/settings/about";
import { TooltipProvider } from "../ui/tooltip";
import { GlobalShortcutsDialog } from "./global-shortcuts-dialog";
import { DOCS_URL } from "./help-links";
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
  h.mailtos.length = 0;
  h.openExternalUrl.mockClear();
  h.toast.mockClear();
  // Catch the mailto hand-off instead of letting jsdom try to navigate.
  anchorClick = rs.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    h.mailtos.push(this.href);
  });
});
afterEach(() => {
  anchorClick.mockRestore();
  cleanup();
});

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

function renderMenu() {
  render(
    <TooltipProvider>
      <HelpMenu />
      <GlobalShortcutsDialog />
    </TooltipProvider>,
  );
}

async function choose(item: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: "Help" }), { key: "Enter" });
  await settle();
  fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(item) }));
  await settle();
}

describe("HelpMenu", () => {
  it("lists Docs, Keyboard shortcuts with its ? key, Contact support and Report a bug", async () => {
    renderMenu();
    fireEvent.keyDown(screen.getByRole("button", { name: "Help" }), { key: "Enter" });
    await settle();
    const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(items).toEqual(["Docs", "Keyboard shortcuts?", "Contact support", "Report a bug"]);
  });

  it("opens the docs through the runtime, so desktop uses the system browser", async () => {
    renderMenu();
    await choose("Docs");
    expect(h.openExternalUrl).toHaveBeenCalledWith(DOCS_URL);
  });

  it("opens the keyboard shortcuts once the menu has closed", async () => {
    renderMenu();
    await choose("Keyboard shortcuts");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeNull();
  });

  it("writes to support@ from Contact support", async () => {
    renderMenu();
    await choose("Contact support");
    expect(h.mailtos).toEqual(["mailto:support@moduo.app?subject=Moduo%20support"]);
  });

  it("emails a bug report to hello@ with the app version and page attached", async () => {
    renderMenu();
    await choose("Report a bug");
    const dialog = screen.getByRole("dialog", { name: "Report a bug" });
    expect(dialog.textContent).toContain(`Moduo ${APP_VERSION}`);
    const send = screen.getByRole("button", { name: "Email report" });
    expect((send as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("What happened?"), {
      target: { value: "The timer froze" },
    });
    fireEvent.click(send);
    await settle();

    expect(h.mailtos).toHaveLength(1);
    const url = new URL(h.mailtos[0] ?? "");
    expect(url.protocol + url.pathname).toBe("mailto:hello@moduo.app");
    expect(url.searchParams.get("subject")).toBe("Bug: The timer froze");
    expect(url.searchParams.get("body")).toContain(`Moduo ${APP_VERSION}`);
    expect(url.searchParams.get("body")).toContain("Page: /tasks");
    expect(screen.queryByRole("dialog", { name: "Report a bug" })).toBeNull();
  });
});
