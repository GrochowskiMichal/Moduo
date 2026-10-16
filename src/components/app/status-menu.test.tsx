// The status menu's saved statuses are private (CV-17): a list read for one
// person that comes back after an account switch on this tab is dropped.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

type Saved = {
  id: string;
  emoji: string | null;
  text: string | null;
  dnd: boolean;
  clearAfter: string;
  position: number;
};

const h = rs.hoisted(() => ({
  pending: [] as ((list: Saved[]) => void)[],
}));

rs.mock("sonner", () => ({ toast: rs.fn() }));
rs.mock("@/lib/statuses/live", () => ({}));
rs.mock("@/lib/statuses/store", () => ({
  usePeopleNow: () => ({ people: new Map(), loaded: true }),
  refreshPeopleNow: () => {},
}));
rs.mock("@/lib/statuses/api", () => ({
  listSavedStatuses: () =>
    new Promise<Saved[]>((resolve) => {
      h.pending.push(resolve);
    }),
  clearMyStatus: async () => {},
  forgetStatus: async () => {},
  saveStatus: async () => {},
  setMyStatus: async () => {},
}));

import { TooltipProvider } from "../ui/tooltip";
import { StatusMenu } from "./status-menu";

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

afterEach(() => {
  cleanup();
  h.pending.length = 0;
});

const saved = (id: string, text: string): Saved => ({
  id,
  emoji: null,
  text,
  dnd: false,
  clearAfter: "never",
  position: 0,
});

const menu = (userId: string) => (
  <TooltipProvider>
    <StatusMenu userId={userId} workspaceId="ws" profileInitial="A" onOpenSettings={() => {}} />
  </TooltipProvider>
);

const openMenu = () => {
  const trigger = document.querySelector('[data-slot="status-menu-trigger"]') as HTMLElement;
  fireEvent.click(trigger);
};

describe("status menu: saved statuses", () => {
  it("a list read for the person before an account switch is dropped", async () => {
    const view = render(menu("ana"));
    openMenu();
    expect(h.pending).toHaveLength(1);

    // Bo signs in on this tab while Ana's list is still on its way.
    view.rerender(menu("bo"));
    await act(async () => {
      h.pending[0]!([saved("a1", "Ana's secret status")]);
    });
    openMenu();
    expect(screen.queryByText("Ana's secret status")).toBeNull();

    // Bo's own list arrives and shows.
    expect(h.pending.length).toBeGreaterThanOrEqual(2);
    await act(async () => {
      h.pending.at(-1)!([saved("b1", "Bo's status")]);
    });
    expect(screen.getByText("Bo's status")).toBeTruthy();
    expect(screen.queryByText("Ana's secret status")).toBeNull();
  });
});
