import { afterEach, describe, expect, it } from "@rstest/core";
import { act, cleanup, render, screen } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { HotkeyScope } from "@/lib/hotkeys/scope";

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
});
