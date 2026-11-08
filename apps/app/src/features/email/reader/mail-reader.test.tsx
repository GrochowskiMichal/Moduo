import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { MailAccount, MailThread } from "@/lib/runtime.types.mail-engine";

import type { MailThreadLink } from "../commands/spine";
import { message, NOW, oneThreadEngine, row } from "../testing/reader-kit";
import { MailReader, type MailReaderProps } from "./mail-reader";
import { linkPickerHint, type ReaderLinks } from "./thread-links";

afterEach(cleanup);

const tick = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

const behavior = { remoteImages: "block", trackerBlocking: true } as const;

const TASK: MailThreadLink = {
  linkId: "l-task",
  entity: { type: "task", id: "task-1", label: "Confirm Acme pilot" },
  source: { type: "task", id: "task-1" },
  target: { type: "email_thread", id: "ref-1" },
  relationKind: "spawned-from",
};
const NOTE: MailThreadLink = {
  linkId: "l-note",
  entity: { type: "note", id: "note-1", label: "Acme: Weekly sync" },
  source: { type: "note", id: "note-1" },
  target: { type: "email_thread", id: "ref-1" },
  relationKind: "references",
};

const account = (syncState: MailAccount["syncState"]): MailAccount => ({
  id: "acc-1",
  address: "robin@me.test",
  displayName: "Work",
  provider: "gmail",
  hue: 200,
  syncState,
  backfillProgress: null,
  lastError: null,
});

function mount(thread: () => MailThread, extra: Partial<MailReaderProps> = {}) {
  const engine = oneThreadEngine(thread);
  const props: MailReaderProps = {
    engine,
    threadId: thread().row.threadId,
    version: 0,
    behavior,
    now: () => NOW,
    selfAddresses: ["robin@me.test"],
    ...extra,
  };
  const ui = render(
    <TooltipProvider>
      <MailReader {...props} />
    </TooltipProvider>,
  );
  const rerender = (more: Partial<MailReaderProps>) =>
    ui.rerender(
      <TooltipProvider>
        <MailReader {...props} {...more} />
      </TooltipProvider>,
    );
  return { ...ui, rerender };
}

describe("reader (specs/mail-v3.md §8)", () => {
  it("toolbar, chips from links, link chip", async () => {
    const thread: MailThread = {
      row: row({
        pinned: true,
        followUpAtMs: NOW + 86_400_000, // Fri
        snoozedUntilMs: NOW + 4 * 86_400_000 - 3_600_000, // Mon 9:00 local-ish
      }),
      messages: [message()],
    };
    const links: ReaderLinks = {
      read: rs.fn(async () => [TASK, NOTE]),
      open: rs.fn(),
      unlink: rs.fn(),
    };
    const onAction = rs.fn();
    mount(() => thread, { links, onAction });
    await tick();
    await tick();

    const bar = screen.getByRole("toolbar", { name: "Conversation actions" });
    const names = within(bar)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      "Reply",
      "Reply all",
      "Forward",
      "Done",
      "Snooze",
      "Remind me if no reply",
      "Open the task",
      "Link to a task, contact or note",
      "Open the private note",
      "Unpin",
      "Move",
    ]);
    // Pressed tools carry the dot's state.
    for (const name of ["Snooze", "Remind me if no reply", "Open the task", "Unpin"])
      expect(within(bar).getByRole("button", { name }).getAttribute("aria-pressed")).toBe("true");
    expect(
      within(bar).getByRole("button", { name: "Done" }).getAttribute("aria-pressed"),
    ).toBeNull();

    fireEvent.click(within(bar).getByRole("button", { name: "Reply" }));
    expect(onAction).toHaveBeenCalledWith("reply", "t1");
    // A pressed Task opens the task it made instead of making another.
    fireEvent.click(within(bar).getByRole("button", { name: "Open the task" }));
    expect(links.open).toHaveBeenCalledWith(TASK);

    const chips = screen.getByRole("group", { name: "What this thread is to you" });
    within(chips).getByText(/^Waiting · reminds /);
    within(chips).getByText(/^Returns /);
    fireEvent.click(within(chips).getByRole("button", { name: "Task: Confirm Acme pilot" }));
    expect(links.open).toHaveBeenLastCalledWith(TASK);
    within(chips).getByRole("button", { name: "Acme: Weekly sync" });
    fireEvent.click(within(chips).getByRole("button", { name: "Unlink Task: Confirm Acme pilot" }));
    expect(links.unlink).toHaveBeenCalledWith(TASK);

    const linkChip = within(chips).getByRole("button", { name: "Link to a task, contact or note" });
    expect(linkChip.textContent).toBe("l");
    fireEvent.click(linkChip);
    expect(onAction).toHaveBeenLastCalledWith("link", "t1");
    expect(links.read).toHaveBeenCalledWith("t1");
  });

  it("Done chip from Archive, and nothing linked without a spine", async () => {
    mount(() => ({ row: row(), messages: [message()] }), { done: true });
    await tick();
    const chips = screen.getByRole("group", { name: "What this thread is to you" });
    within(chips).getByText("Done");
    expect(within(chips).queryByRole("button", { name: /Link to/ })).toBeNull();
  });

  it("the link picker marks what the thread already links to", () => {
    const linked = [TASK.entity, NOTE.entity];
    expect(linkPickerHint(linked, { type: "task", id: "task-1" })).toBe("Linked");
    expect(linkPickerHint(linked, { type: "task", id: "task-2" })).toBe("Task");
    expect(linkPickerHint(linked, { type: "contact", id: "c-1" })).toBe("Contact");
  });

  it("body pending online and offline", async () => {
    let body: MailThread = {
      row: row(),
      messages: [
        message({
          bodyState: "text_only",
          attachments: [
            {
              id: "a1",
              filename: "Acme-rollout-v3.pdf",
              mime: "application/pdf",
              size: 4096,
              isInline: false,
              contentId: null,
            },
          ],
        }),
      ],
    };
    const ui = mount(() => body, { accounts: [account("idle")] });
    await tick();
    screen.getByText("Downloading the rest of this message…");
    screen.getByRole("progressbar", { name: "Downloading the message" });
    screen.getByText("Can you confirm by Thursday?");

    // That account goes offline: the offline copy, attachments as pending tiles.
    body = { ...body, messages: [{ ...body.messages[0]!, bodyState: "none", text: null }] };
    ui.rerender({ accounts: [account("offline")], version: 1 });
    await tick();
    screen.getByText("Available when you're back online");
    expect(screen.queryByText("Downloading the rest of this message…")).toBeNull();
    const tile = within(screen.getByRole("list", { name: "Attachments" })).getByText(
      "Acme-rollout-v3.pdf",
    );
    expect(tile.closest("li")?.textContent).toContain("when online");

    // Back online, the engine fetched it and `threads_changed` bumped the version: it swaps in.
    body = {
      ...body,
      messages: [
        { ...body.messages[0]!, bodyState: "full", text: "Final answer: week of 16 Nov." },
      ],
    };
    ui.rerender({ accounts: [account("idle")], version: 2 });
    await tick();
    screen.getByText("Final answer: week of 16 Nov.");
    expect(screen.queryByText("Available when you're back online")).toBeNull();
  });

  it("a reconnect account says changes wait", async () => {
    const reconnect = { ...account("reconnect"), lastError: "invalid_grant" };
    mount(() => ({ row: row(), messages: [message()] }), { accounts: [reconnect] });
    await tick();
    screen.getByText("Work needs you to sign in again; your changes wait.");
  });

  it("Show original sits in the ⋯ menu", async () => {
    const getRawMessage = rs.fn(async () => "Message-ID: <m1@acme.test>\r\n\r\nraw body");
    const engine = oneThreadEngine(() => ({ row: row(), messages: [message()] }), {
      getRawMessage,
    });
    render(
      <TooltipProvider>
        <MailReader engine={engine} threadId="t1" version={0} behavior={behavior} />
      </TooltipProvider>,
    );
    await tick();
    expect(screen.queryByRole("button", { name: "Show original" })).toBeNull();
    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), {
      button: 0,
      pointerType: "mouse",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Show original" }));
    await tick();
    expect(getRawMessage).toHaveBeenCalledWith("m1", "t1");
    expect(screen.getByLabelText("Original message").textContent).toContain("raw body");
  });
});

