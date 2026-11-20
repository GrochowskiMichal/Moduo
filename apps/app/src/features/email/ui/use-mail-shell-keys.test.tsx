// specs/mail-improve.md MI-0, AC26 and AC27: F6 / ⇧F6 cycle the panes, ⌥0 toggles the
// side panel, `g p` `g v` `g n` `g l` jump to tabs; the `?` sheet and ⌘K list them, the
// sheet reads undo as "z or ⌘Z" and shows drag without a key cap; the tab strip is one
// Tab stop with arrow keys inside.

import { afterEach, describe, expect, it } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { HotkeyScope } from "@/lib/hotkeys/scope";
import { isMacPlatform } from "@/lib/hotkeys/use-app-hotkeys";

import { mailLegend, mailPaletteActions } from "../keys";
import { createMailStore } from "../store/mail-store";
import { createFakeMailEngine } from "../testing/fake-engine";
import { FIXTURE_NOW_MS, generateFixture } from "../testing/fixture";
import { MailShell } from "./mail-shell";

afterEach(cleanup);

const tick = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

function press(key: string, extra: KeyboardEventInit = {}) {
  const code = /^[a-z]$/i.test(key)
    ? `Key${key.toUpperCase()}`
    : /^\d$/.test(key)
      ? `Digit${key}`
      : key;
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...extra }),
    );
  });
}

async function mount() {
  const engine = createFakeMailEngine({
    fixture: generateFixture({ messages: 300 }),
    now: () => FIXTURE_NOW_MS,
  });
  const store = createMailStore({ engine, accounts: await engine.listAccounts() });
  const ui = render(
    <TooltipProvider>
      <HotkeyScope scope="email">
        <MailShell
          store={store}
          now={() => FIXTURE_NOW_MS}
          customTabs={[{ id: "ct-investors", label: "Investors" }]}
          renderReader={(id) => (id ? <h2>Reading {id}</h2> : null)}
        />
      </HotkeyScope>
    </TooltipProvider>,
  );
  await tick();
  await tick();
  const pane = () => {
    const at = document.activeElement;
    if (!at) return null;
    if (at.closest('[aria-label="Mail folders"]')) return "rail";
    if (at.closest('[aria-label="Mail list"]')) return "list";
    if (at.closest('[aria-label="Reader"]')) return "reader";
    return null;
  };
  const selectedTab = () =>
    ui.container.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.textContent;
  return { ui, store, pane, selectedTab };
}

describe("F6 cycles panes; ⌥0 and g p/v/n/l (AC26, AC27)", () => {
  it("F6 walks rail → list → reader → rail; ⇧F6 goes back", async () => {
    const { pane } = await mount();
    press("j");
    press("F6");
    expect(pane()).toBe("rail");
    press("F6");
    expect(pane()).toBe("list");
    press("F6");
    expect(pane()).toBe("reader");
    press("F6");
    expect(pane()).toBe("rail");
    press("F6", { shiftKey: true });
    expect(pane()).toBe("reader");
    press("F6", { shiftKey: true });
    expect(pane()).toBe("list");
  });

  it("F6 lands on the selected row in the list", async () => {
    const { ui } = await mount();
    press("j");
    press("F6");
    press("F6");
    const selected = ui.container.querySelector('[aria-selected="true"][data-thread-id]');
    expect(document.activeElement).toBe(selected);
  });

  it("⌥0 toggles the side panel", async () => {
    const { store } = await mount();
    store.setState({ panel: "contact" });
    press("0", { altKey: true });
    expect(store.getState().panel).toBeNull();
    press("0", { altKey: true });
    expect(store.getState().panel).toBe("contact");
  });

  it("g p, g v, g n and g l jump to Personal, the first custom tab, Notifications, Newsletters", async () => {
    const { selectedTab } = await mount();
    press("g");
    press("n");
    expect(selectedTab()).toMatch(/^Notifications/);
    press("g");
    press("l");
    expect(selectedTab()).toMatch(/^Newsletters/);
    press("g");
    press("v");
    expect(selectedTab()).toMatch(/^Investors/);
    press("g");
    press("p");
    expect(selectedTab()).toMatch(/^Personal/);
  });

  it("the ? sheet and ⌘K list the new keys; undo reads 'z or ⌘Z'; drag has no key cap", async () => {
    const mac = isMacPlatform();
    const rows = mailLegend(mac).flatMap((g) => g.rows);
    const ids = rows.flatMap((r) => r.ids);
    for (const id of [
      "email.panel-toggle",
      "email.pane-next",
      "email.go-personal",
      "email.go-custom",
      "email.go-notifications",
      "email.go-newsletters",
    ])
      expect(ids).toContain(id);
    const palette = mailPaletteActions(mac).map((a) => a.id);
    expect(palette).toContain("email.panel-toggle");
    expect(palette).toContain("email.pane-next");

    await mount();
    press("?", { shiftKey: true, code: "Slash" });
    const sheet = await screen.findByRole("dialog");
    const undo = within(sheet).getByText("Undo").parentElement!;
    expect(undo.textContent).toContain(mac ? "z or ⌘Z" : "z or Ctrl+Z");
    const drag = within(sheet).getByText(/^Drag a thread/).parentElement!;
    expect(drag.querySelector("kbd")).toBeNull();
    within(sheet).getByText(mac ? "⌥0" : "Alt+0");
    within(sheet).getByText("F6");
  });

  it("the tab strip is one Tab stop with arrows inside", async () => {
    const { ui } = await mount();
    const strip = ui.getByRole("tablist", { name: "Inbox tabs" });
    const tabs = within(strip).getAllByRole("tab");
    expect(tabs.filter((t) => t.tabIndex === 0)).toHaveLength(1);
    const first = tabs.find((t) => t.tabIndex === 0)!;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tabs[tabs.indexOf(first) + 1]);
  });
});
