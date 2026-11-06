import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, render } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { HotkeyScope } from "@/lib/hotkeys/scope";

import { advanceAfterRemoval, EMPTY_SELECTION, extendPick, moveCursor } from "../shell/selection";
import { createMailStore } from "../store/mail-store";
import { createFakeMailEngine } from "../testing/fake-engine";
import { FIXTURE_NOW_MS, generateFixture } from "../testing/fixture";
import { MailShell } from "./mail-shell";

afterEach(cleanup);

const tick = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

function press(key: string, extra: KeyboardEventInit = {}) {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        code: `Key${key.toUpperCase()}`,
        bubbles: true,
        cancelable: true,
        ...extra,
      }),
    );
  });
}

async function mount() {
  const engine = createFakeMailEngine({
    fixture: generateFixture({ messages: 300 }),
    now: () => FIXTURE_NOW_MS,
  });
  const store = createMailStore({ engine, accounts: await engine.listAccounts() });
  engine.subscribe((e) => {
    if (e.kind === "threads_changed")
      store.setState((s) => ({ threadsVersion: s.threadsVersion + 1 }));
  });
  const ui = render(
    <TooltipProvider>
      <HotkeyScope scope="email">
        <MailShell store={store} now={() => FIXTURE_NOW_MS} />
      </HotkeyScope>
    </TooltipProvider>,
  );
  await tick();
  await tick();
  const rowIds = () =>
    [...ui.container.querySelectorAll<HTMLElement>("[data-thread-id]")].map(
      (el) => el.dataset.threadId!,
    );
  const cursor = () =>
    ui.container.querySelector<HTMLElement>('[aria-selected="true"][data-thread-id]')?.dataset
      .threadId ?? null;
  return { ui, store, engine, rowIds, cursor };
}

describe("mail thread list (AC14)", () => {
  it("auto-advance", async () => {
    const { rowIds, cursor } = await mount();
    const before = rowIds();
    expect(before.length).toBeGreaterThan(3);
    press("j");
    press("j");
    expect(cursor()).toBe(before[1]);
    press("e");
    await tick();
    await tick();
    expect(rowIds()).not.toContain(before[1]);
    expect(cursor()).toBe(before[2]);
  });

  it("selection stays in view", async () => {
    const spy = rs.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      const { rowIds } = await mount();
      press("j");
      press("j");
      press("j");
      const calls = spy.mock.contexts.map((el) => (el as HTMLElement).dataset.threadId);
      expect(calls.at(-1)).toBe(rowIds()[2]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("multi-select done is one undo (AC13)", async () => {
    const { rowIds, store } = await mount();
    const before = rowIds();
    press("j");
    press("J", { shiftKey: true, code: "KeyJ" });
    press("J", { shiftKey: true, code: "KeyJ" });
    press("e");
    await tick();
    await tick();
    expect(store.getState().undoStack).toHaveLength(1);
    expect(store.getState().undoStack[0]!.threadIds.sort()).toEqual(before.slice(0, 3).sort());
  });
});

describe("list groups in the shell (specs/mail-v3.md §3, AC14)", () => {
  it("Came back first in Personal, then Everything else", async () => {
    const { ui, store, rowIds } = await mount();
    const back = rowIds().slice(3, 5);
    act(() => store.setState({ awayReturned: back }));
    await tick();
    const headers = [...ui.container.querySelectorAll("[data-group-header]")].map(
      (h) => h.textContent,
    );
    expect(headers[0]).toBe("Came back while you were away");
    expect(headers).toContain("Everything else");
    expect(rowIds().slice(0, 2)).toEqual(back);
  });

  it("Newsletters: one row per sender; Done all marks the sender's threads done", async () => {
    const { ui, store } = await mount();
    act(() => {
      ui.getByRole("tab", { name: /Newsletters/ }).click();
    });
    await tick();
    await tick();
    const group = ui.container.querySelector<HTMLElement>("[data-sender-group]");
    expect(group).not.toBeNull();
    const name = group!.querySelector("button[aria-expanded]")!.textContent!;
    expect(name).toMatch(/ · \d+$/);
    const count = Number(name.split(" · ").at(-1));
    act(() => {
      group!.querySelector<HTMLButtonElement>("button[aria-label^='Done all']")!.click();
    });
    await tick();
    expect(store.getState().undoStack[0]!.threadIds).toHaveLength(count);
  });
});

describe("selection model", () => {
  it("advances below the removed rows, else above", () => {
    const ids = ["a", "b", "c", "d"];
    expect(advanceAfterRemoval(ids, { ...EMPTY_SELECTION, cursor: "b" }, ["b", "c"]).cursor).toBe(
      "d",
    );
    expect(advanceAfterRemoval(ids, { ...EMPTY_SELECTION, cursor: "d" }, ["d"]).cursor).toBe("c");
    const s = extendPick(ids, moveCursor(ids, EMPTY_SELECTION, 1), 2);
    expect(s.picked).toEqual(["a", "b", "c"]);
  });
});
