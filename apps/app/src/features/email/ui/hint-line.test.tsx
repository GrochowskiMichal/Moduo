import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { HotkeyScope } from "@/lib/hotkeys/scope";
import type { MailView } from "@/lib/runtime.types.mail-engine";

import { createMailStore } from "../store/mail-store";
import { createFakeMailEngine } from "../testing/fake-engine";
import { FIXTURE_NOW_MS, generateFixture } from "../testing/fixture";
import { HINT_MS, MailHintLine, restHint, useMailHint } from "./hint-line";
import { MailShell } from "./mail-shell";

afterEach(() => {
  cleanup();
  rs.useRealTimers();
});

const INBOX: MailView = { kind: "unified", role: "inbox" };
const line = (c: HTMLElement) =>
  c.querySelector<HTMLElement>('[data-slot="mail-hint-line"]')?.textContent ?? null;

let api: ReturnType<typeof useMailHint> | null = null;
function Harness({ enabled = true }: { enabled?: boolean }) {
  const h = useMailHint(true);
  api = h;
  return <MailHintLine enabled={enabled} rest={restHint(INBOX, true)} hint={h.hint} />;
}

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

describe("the hint line (specs/mail-v3.md §5, AC19)", () => {
  it("rest, after key, after click", () => {
    rs.useFakeTimers();
    const ui = render(<Harness />);
    expect(line(ui.container)).toBe("e Done · s Snooze · t Task");

    // After a key: what it did, for 4 s, then back to rest.
    act(() => api!.result("done"));
    expect(line(ui.container)).toBe("Done, in Archive · ⌘Z undoes");
    act(() => rs.advanceTimersByTime(HINT_MS - 1));
    expect(line(ui.container)).toBe("Done, in Archive · ⌘Z undoes");
    act(() => rs.advanceTimersByTime(1));
    expect(line(ui.container)).toBe("e Done · s Snooze · t Task");

    // After a pointer action: the key that does it, for 4 s.
    act(() => api!.teach("e"));
    expect(line(ui.container)).toBe("Next time press e");
    act(() => rs.advanceTimersByTime(HINT_MS));
    expect(line(ui.container)).toBe("e Done · s Snooze · t Task");

    // A snooze names when it returns.
    act(() => api!.result("snooze", { untilMs: new Date(2026, 10, 9, 9, 0).getTime() }));
    expect(line(ui.container)).toBe("Snoozed until Mon 9:00 · ⌘Z undoes");
    cleanup();

    // "Show key hints" off: no line at all.
    const off = render(<Harness enabled={false} />);
    expect(line(off.container)).toBeNull();
  });

  it("the shell feeds it: a key shows the result, a click teaches the key", async () => {
    const engine = createFakeMailEngine({
      fixture: generateFixture({ messages: 200 }),
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
    expect(line(ui.container)).toBe("e Done · s Snooze · t Task");
    press("j");
    press("e");
    await tick();
    expect(line(ui.container)).toMatch(/^Done, in Archive · (⌘Z|Ctrl\+Z) undoes$/);

    const row = ui.container.querySelector<HTMLElement>("[data-thread-id]")!;
    fireEvent.click(row.querySelector('[data-row-control="Done"]')!);
    await tick();
    expect(line(ui.container)).toBe("Next time press e");
    screen.getByText("e", { selector: "kbd" });
  });
});
