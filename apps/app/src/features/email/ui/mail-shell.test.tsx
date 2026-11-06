// AC21: every key in spec §7 works, Enter and the `g` chords included, and no
// key the `?` sheet lists is dead.
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { getHotkeyManager } from "@tanstack/hotkeys";
import { act, cleanup, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { HotkeyScope } from "@/lib/hotkeys/scope";
import { isMacPlatform } from "@/lib/hotkeys/use-app-hotkeys";
import type { MailView } from "@/lib/runtime.types.mail-engine";

import { type MailKeyId, mailLegend } from "../keys";
import { createMailStore } from "../store/mail-store";
import { createFakeMailEngine } from "../testing/fake-engine";
import { FIXTURE_NOW_MS, generateFixture } from "../testing/fixture";
import { MailShell } from "./mail-shell";

afterEach(cleanup);

const tick = () => act(async () => await new Promise((r) => setTimeout(r, 0)));
const mod = () => (isMacPlatform() ? { metaKey: true } : { ctrlKey: true });

function press(key: string, extra: KeyboardEventInit = {}) {
  const code = /^[a-z]$/i.test(key)
    ? `Key${key.toUpperCase()}`
    : /^\d$/.test(key)
      ? `Digit${key}`
      : key;
  const event = new KeyboardEvent("keydown", {
    key,
    code,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
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
  const onIntent = rs.fn<(id: MailKeyId, threadIds: string[]) => void>();
  const onViewChange = rs.fn<(view: MailView) => void>();
  const onUndoFirst = rs.fn(() => false);
  const ui = render(
    <TooltipProvider>
      <HotkeyScope scope="email">
        <MailShell
          store={store}
          now={() => FIXTURE_NOW_MS}
          onIntent={onIntent}
          onViewChange={onViewChange}
          onUndoFirst={onUndoFirst}
          renderReader={(id) => (id ? <h2>Reading {id}</h2> : null)}
        />
      </HotkeyScope>
    </TooltipProvider>,
  );
  await tick();
  await tick();
  const cursor = () =>
    ui.container.querySelector<HTMLElement>('[aria-selected="true"][data-thread-id]')?.dataset
      .threadId ?? null;
  const rowIds = () =>
    [...ui.container.querySelectorAll<HTMLElement>("[data-thread-id]")].map(
      (el) => el.dataset.threadId!,
    );
  return { ui, store, engine, onIntent, onViewChange, onUndoFirst, cursor, rowIds };
}

/** The email bindings that are live right now, by registry id. */
function boundEmailIds(): Set<string> {
  const out = new Set<string>();
  for (const reg of getHotkeyManager().registrations.state.values()) {
    if (reg.options.scope === "email" && reg.options.meta?.description)
      out.add(reg.options.meta.description);
  }
  return out;
}

describe("mail shell keys (AC21)", () => {
  it("every §7 key has a handler", async () => {
    await mount();
    const bound = boundEmailIds();
    const legendIds = mailLegend().flatMap((g) => g.rows.flatMap((r) => r.ids));
    expect(legendIds.length).toBeGreaterThan(0);
    expect(legendIds.filter((id) => !bound.has(id))).toEqual([]);
    for (const id of ["email.open", "email.undone", "email.remind", "email.expand-all"])
      expect(bound.has(id)).toBe(true);
  });

  it("Enter opens the thread: the first one, then focus into the reader", async () => {
    const { cursor, rowIds } = await mount();
    expect(cursor()).toBeNull();
    press("Enter");
    expect(cursor()).toBe(rowIds()[0]);
    press("Enter");
    const title = screen.getByRole("heading", { name: `Reading ${rowIds()[0]}` });
    expect(document.activeElement).toBe(title);
  });

  it("Enter on a focused button stays the button's", async () => {
    const { cursor } = await mount();
    const button = document.createElement("button");
    button.textContent = "Somewhere else";
    document.body.append(button);
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      button.dispatchEvent(event);
    });
    button.remove();
    expect(event.defaultPrevented).toBe(false);
    expect(cursor()).toBeNull();
  });

  it("↓ ↑ walk like j k; ⇧E, ⌫, ⌘Z and ⌘N act", async () => {
    const { cursor, rowIds, engine, onIntent, onUndoFirst } = await mount();
    const ids = rowIds();
    press("ArrowDown");
    press("ArrowDown");
    expect(cursor()).toBe(ids[1]);
    press("ArrowUp");
    expect(cursor()).toBe(ids[0]);

    const apply = rs.spyOn(engine, "applyOp");
    press("E", { shiftKey: true, code: "KeyE" });
    await tick();
    expect(apply.mock.calls.at(-1)![0]).toMatchObject({ kind: "undone", threadIds: [ids[0]] });

    press("Backspace");
    await tick();
    expect(apply.mock.calls.at(-1)![0]).toMatchObject({ kind: "delete" });

    press("z", mod());
    expect(onUndoFirst).toHaveBeenCalledTimes(1);

    press("n", mod());
    expect(onIntent).toHaveBeenLastCalledWith("email.compose", expect.any(Array));
  });

  it("w hands the thread to Remind; o asks the reader to expand every message", async () => {
    const { onIntent, cursor } = await mount();
    press("j");
    press("w");
    expect(onIntent).toHaveBeenLastCalledWith("email.remind", [cursor()]);
    press("o");
    expect(onIntent).toHaveBeenLastCalledWith("email.expand-all", [cursor()]);
  });

  it("⌥1–3 set the side panel's view", async () => {
    const { store } = await mount();
    press("1", { altKey: true });
    expect(store.getState().panel).toBe("today");
    press("2", { altKey: true });
    expect(store.getState().panel).toBe("contact");
    press("3", { altKey: true });
    expect(store.getState().panel).toBe("task");
  });

  it("g chords go places, and the hint line reads g… while one waits", async () => {
    const { ui, onViewChange } = await mount();
    const hint = () => ui.container.querySelector('[data-slot="mail-hint-line"]')!.textContent;
    press("g");
    expect(hint()).toBe("g…");
    press("a");
    expect(onViewChange).toHaveBeenLastCalledWith({ kind: "unified", role: "archive" });
    expect(hint()).not.toBe("g…");
    press("g");
    press("f");
    expect(onViewChange).toHaveBeenLastCalledWith({ kind: "followups" });
    press("g");
    press("i");
    expect(onViewChange).toHaveBeenLastCalledWith({ kind: "unified", role: "inbox" });
  });

  it("the ? sheet shows Move, Act and Connect, and the Write group", async () => {
    await mount();
    press("?", { shiftKey: true, code: "Slash" });
    const sheet = await screen.findByRole("dialog");
    for (const name of ["Move", "Act", "Connect", "Write"])
      within(sheet).getByRole("region", { name });
    const connect = within(sheet).getByRole("region", { name: "Connect" });
    within(connect).getByText(isMacPlatform() ? "⌥1" : "Alt+1");
    within(connect).getByText("t");
  });

  it("⌘A takes every thread in the tab; switching tabs clears it", async () => {
    const { ui, engine } = await mount();
    const all = await engine.listThreads({
      view: { kind: "unified", role: "inbox" },
      tab: { kind: "personal" },
      limit: 100_000,
    });
    press("a", mod());
    await tick();
    await tick();
    screen.getByRole("region", { name: `${all.rows.length} selected` });
    press("]");
    await tick();
    expect(ui.container.querySelector('[data-slot="mail-bulk-reader"]')).toBeNull();
  });
});
