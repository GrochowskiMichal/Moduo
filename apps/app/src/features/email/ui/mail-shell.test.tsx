// AC21: every key in spec §7 works, Enter and the `g` chords included, and no
// key the `?` sheet lists is dead.
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { getHotkeyManager } from "@tanstack/hotkeys";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { toast, Toaster } from "sonner";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
    // Opening a thread reads it (specs/mail-improve.md AC8): skip those reads here.
    const lastAct = () =>
      apply.mock.calls
        .map((c) => c[0])
        .filter((o) => o.kind !== "mark_read")
        .at(-1);
    press("E", { shiftKey: true, code: "KeyE" });
    await tick();
    expect(lastAct()).toMatchObject({ kind: "undone", threadIds: [ids[0]] });

    press("Backspace");
    await tick();
    expect(lastAct()).toMatchObject({ kind: "delete" });

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

  it("a bulk op the engine rejects keeps the selection and says why", async () => {
    const { engine, cursor } = await mount();
    const all = await engine.listThreads({
      view: { kind: "unified", role: "inbox" },
      tab: { kind: "personal" },
      limit: 100_000,
    });
    press("j");
    const before = cursor();
    press("a", mod());
    await tick();
    await tick();
    const region = `${all.rows.length} selected`;
    screen.getByRole("region", { name: region });
    const error = rs.spyOn(toast, "error");
    rs.spyOn(engine, "applyOp").mockRejectedValueOnce(new Error("invalid_thread_ids"));
    press("e");
    await tick();
    await tick();
    expect(error).toHaveBeenCalledTimes(1);
    // Nothing moved: the picks and the cursor are back where they were.
    screen.getByRole("region", { name: region });
    expect(cursor()).toBe(before);
    error.mockRestore();
  });
});

// ── specs/mail-improve.md MI-0 ────────────────────────────────────────────────

async function mountWithToaster(opts: { scenario?: "noAccount"[] } = {}) {
  const engine = createFakeMailEngine({
    fixture: generateFixture({ messages: 300 }),
    now: () => FIXTURE_NOW_MS,
    scenario: opts.scenario,
  });
  const store = createMailStore({ engine, accounts: await engine.listAccounts() });
  engine.subscribe((e) => {
    if (e.kind === "threads_changed")
      store.setState((s) => ({ threadsVersion: s.threadsVersion + 1 }));
  });
  const onViewChange = rs.fn<(view: MailView) => void>();
  render(<Toaster />);
  const ui = render(
    <TooltipProvider>
      <HotkeyScope scope="email">
        <MailShell
          store={store}
          now={() => FIXTURE_NOW_MS}
          onViewChange={onViewChange}
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
  return { ui, store, engine, onViewChange, cursor, rowIds };
}

const settle = async () => {
  for (let i = 0; i < 4; i++) await tick();
};

describe("triage shows one undo toast; hint line keeps keys (AC10)", () => {
  it("e: one toast 'Done · in Archive' with Undo and its key; the hint line is key hints", async () => {
    const { ui } = await mountWithToaster();
    press("j");
    press("e");
    await settle();
    await screen.findByText("Done · in Archive");
    const undo = screen.getByRole("button", { name: /^Undo/ });
    expect(undo.textContent).toContain(isMacPlatform() ? "⌘Z" : "Ctrl+Z");
    const hint = ui.container.querySelector('[data-slot="mail-hint-line"]')!.textContent;
    expect(hint).toBe("j k to move · e Done · s Snooze · t Task · ? all keys");
  });

  it("delete and a bulk Done say where they went", async () => {
    await mountWithToaster();
    press("j");
    press("Backspace");
    await settle();
    await screen.findByText("Deleted · in Trash");
    press("x");
    press("j");
    press("x");
    press("e");
    await settle();
    await screen.findByText("2 done · in Archive");
  });
});

describe("undo selects and opens the restored thread (AC11)", () => {
  it("z brings the thread back selected and open", async () => {
    const { cursor, rowIds } = await mountWithToaster();
    press("j");
    press("j");
    const done = cursor()!;
    press("e");
    await settle();
    expect(rowIds()).not.toContain(done);
    expect(cursor()).not.toBe(done);
    press("z");
    await settle();
    expect(rowIds()).toContain(done);
    expect(cursor()).toBe(done);
    screen.getByRole("heading", { name: `Reading ${done}` });
  });

  it("after the place changed, undo goes back to it first", async () => {
    const { cursor, onViewChange } = await mountWithToaster();
    press("j");
    const done = cursor()!;
    press("e");
    await settle();
    press("g");
    press("a");
    expect(onViewChange).toHaveBeenLastCalledWith({ kind: "unified", role: "archive" });
    press("z");
    await settle();
    expect(onViewChange).toHaveBeenLastCalledWith({ kind: "unified", role: "inbox" });
    expect(cursor()).toBe(done);
  });

  it("the toast's Undo button does the same", async () => {
    const { cursor } = await mountWithToaster();
    press("j");
    const done = cursor()!;
    press("e");
    await settle();
    fireEvent.click(await screen.findByRole("button", { name: /^Undo/ }));
    await settle();
    expect(cursor()).toBe(done);
  });
});

describe("opening a thread clears its unread dot (AC8)", () => {
  it("the dot goes the moment the thread opens", async () => {
    const { ui } = await mountWithToaster();
    const dotted = ui.container
      .querySelector<HTMLElement>("[data-unread-dot]")!
      .closest<HTMLElement>("[data-thread-id]")!;
    const id = dotted.dataset.threadId!;
    fireEvent.click(dotted);
    await settle();
    const row = ui.container.querySelector<HTMLElement>(`[data-thread-id="${id}"]`)!;
    expect(row.querySelector("[data-unread-dot]")).toBeNull();
  });
});

describe("first run dims places (AC25)", () => {
  it("places are aria-disabled with no account; dialogs use the scrim", async () => {
    const { ui } = await mountWithToaster({ scenario: ["noAccount"] });
    const inbox = within(ui.getByRole("navigation", { name: "Mail folders" })).getByRole("button", {
      name: /^Inbox/,
    });
    expect(inbox.getAttribute("aria-disabled")).toBe("true");
    cleanup();
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Connect</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!;
    expect(overlay.className).toContain("bg-(--scrim)");
    expect(overlay.className).not.toContain("bg-background/60");
  });
});
