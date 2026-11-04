import { afterEach, describe, expect, it } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { HotkeyScope } from "@/lib/hotkeys/scope";

import type { MailSpineCommands } from "../commands/spine";
import { createMailStore } from "../store/mail-store";
import { createFakeCompose } from "../testing/fake-compose";
import { createFakeMailEngine } from "../testing/fake-engine";
import { FIXTURE_NOW_MS, generateFixture } from "../testing/fixture";
import { MailPage } from "./mail-page";

afterEach(cleanup);

const tick = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

describe("/email on the engine (MR-16 cutover)", () => {
  it("lists the engine's threads and opens the deep-linked one in the reader", async () => {
    const engine = createFakeMailEngine({
      fixture: generateFixture({ messages: 200 }),
      now: () => FIXTURE_NOW_MS,
    });
    const store = createMailStore({ engine, accounts: await engine.listAccounts() });
    const first = (await engine.listThreads({ view: { kind: "unified", role: "inbox" }, limit: 1 }))
      .rows[0]!;
    let consumed = 0;
    const ui = render(
      <TooltipProvider>
        <HotkeyScope scope="email">
          <MailPage
            store={store}
            compose={createFakeCompose()}
            initialThreadId={first.threadId}
            onConsumeThreadDeepLink={() => consumed++}
          />
        </HotkeyScope>
      </TooltipProvider>,
    );
    await tick();
    await tick();
    expect(ui.container.querySelectorAll("[data-thread-id]").length).toBeGreaterThan(0);
    expect(ui.container.querySelector(`[data-reader-thread="${first.threadId}"]`)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Show original" }).length).toBeGreaterThan(0);
    expect(consumed).toBe(1);
  });

  it("opens compose filled from a pending mailto deep link, then on each nudge (AC24)", async () => {
    const engine = createFakeMailEngine({
      fixture: generateFixture({ messages: 50 }),
      now: () => FIXTURE_NOW_MS,
    });
    const store = createMailStore({ engine, accounts: await engine.listAccounts() });
    const queue = ["mailto:anna@x.test?subject=Cold%20launch&cc=c@x.test"];
    let nudge: (() => void) | null = null;
    const compose = {
      ...createFakeCompose(),
      takeMailto: async () => queue.splice(0),
      onMailto: (cb: () => void) => {
        nudge = cb;
        return () => (nudge = null);
      },
    };
    render(
      <TooltipProvider>
        <HotkeyScope scope="email">
          <MailPage store={store} compose={compose} now={() => FIXTURE_NOW_MS} />
        </HotkeyScope>
      </TooltipProvider>,
    );
    await tick();
    await tick();
    expect(screen.getByDisplayValue("Cold launch")).toBeTruthy();
    expect(screen.getByDisplayValue("anna@x.test")).toBeTruthy();
    queue.push("mailto:bob@x.test?subject=Warm%20link");
    await act(async () => (nudge as unknown as () => void)());
    await tick();
    await tick();
    expect(screen.getByDisplayValue("Warm link")).toBeTruthy();
  });

  async function mountPage(spine: MailSpineCommands | null = null) {
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
          <MailPage store={store} compose={null} spine={spine} now={() => FIXTURE_NOW_MS} />
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
    return { ui, rowIds, cursor };
  }

  function press(key: string) {
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          code: `Key${key.toUpperCase()}`,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  }

  it("snooze advances the selection like Done (AC14)", async () => {
    const { rowIds, cursor } = await mountPage();
    const before = rowIds();
    press("j");
    press("j");
    expect(cursor()).toBe(before[1]);
    press("s");
    await tick();
    fireEvent.click(screen.getByRole("button", { name: /Tomorrow/ }));
    await tick();
    await tick();
    expect(rowIds()).not.toContain(before[1]);
    expect(cursor()).toBe(before[2]);
  });

  it("t converts the open thread through the spine and offers Undo", async () => {
    const calls: string[] = [];
    const result = { plan: {} as never, undo: async () => {} };
    const spine = {
      convert: async (row: { threadId: string }) => (calls.push(`convert ${row.threadId}`), result),
      note: async (row: { threadId: string }) => (calls.push(`note ${row.threadId}`), result),
      link: async () => result,
      drop: async () => result,
      createEvent: async () => result,
    } as unknown as MailSpineCommands;
    const { rowIds } = await mountPage(spine);
    press("j");
    press("t");
    press("n");
    await tick();
    await tick();
    expect(calls).toEqual([`convert ${rowIds()[0]}`, `note ${rowIds()[0]}`]);
    screen.getByRole("complementary", { name: "Today" });
  });
});
