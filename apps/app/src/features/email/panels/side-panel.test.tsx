// Mail's side panel (specs/mail-v3.md §10, AC34): the panel toggles, ⌥1–3
// switch its views (and open it while hidden), its menu hides it, and below
// 1200 px it starts hidden. Today, Contact and Task show what §10 lists.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { HotkeyScope } from "@/lib/hotkeys/scope";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import type { MailThreadLink } from "../commands/spine";
import { createMailStore, type MailStore } from "../store/mail-store";
import { createFakeMailEngine } from "../testing/fake-engine";
import { FIXTURE_NOW_MS, generateFixture } from "../testing/fixture";
import { MailPage } from "../ui/mail-page";
import { MAIL_THREAD_MIME } from "../ui/mail-page-wiring";
import { MailSidePanel, type MailSidePanelProps, toggleMailPanel } from "./side-panel";

afterEach(cleanup);

const tick = () => act(async () => await new Promise((r) => setTimeout(r, 0)));
const pointer = { button: 0, pointerType: "mouse" } as const;
const NOW = new Date(2026, 10, 6, 11, 0).getTime();

let width = 1400;
beforeEach(() => {
  width = 1400;
  Object.defineProperty(window, "innerWidth", { configurable: true, get: () => width });
});

const row = (sender: { name: string; email: string }) =>
  ({ threadId: "t1", senders: [sender] }) as unknown as MailThreadRow;

function mount(store: MailStore, over: Partial<MailSidePanelProps> = {}) {
  const props: MailSidePanelProps = {
    store,
    threadId: null,
    engine: null,
    version: 0,
    nowMs: NOW,
    today: {
      tasks: [{ id: "k1", title: "Send the contract" }],
      events: [
        {
          id: "e1",
          title: "Standup",
          startMs: NOW - 2 * 3600e3,
          endMs: NOW - 3600e3,
          allDay: false,
        },
        {
          id: "e2",
          title: "Board call",
          startMs: NOW + 3600e3,
          endMs: NOW + 7200e3,
          allDay: false,
        },
      ],
      date: "2026-11-06",
      onDropThread: () => {},
    },
    links: null,
    rowOf: async () => null,
    selfAddresses: ["me@x.test"],
    contacts: new Set(),
    onOpenThread: () => {},
    onPreview: () => {},
    ...over,
  };
  return render(
    <TooltipProvider>
      <HotkeyScope scope="email">
        <MailSidePanel {...props} />
      </HotkeyScope>
    </TooltipProvider>,
  );
}

