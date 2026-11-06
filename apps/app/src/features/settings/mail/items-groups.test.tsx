// Settings → Mail lists (specs/mail-v3.md §12, AC7, AC35): saving a rule asks
// in place whether to apply it to the mail already on this Mac (count from the
// dry run); Apply runs one undoable bulk op whose line outlives Settings; the
// custom tabs stop at three.

import { afterEach, describe, expect, it, rstest } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { EmailSettingsItem } from "@/lib/runtime.types.email";

import { type ItemActions, ItemsGroups } from "./items-groups";
import { resetRuleAppliesForTests, type RuleApplyPort } from "./rule-apply";

afterEach(() => {
  cleanup();
  resetRuleAppliesForTests();
});

const tick = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

const item = (
  id: string,
  kind: EmailSettingsItem["kind"],
  value: Record<string, unknown>,
  position = 0,
) =>
  ({
    id,
    kind,
    position,
    value,
    updatedAt: "2026-11-01T00:00:00Z",
    deletedAt: null,
  }) as EmailSettingsItem;

const RULE = item("r-new", "rule", {
  conditions: [{ field: "from", value: "billing@shop.test" }],
  actions: [{ action: "mark_read" }],
});

function mount(items: EmailSettingsItem[], ruleApply: RuleApplyPort | null, add = rstest.fn()) {
  const actions: ItemActions = { add, update: rstest.fn(), remove: rstest.fn() };
  const ui = render(
    <TooltipProvider>
      <ItemsGroups items={items} actions={actions} accounts={[]} ruleApply={ruleApply} />
    </TooltipProvider>,
  );
  return { ...ui, actions };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("Settings → Mail rules and tabs (AC7, AC35)", () => {
  it("apply to existing prompt; tabs cap at 3", async () => {
    const applied = deferred<{ count: number; opIds: string[] }>();
    const port = {
      count: rstest.fn(async () => 4000),
      apply: rstest.fn(() => applied.promise),
      undo: rstest.fn(async () => {}),
    };
    const add = rstest.fn(() => "r-new");
    const view = mount([], port, add);

    fireEvent.change(screen.getByRole("textbox", { name: "Condition value" }), {
      target: { value: "billing@shop.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(add).toHaveBeenCalledWith("rule", {
      conditions: [{ field: "from", value: "billing@shop.test" }],
      actions: [{ action: "skip_inbox" }],
    });
    await tick();
    expect(port.count).toHaveBeenCalledWith("r-new");
    const ask = screen.getByRole("group", { name: "Apply to existing mail" });
    within(ask).getByText("Also apply to the 4,000 already on this Mac?");
    within(ask).getByRole("button", { name: "Only new mail" });
    fireEvent.click(within(ask).getByRole("button", { name: "Apply" }));
    expect(port.apply).toHaveBeenCalledWith("r-new");
    expect(screen.queryByRole("group", { name: "Apply to existing mail" })).toBeNull();

    // The saved rule's row: the line while it runs, and after Settings closes and reopens.
    view.rerender(
      <TooltipProvider>
        <ItemsGroups items={[RULE]} actions={view.actions} accounts={[]} ruleApply={port} />
      </TooltipProvider>,
    );
    const row = () => document.querySelector<HTMLElement>('[data-rule-row="r-new"]')!;
    expect(within(row()).getByRole("status").textContent).toBe("Applying to 4,000…");
    view.unmount();
    await act(async () => {
      applied.resolve({ count: 4000, opIds: ["op-1"] });
    });
    mount([RULE], port);
    expect(within(row()).getByRole("status").textContent).toBe("Applied to 4,000·Undo");
    fireEvent.click(within(row()).getByRole("button", { name: "Undo" }));
    await tick();
    expect(port.undo).toHaveBeenCalledWith(["op-1"]);
    expect(within(row()).queryByRole("status")).toBeNull();
    cleanup();

    // Only new mail asks nothing more; a rule matching nothing never asks.
    const none = { ...port, count: rstest.fn(async () => 0), apply: rstest.fn() };
    mount(
      [],
      none,
      rstest.fn(() => "r-2"),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Condition value" }), {
      target: { value: "x@y.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    await tick();
    expect(none.count).toHaveBeenCalledWith("r-2");
    expect(screen.queryByRole("group", { name: "Apply to existing mail" })).toBeNull();
    cleanup();

    // Custom tabs: the add button disables at three, with the note.
    const two = [0, 1].map((i) =>
      item(`t${i}`, "custom_tab", { name: `Tab ${i}`, domains: [`d${i}.test`] }, i),
    );
    mount(two, null);
    expect(screen.queryByText("Up to 3 custom tabs")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Tab name" }), {
      target: { value: "Investors" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Tab senders or domains" }), {
      target: { value: "fund.test" },
    });
    expect((screen.getByRole("button", { name: "Add tab" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    cleanup();

    const three = [...two, item("t2", "custom_tab", { name: "Tab 2", domains: ["d2.test"] }, 2)];
    const tabsAdd = rstest.fn();
    mount(three, null, tabsAdd);
    fireEvent.change(screen.getByRole("textbox", { name: "Tab name" }), {
      target: { value: "Fourth" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Tab senders or domains" }), {
      target: { value: "four.test" },
    });
    expect((screen.getByRole("button", { name: "Add tab" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    screen.getByText("Up to 3 custom tabs");
    fireEvent.submit(screen.getByRole("button", { name: "Add tab" }).closest("form")!);
    expect(tabsAdd).not.toHaveBeenCalled();
  });
});