// specs/mail-improve.md MI-0, AC3 and AC16: one reading width for every thread (the
// thread column capped at --measure-thread, message text at --measure-reading), the
// title unclamped, the link chip labelled, and a sticky subject while composing.
describe("thread column uses the measure tokens (AC3, AC16)", () => {
  it("the tokens exist", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(process.cwd(), "src/styles/tokens.css"), "utf8");
    expect(css).toMatch(/--measure-thread:\s*48rem/);
    expect(css).toMatch(/--measure-reading:\s*70ch/);
    expect(css).toMatch(/--scrim:\s*color-mix\(in oklab, var\(--background\) 82%, transparent\)/);
  });

  it("column and text measures, an unclamped title, the Link… chip", async () => {
    const long = "A".repeat(80) + " the subject keeps going " + "B".repeat(80);
    const thread: MailThread = { row: row({ subject: long }), messages: [message()] };
    const links: ReaderLinks = { read: async () => [], open() {}, unlink() {} };
    const ui = mount(() => thread, { links, onAction: () => {} });
    await tick();
    await tick();
    const column = ui.container.querySelector<HTMLElement>("[data-thread-column]")!;
    expect(column.className).toContain("max-w-(--measure-thread)");
    // Left-aligned: no auto margins.
    expect(column.className).not.toContain("mx-auto");
    const body = ui.container.querySelector<HTMLElement>("[data-message-body]")!;
    expect(body.className).toContain("max-w-(--measure-reading)");
    const title = screen.getByRole("heading", { name: long });
    expect(title.className).not.toMatch(/line-clamp|truncate/);
    const chip = screen.getByRole("button", { name: /^Link…/ });
    expect(chip.textContent).toContain("Link…");
    expect(chip.querySelector("kbd")?.textContent).toBe("l");
  });

  it("while composing, a compact subject stays once the title scrolls away", async () => {
    const seen: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
    const Original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        seen.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof IntersectionObserver;
    try {
      const thread: MailThread = { row: row({ subject: "Pilot week" }), messages: [message()] };
      const ui = mount(() => thread, { composer: <div>composer</div> });
      await tick();
      await tick();
      expect(ui.container.querySelector("[data-sticky-subject]")).toBeNull();
      act(() => seen.forEach((cb) => cb([{ isIntersecting: false }])));
      const sticky = ui.container.querySelector<HTMLElement>("[data-sticky-subject]")!;
      expect(sticky.textContent).toContain("Pilot week");
      expect(sticky.className).toContain("sticky");
      act(() => seen.forEach((cb) => cb([{ isIntersecting: true }])));
      expect(ui.container.querySelector("[data-sticky-subject]")).toBeNull();
      cleanup();
      // Not composing: no sticky subject, even scrolled.
      const plain = mount(() => thread);
      await tick();
      act(() => seen.forEach((cb) => cb([{ isIntersecting: false }])));
      expect(plain.container.querySelector("[data-sticky-subject]")).toBeNull();
    } finally {
      globalThis.IntersectionObserver = Original;
    }
  });
});