function alt(n: number) {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: String(n),
        code: `Digit${n}`,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

const panelName = () => screen.queryByRole("complementary")?.getAttribute("aria-label") ?? null;

describe("the side panel (§10, AC34)", () => {
  it("toggle, ⌥1–3, hidden under 1200", async () => {
    const store = createMailStore();
    mount(store, { threadId: "t1", links: { read: async () => [], open() {}, unlink() {} } });
    expect(panelName()).toBe("Today");

    // The panel button hides it and brings the last view back.
    act(() => toggleMailPanel(store));
    expect(panelName()).toBeNull();
    act(() => toggleMailPanel(store));
    expect(panelName()).toBe("Today");

    // The right panel's own ⌥ keys while it shows.
    alt(2);
    expect(panelName()).toBe("Contact");
    expect(store.getState().panel).toBe("contact");
    alt(3);
    await tick();
    expect(panelName()).toBe("Task");
    screen.getByText(
      (_, el) => el?.tagName === "P" && el.textContent === "No task yet · t makes one",
    );

    // The view menu lists the three views and Hide.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Panel view: Task" }), pointer);
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((i) => i.textContent?.replace(/⌥\d|Alt \d/, "")),
    ).toEqual(["Today", "Contact", "Task"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Hide" }));
    expect(panelName()).toBeNull();
    expect(store.getState().panel).toBeNull();

    cleanup();

    // On the page, under 1200 px: it starts hidden, ⌥2 opens Contact (the shell's
    // key while hidden), and the reader's panel button hides it and brings it back.
    width = 1100;
    const engine = createFakeMailEngine({
      fixture: generateFixture({ messages: 60 }),
      now: () => FIXTURE_NOW_MS,
    });
    const page = createMailStore({ engine, accounts: await engine.listAccounts() });
    const first = (await engine.listThreads({ view: { kind: "unified", role: "inbox" }, limit: 1 }))
      .rows[0]!;
    render(
      <TooltipProvider>
        <HotkeyScope scope="email">
          <MailPage
            store={page}
            compose={null}
            initialThreadId={first.threadId}
            now={() => FIXTURE_NOW_MS}
          />
        </HotkeyScope>
      </TooltipProvider>,
    );
    await tick();
    await tick();
    const shown = () =>
      document.querySelector<HTMLElement>("[data-mail-panel]")?.dataset.mailPanel ?? null;
    expect(shown()).toBeNull();
    expect(page.getState().panel).toBeNull();
    alt(2);
    expect(shown()).toBe("contact");
    alt(1);
    expect(shown()).toBe("today");
    alt(3);
    expect(shown()).toBe("task");
    fireEvent.click(screen.getByRole("button", { name: "Hide the side panel" }));
    expect(shown()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Today, contact and task" }));
    expect(shown()).toBe("task");
  });

  it("Today: the date, the due-today count, past events muted, the drop hint while dragging", () => {
    const store = createMailStore();
    const view = mount(store);
    const aside = view.getByRole("complementary", { name: "Today" });
    within(aside).getByText("Today · Fri 6 Nov");
    expect(aside.querySelector("[data-due-count]")?.textContent).toBe("1");
    within(aside).getByText("Send the contract");
    const events = within(aside).getByRole("list", { name: "Today's events" });
    const items = within(events).getAllByRole("listitem");
    expect(items.map((i) => i.dataset.past ?? "")).toEqual(["true", ""]);

    expect(within(aside).queryByText("Drop a thread here to do it today")).toBeNull();
    const start = new Event("dragstart", { bubbles: true });
    Object.defineProperty(start, "dataTransfer", { value: { types: [MAIL_THREAD_MIME] } });
    act(() => {
      document.body.dispatchEvent(start);
    });
    within(aside).getByText("Drop a thread here to do it today");
    act(() => {
      document.body.dispatchEvent(new Event("dragend", { bubbles: true }));
    });
    expect(within(aside).queryByText("Drop a thread here to do it today")).toBeNull();
  });

  it("Contact: the head, last touch, what is open with them, Open in Contacts", async () => {
    const store = createMailStore({ panel: "contact" });
    const opened: string[] = [];
    mount(store, {
      threadId: "t1",
      rowOf: async () => row({ name: "Ana Ruiz", email: "ana@acme.test" }),
      whoFor: async () => ({
        contactId: "c1",
        name: "Ana Ruiz",
        role: "Designer",
        company: "Acme",
        lastTouch: "Emailed today 8:12",
        openTasks: 1,
        notes: 1,
        nextMeeting: null,
      }),
      contactDetailFor: async () => ({
        tasks: [{ id: "k9", title: "Hero photo options", due: "Fri 6 Nov" }],
        notes: [{ id: "n1", title: "Relaunch notes" }],
        meetings: [{ id: "m1", title: "Copy review", when: "Mon 10:00" }],
      }),
      onOpenContact: (id) => opened.push(id),
    });
    await tick();
    await tick();
    const aside = screen.getByRole("complementary", { name: "Contact" });
    within(aside).getByText("Ana Ruiz");
    within(aside).getByText("Designer · Acme");
    within(aside).getByText("Emailed today 8:12");
    within(within(aside).getByRole("region", { name: "Open tasks" })).getByText(
      "Hero photo options",
    );
    within(within(aside).getByRole("region", { name: "Notes" })).getByText("Relaunch notes");
    within(within(aside).getByRole("region", { name: "Meetings" })).getByText("Copy review");
    within(aside).getByRole("region", { name: "All mail with this person" });
    fireEvent.click(within(aside).getByRole("button", { name: /Open in Contacts/ }));
    expect(opened).toEqual(["c1"]);
  });

  it("Contact: an unknown sender gets Add as contact, prefilled", async () => {
    const store = createMailStore({ panel: "contact" });
    const added = rs.fn();
    mount(store, {
      threadId: "t1",
      rowOf: async () => row({ name: "Dana Whitfield", email: "dana@fjord.test" }),
      whoFor: async () => null,
      onAddContact: added,
    });
    await tick();
    await tick();
    const aside = screen.getByRole("complementary", { name: "Contact" });
    within(aside).getByText(/Not in your contacts/);
    fireEvent.click(within(aside).getByRole("button", { name: /Add as contact/ }));
    expect(added).toHaveBeenCalledWith("dana@fjord.test", "Dana Whitfield");
  });

  it("Task: the linked task's title, status, due, project, notes and Open in Tasks", async () => {
    const store = createMailStore({ panel: "task" });
    const link: MailThreadLink = {
      linkId: "l1",
      entity: { type: "task", id: "k1", label: "Hero photo options" },
      source: { type: "task", id: "k1" },
      target: { type: "email_thread", id: "r1" },
      relationKind: "spawned-from",
    };
    const openTask = rs.fn();
    mount(store, {
      threadId: "t1",
      links: { read: async () => [link], open() {}, unlink() {} },
      taskFor: () => ({
        id: "k1",
        title: "Hero photo options for the relaunch",
        status: "To do",
        due: "Fri 6 Nov",
        project: "Relaunch",
        notes: "Pick three for Ana.",
      }),
      onOpenTask: openTask,
    });
    await tick();
    const aside = screen.getByRole("complementary", { name: "Task" });
    within(aside).getByText("Hero photo options for the relaunch");
    within(aside).getByText("To do");
    within(aside).getByText("Fri 6 Nov");
    within(aside).getByText("Relaunch");
    within(aside).getByText("Pick three for Ana.");
    fireEvent.click(within(aside).getByRole("button", { name: /Open in Tasks/ }));
    expect(openTask).toHaveBeenCalledWith("k1");
  });
});
