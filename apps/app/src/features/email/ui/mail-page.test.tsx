import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Toaster } from "sonner";

import { TooltipProvider } from "@/components/ui/tooltip";
import { HotkeyScope } from "@/lib/hotkeys/scope";

import type { MailSpineCommands } from "../commands/spine";
import { followUpDueMs } from "../compose/follow-up";
import { createMailStore } from "../store/mail-store";
import { createFakeCompose } from "../testing/fake-compose";
import { createFakeMailEngine } from "../testing/fake-engine";
import { FIXTURE_NOW_MS, generateFixture } from "../testing/fixture";
import { MailPage } from "./mail-page";

// The real dialog reads auth and workspace providers; this one shows what it was opened with.
rs.mock("./email-connect-dialog", () => ({
  EmailConnectDialog: (p: {
    isReconnect?: { id: string; email: string };
    initialProvider?: string;
  }) => (
    <div
      role="dialog"
      aria-label="Connect"
      data-reconnect={p.isReconnect?.email ?? ""}
      data-reconnect-id={p.isReconnect?.id ?? ""}
      data-provider={p.initialProvider ?? ""}
    />
  ),
}));

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

  describe("wiring the page (specs/mail-v3.md MV-3)", () => {
    async function mountWired(
      scenario: Parameters<typeof createFakeMailEngine>[0] extends infer O
        ? O extends { scenario?: infer S }
          ? S
          : never
        : never,
      extra: Partial<Parameters<typeof MailPage>[0]> = {},
      init: Partial<ReturnType<ReturnType<typeof createMailStore>["getState"]>> = {},
    ) {
      const engine = createFakeMailEngine({
        fixture: generateFixture({ messages: 200 }),
        now: () => FIXTURE_NOW_MS,
        scenario,
      });
      const store = createMailStore({
        engine,
        accounts: await engine.listAccounts(),
        counts: await engine.counts(),
        ...init,
      });
      engine.subscribe((e) => {
        if (e.kind === "counts") store.setState({ counts: e.counts });
        if (e.kind === "sync_status")
          store.setState((s) => ({
            accounts: s.accounts.map((a) =>
              a.id === e.accountId ? { ...a, syncState: e.state } : a,
            ),
          }));
      });
      const ui = render(
        <TooltipProvider>
          <HotkeyScope scope="email">
            <MailPage store={store} now={() => FIXTURE_NOW_MS} {...extra} />
          </HotkeyScope>
        </TooltipProvider>,
      );
      await tick();
      await tick();
      return { ui, engine, store };
    }

    it("the rail's Sync now syncs every account and Attachments opens the files place (AC12)", async () => {
      const synced: string[] = [];
      const { store } = await mountWired([], { syncAccount: (id) => void synced.push(id) });
      fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
      expect(synced).toEqual(store.getState().accounts.map((a) => a.id));

      fireEvent.click(screen.getByRole("button", { name: /^Attachments/ }));
      await tick();
      await tick();
      screen.getByRole("toolbar", { name: "Filter by type" });
      expect(
        screen.getByRole("button", { name: /^Attachments/ }).getAttribute("aria-current"),
      ).toBe("page");
      fireEvent.click(screen.getByRole("button", { name: /^Sent/ }));
      await tick();
      expect(screen.queryByRole("toolbar", { name: "Filter by type" })).toBeNull();
    });

    it("passes outbox count, custom tabs, offline and reconnect account", async () => {
      const synced: string[] = [];
      const compose = createFakeCompose({ now: () => FIXTURE_NOW_MS, scenario: ["outbox"] });
      const { engine, store } = await mountWired(["outbox", "reconnect", "error"], {
        compose,
        customTabs: [{ id: "tab-inv", label: "Investors" }],
        syncAccount: (id) => void synced.push(id),
      });
      const accounts = store.getState().accounts;
      const [first, second, third] = accounts;

      // AC1: the Outbox shows with its count and opens the queued messages.
      const outbox = screen.getByRole("button", { name: "Outbox, 1 waiting to send" });
      fireEvent.click(outbox);
      await tick();
      await tick();
      const list = screen.getByRole("list", { name: "Outbox" });
      expect(list.textContent).toContain("Pilot terms, signed");

      // AC2: the custom tab sits in the strip (on Inbox).
      fireEvent.click(screen.getByRole("button", { name: /^Inbox/ }));
      await tick();
      screen.getByRole("tab", { name: /Investors/ });

      // AC5: Reconnect opens the dialog in reconnect mode for that account.
      screen.getByText(`${second!.displayName} needs you to sign in again`);
      fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
      const dialog = screen.getByRole("dialog", { name: "Connect" });
      expect(dialog.getAttribute("data-reconnect")).toBe(second!.address);
      expect(dialog.getAttribute("data-reconnect-id")).toBe(second!.id);

      // AC5: Retry now runs Sync now for the account that couldn't sync.
      screen.getByText(`${third!.displayName} couldn't sync`);
      fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
      expect(synced).toEqual([third!.id]);

      // AC3: offline arrives without a reload: per account, then all of them.
      act(() => engine.setAccountState(first!.id, { syncState: "offline" }));
      screen.getByText(`${first!.displayName} is offline`);
      expect(screen.queryByText("Offline, changes will sync")).toBeNull();
      act(() => {
        for (const a of accounts) engine.setAccountState(a.id, { syncState: "offline" });
      });
      screen.getByText("Offline, changes will sync");
      screen.getByText("1 message waits in Outbox.");
    });

    it("shows the away line and Dismiss clears it (AC4)", async () => {
      const { store } = await mountWired([], {}, { awayReturned: ["t-a", "t-b"] });
      screen.getByText("2 emails came back while you were away");
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(store.getState().awayReturned).toEqual([]);
      expect(screen.queryByText(/came back while you were away/)).toBeNull();
    });

    it("the first-run card opens the connect dialog on the chosen provider", async () => {
      await mountWired(["noAccount"]);
      fireEvent.click(screen.getByRole("button", { name: "iCloud" }));
      expect(screen.getByRole("dialog", { name: "Connect" }).getAttribute("data-provider")).toBe(
        "icloud",
      );
    });

    it("hands the composer correspondents, and a snippet's first name from them", async () => {
      const compose = createFakeCompose({
        now: () => FIXTURE_NOW_MS,
        correspondents: [{ name: "Ana Lima", email: "ana@acme.test", count: 3 }],
      });
      await mountWired([], {
        compose,
        snippets: [{ id: "s1", name: "thx", body: "Thanks {first name}!" }],
      });
      press("c");
      await tick();
      await tick();
      fireEvent.change(screen.getByLabelText("To"), { target: { value: "an" } });
      fireEvent.click(
        within(screen.getByRole("listbox", { name: "Suggestions" })).getByRole("button", {
          name: /Ana Lima/,
        }),
      );
      await tick();
      fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hi ;;th" } });
      fireEvent.click(screen.getByRole("button", { name: "thx" }));
      await tick();
      expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
        "Hi Thanks Ana!",
      );
    });

    it("undo send toast copy and edit", async () => {
      const engine = createFakeMailEngine({
        fixture: generateFixture({ messages: 200 }),
        now: () => FIXTURE_NOW_MS,
      });
      const store = createMailStore({ engine, accounts: await engine.listAccounts() });
      const compose = createFakeCompose({ now: () => FIXTURE_NOW_MS });
      render(<Toaster />);
      const ui = render(
        <TooltipProvider>
          <HotkeyScope scope="email">
            <MailPage store={store} compose={compose} now={() => FIXTURE_NOW_MS} />
          </HotkeyScope>
        </TooltipProvider>,
      );
      await tick();
      await tick();
      press("j");
      const open = ui.container.querySelector<HTMLElement>(
        '[aria-selected="true"][data-thread-id]',
      )!.dataset.threadId!;
      const last = (await engine.getThread(open))!.messages.at(-1)!;
      const firstName = last.from.name.split(" ")[0];
      press("r");
      await tick();
      await tick();
      const reply = screen.getByRole("region", { name: "Reply" });
      // " · reminds you {Thu}" when the reply set a follow-up.
      fireEvent.change(within(reply).getByLabelText("Follow-up"), { target: { value: "3d" } });
      await tick();
      fireEvent.click(within(reply).getByRole("button", { name: "Send" }));
      await tick();
      await tick();
      const day = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
        new Date(followUpDueMs("3d", FIXTURE_NOW_MS)),
      );
      // The countdown runs to the engine's send time: 10 s (the default window) from now.
      await screen.findByText(
        `Reply to ${firstName} sends in 10 s · thread marked Done · reminds you ${day}`,
      );
      expect(screen.queryByRole("region", { name: "Reply" })).toBeNull();
      expect((await compose.listOutbox()).length).toBe(1);

      // Edit pulls it back from the Outbox and reopens it.
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      await tick();
      await tick();
      screen.getByRole("region", { name: "Reply" });
      expect((await compose.listOutbox()).length).toBe(0);
    });

    it("failed send shows Not sent and Fix and send", async () => {
      const compose = createFakeCompose({ now: () => FIXTURE_NOW_MS, scenario: ["sendFailed"] });
      await mountWired([], { compose });
      fireEvent.click(screen.getByRole("button", { name: /^Drafts/ }));
      await tick();
      await tick();
      const failed = screen.getByRole("list", { name: "Not sent" });
      expect(failed.textContent).toContain("Deck for Thursday");
      expect(failed.textContent).toContain(
        "Not sent: The server refused the address dana@northzone.tst",
      );
      fireEvent.click(screen.getByRole("button", { name: "Fix and send" }));
      await tick();
      // AC11: the composer reopens that draft, its reason shown.
      const composer = screen.getByRole("region", { name: "New message" });
      expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe(
        "Deck for Thursday",
      );
      expect(composer.textContent).toContain(
        "Not sent: The server refused the address dana@northzone.tst",
      );
    });
  });
});
