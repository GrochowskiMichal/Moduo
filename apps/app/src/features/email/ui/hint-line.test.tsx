// The hint line (specs/mail-v3.md §5; specs/mail-improve.md §3, AC10): key hints only.
// What an action did is the undo toast's; the key a click could have used rides in
// that toast's description.

import { afterEach, describe, expect, it } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Toaster } from "sonner";

import { TooltipProvider } from "@/components/ui/tooltip";
import { HotkeyScope } from "@/lib/hotkeys/scope";
import type { MailView } from "@/lib/runtime.types.mail-engine";

import { createMailStore } from "../store/mail-store";
import { createFakeMailEngine } from "../testing/fake-engine";
import { FIXTURE_NOW_MS, generateFixture } from "../testing/fixture";
import { MailHintLine, restHint, triageToastLabel } from "./hint-line";
import { MailShell } from "./mail-shell";

afterEach(cleanup);

const INBOX: MailView = { kind: "unified", role: "inbox" };
const REST = "j k to move · e Done · s Snooze · t Task · ? all keys";
const line = (c: HTMLElement) =>
  c.querySelector<HTMLElement>('[data-slot="mail-hint-line"]')?.textContent ?? null;

const tick = () => act(async () => await new Promise((r) => setTimeout(r, 0)));
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

describe("the hint line (AC10)", () => {
  it("rest, a waiting chord, off", () => {
    const ui = render(<MailHintLine enabled rest={restHint(INBOX, true)} />);
    expect(line(ui.container)).toBe(REST);
    ui.rerender(<MailHintLine enabled rest={restHint(INBOX, true)} chord="g" />);
    expect(line(ui.container)).toBe("g…");
    cleanup();
    const off = render(<MailHintLine enabled={false} rest={REST} />);
    expect(line(off.container)).toBeNull();
  });

  it("toast words: where the threads went", () => {
    expect(triageToastLabel("done", 1)).toBe("Done · in Archive");
    expect(triageToastLabel("done", 3)).toBe("3 done · in Archive");
    expect(triageToastLabel("delete", 1)).toBe("Deleted · in Trash");
    expect(triageToastLabel("move", 1, undefined, "Receipts")).toBe("Moved · to Receipts");
    expect(triageToastLabel("snooze", 1, { untilMs: new Date(2026, 10, 9, 9, 0).getTime() })).toBe(
      "Snoozed · until Mon 9:00",
    );
  });

  it("the shell: a key leaves the line alone; a click's toast teaches the key", async () => {
    const engine = createFakeMailEngine({
      fixture: generateFixture({ messages: 200 }),
      now: () => FIXTURE_NOW_MS,
    });
    const store = createMailStore({ engine, accounts: await engine.listAccounts() });
    engine.subscribe((e) => {
      if (e.kind === "threads_changed")
        store.setState((s) => ({ threadsVersion: s.threadsVersion + 1 }));
    });
    render(<Toaster />);
    const ui = render(
      <TooltipProvider>
        <HotkeyScope scope="email">
          <MailShell store={store} now={() => FIXTURE_NOW_MS} />
        </HotkeyScope>
      </TooltipProvider>,
    );
    await tick();
    await tick();
    expect(line(ui.container)).toBe(REST);
    press("j");
    press("e");
    await tick();
    expect(line(ui.container)).toBe(REST);

    const row = ui.container.querySelector<HTMLElement>("[data-thread-id]")!;
    fireEvent.click(row.querySelector('[data-row-control="Done"]')!);
    await tick();
    await tick();
    await screen.findByText("Next time press e");
    expect(line(ui.container)).toBe(REST);
  });
});
