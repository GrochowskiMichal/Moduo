import { afterAll, afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { mailViewKey } from "@/lib/runtime.types";
import type { MailCounts, MailTab, MailView } from "@/lib/runtime.types.mail-engine";

import { cycleTab, foldTabs, MailTabs, mailTabs } from "./mail-tabs";

// jsdom has no layout: every tab is 100 px, "+N" is 30 px, and the strip's
// room is whatever `room` says.
const TAB_W = 100;
const MORE_W = 30;
let room = 1000;
const proto = HTMLElement.prototype;
const saved = {
  offsetWidth: Object.getOwnPropertyDescriptor(proto, "offsetWidth"),
  clientWidth: Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth"),
};
beforeAll(() => {
  Object.defineProperty(proto, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.getAttribute("role") === "tab") return TAB_W;
      return this.dataset.slot === "mail-tabs-more" ? MORE_W : 0;
    },
  });
  Object.defineProperty(proto, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.slot === "mail-tabs-fit" ? room : 0;
    },
  });
});
afterAll(() => {
  if (saved.offsetWidth) Object.defineProperty(proto, "offsetWidth", saved.offsetWidth);
  delete (proto as unknown as Record<string, unknown>).clientWidth;
  if (saved.clientWidth) Object.defineProperty(Element.prototype, "clientWidth", saved.clientWidth);
});
afterEach(() => {
  cleanup();
  room = 1000;
});

const INBOX: MailView = { kind: "unified", role: "inbox" };
const CUSTOM = [
  { id: "inv", label: "Investors" },
  { id: "hire", label: "Hiring" },
  { id: "press", label: "Press" },
];
const TABS = mailTabs(CUSTOM);
const counts = (byTab: [MailTab, number][]): MailCounts => ({
  byViewKey: Object.fromEntries(byTab.map(([t, n]) => [mailViewKey(INBOX, t), n])),
  badge: 0,
});
const visibleTabs = () =>
  screen.getAllByRole("tab").map((t) => t.textContent?.replace(/\d.*$/, ""));
const pointer = { button: 0, ctrlKey: false, pointerType: "mouse" };

function mount(current: MailTab, c: MailCounts | null = null, onSelect = rs.fn()) {
  render(
    <TooltipProvider>
      <MailTabs
        view={INBOX}
        tabs={TABS}
        current={current}
        counts={c}
        onSelect={onSelect}
        onZero={() => {}}
      />
    </TooltipProvider>,
  );
  return onSelect;
}

describe("MailTabs (specs/mail-v3.md §2, AC13)", () => {
  it("folds overflow into +N and never folds the selected tab", async () => {
    room = 350;
    const notifications: MailTab = { kind: "notifications" };
    const onSelect = mount({ kind: "personal" }, counts([[notifications, 4]]));
    // 600 px of tabs in 350: the three on the right fold behind "+3".
    expect(visibleTabs()).toEqual(["Personal", "Investors", "Hiring"]);
    const more = screen.getByRole("button", { name: /^3 more tabs/ });
    expect(more.textContent).toContain("+3");
    // A folded tab (Notifications) has unread: "+N" carries the dot.
    expect(more.querySelector('[data-slot="mail-tabs-more-dot"]')).toBeTruthy();

    // The menu lists every tab with its count, then Custom tabs… Settings.
    fireEvent.pointerDown(more, pointer);
    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual([
      "Personal",
      "Investors",
      "Hiring",
      "Press",
      "Notifications4 unread",
      "Newsletters",
    ]);
    within(menu).getByRole("menuitem", { name: /Custom tabs…\s*Settings/ });
    fireEvent.click(items[4]!);
    expect(onSelect).toHaveBeenCalledWith(notifications);
  });

  it("keeps the selected tab when it sits on the folding side", () => {
    room = 350;
    mount({ kind: "newsletters" });
    expect(visibleTabs()).toEqual(["Personal", "Investors", "Newsletters"]);
    screen.getByRole("button", { name: /^3 more tabs: Hiring, Press, Notifications$/ });
  });

  it("at its narrowest (1024 px, three custom tabs) Personal and the selected tab still show", () => {
    room = 120;
    mount({ kind: "custom", customTabId: "press" });
    expect(visibleTabs()).toEqual(["Personal", "Press"]);
  });

  it("shows every tab and no +N when they fit", () => {
    mount({ kind: "personal" });
    expect(visibleTabs()).toHaveLength(6);
    expect(screen.queryByRole("button", { name: /more tabs/ })).toBeNull();
  });

  it("measures again once fonts load", async () => {
    let loaded!: () => void;
    const ready = new Promise<void>((r) => (loaded = r));
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
    try {
      mount({ kind: "personal" });
      expect(visibleTabs()).toHaveLength(6);
      room = 350;
      await act(async () => {
        loaded();
        await ready;
      });
      expect(visibleTabs()).toEqual(["Personal", "Investors", "Hiring"]);
    } finally {
      delete (document as unknown as Record<string, unknown>).fonts;
    }
  });

  it("[ and ] move through every tab, folded ones included", () => {
    let t: MailTab = { kind: "personal" };
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      t = cycleTab(TABS, t, 1);
      seen.push(t.customTabId ?? t.kind);
    }
    expect(seen).toEqual(["inv", "hire", "press", "notifications", "newsletters", "personal"]);
    expect(cycleTab(TABS, { kind: "personal" }, -1)).toEqual({ kind: "newsletters" });
  });

  it("the ⋯ menu offers Get me to zero in the current tab", async () => {
    mount({ kind: "custom", customTabId: "inv" });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Tab actions" }), pointer);
    const menu = await screen.findByRole("menu");
    within(menu).getByText("Get me to zero in Investors");
    within(menu).getByText("Archives everything here · z undoes");
  });

  it("foldTabs: never Personal, never the selected tab, fits beside +N", () => {
    expect(foldTabs([100, 100, 100], 300, 0, 30)).toEqual([]);
    expect(foldTabs([100, 100, 100, 100], 300, 0, 30)).toEqual([2, 3]);
    expect(foldTabs([100, 100, 100, 100], 300, 3, 30)).toEqual([1, 2]);
    expect(foldTabs([100, 100, 100, 100], 50, 2, 30)).toEqual([1, 3]);
  });
});
