import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { HotkeyScope } from "@/lib/hotkeys/scope";
import { createTauriMailEngine } from "@/lib/runtime.tauri.mail-engine";
import type { MailAccount, MailMailbox } from "@/lib/runtime.types.mail-engine";

import { createMailCommands } from "../commands/triage";
import { createMailStore } from "../store/mail-store";
import { createFakeMailEngine } from "../testing/fake-engine";
import { FIXTURE_NOW_MS, generateFixture } from "../testing/fixture";
import { MailRail } from "./mail-rail";
import { MailShell } from "./mail-shell";
import { railAccounts, syncTooltip } from "./rail-counts";

afterEach(cleanup);

const account = (syncState: MailAccount["syncState"], backfillProgress: number | null) =>
  ({
    id: "a1",
    address: "me@x.com",
    displayName: "Me",
    provider: "imap",
    hue: 0,
    syncState,
    backfillProgress,
    lastError: null,
  }) as MailAccount;

function setup(acc: MailAccount) {
  const invoked: [string, unknown][] = [];
  const engine = createTauriMailEngine(async <T,>(cmd: string, args?: Record<string, unknown>) => {
    invoked.push([cmd, args]);
    return undefined as T;
  });
  const store = createMailStore();
  store.setState({ engine });
  const commands = createMailCommands(store);
  render(
    <TooltipProvider>
      <MailRail
        current={{ kind: "unified", role: "inbox" }}
        counts={null}
        accounts={[acc]}
        mailboxes={{}}
        hues={{}}
        outboxCount={0}
        screenerOn={false}
        onSelect={() => {}}
        onConnect={() => {}}
        onLoadHistory={(id) => void commands.backfill(id)}
        onCancelBackfill={(id) => void commands.cancelBackfill(id)}
      />
    </TooltipProvider>,
  );
  return invoked;
}

describe("rail history backfill (AC6)", () => {
  it("Load more history starts a backfill on the engine, inside the expanded tree", async () => {
    const invoked = setup(account("idle", null));
    expect(screen.queryByRole("button", { name: "Load more history" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show folders for Me" }));
    fireEvent.click(screen.getByRole("button", { name: "Load more history" }));
    await waitFor(() => expect(invoked).toEqual([["mail_backfill", { accountId: "a1" }]]));
  });

  it("while backfilling it shows progress with Cancel instead", async () => {
    const invoked = setup(account("backfilling", 0.4));
    fireEvent.click(screen.getByRole("button", { name: "Show folders for Me" }));
    expect(screen.queryByRole("button", { name: "Load more history" })).toBeNull();
    expect(screen.getByText("Syncing history · 40%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(invoked).toEqual([["mail_cancel_backfill", { accountId: "a1" }]]));
  });
});

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);

const acc = (id: string, label: string, patch: Partial<MailAccount> = {}): MailAccount => ({
  id,
  address: `${id}@x.test`,
  displayName: label,
  provider: "imap",
  hue: 0,
  syncState: "idle",
  backfillProgress: null,
  lastError: null,
  lastSyncedMs: NOW - 120_000,
  ...patch,
});

const box = (accountId: string, role: MailMailbox["role"], unread = 0, total = 0): MailMailbox => ({
  id: `${accountId}:${role}`,
  accountId,
  name: role === "inbox" ? "INBOX" : role,
  path: role,
  role,
  unread,
  total,
});

type RailProps = ComponentProps<typeof MailRail>;

function renderRail(patch: Partial<RailProps> = {}) {
  const calls: string[] = [];
  const props: RailProps = {
    current: { kind: "unified", role: "inbox" },
    counts: { byViewKey: { "unified:inbox": 12 }, badge: 12, outbox: 0 },
    accounts: [acc("a1", "Work"), acc("a2", "Personal", { syncState: "reconnect" })],
    mailboxes: {
      a1: [box("a1", "inbox", 3), box("a1", "drafts", 0, 2), box("a1", "archive")],
      a2: [box("a2", "inbox", 9), box("a2", "drafts", 0, 1)],
    },
    hues: {},
    outboxCount: 0,
    screenerOn: false,
    nowMs: NOW,
    onSelect: (v) => calls.push(`select:${v.kind === "unified" ? v.role : v.kind}`),
    onConnect: () => calls.push("connect"),
    onSync: () => calls.push("sync"),
    onOpenSettings: () => calls.push("settings"),
    onCompose: () => calls.push("compose"),
    onOpenSubscriptions: () => calls.push("subscriptions"),
    onOpenAttachments: () => calls.push("attachments"),
    onOpenSearch: (q) => calls.push(`search:${q}`),
    onScope: (id) => calls.push(`scope:${id}`),
    savedSearches: [{ id: "s1", name: "Invoices", query: "subject:invoice", position: 0 }],
    viewCounts: {
      snoozed: 3,
      followups: 4,
      followupsDue: 1,
      newSenders: 5,
      subscriptions: 6,
      attachments: 7,
    },
    ...patch,
  };
  const ui = render(
    <TooltipProvider>
      <MailRail {...props} />
    </TooltipProvider>,
  );
  return { calls, ui, props };
}

/** Rail row names in DOM order (buttons and the section headings). */
function railOrder(container: HTMLElement): string[] {
  return [...container.querySelectorAll("button, h1, h2")]
    .map((el) => {
      const label = el.getAttribute("aria-label");
      if (label) return label;
      const copy = el.cloneNode(true) as HTMLElement;
      copy.querySelectorAll("[aria-hidden=true]").forEach((n) => n.remove());
      return (copy.textContent ?? "").trim();
    })
    .filter(Boolean);
}

describe("header, new message, outbox only when non-empty, view counts, order, scope (AC12)", () => {
  it("header: Mail, Sync now with the last-synced tooltip, and Settings → Mail", () => {
    const { calls } = renderRail();
    expect(screen.getByRole("heading", { level: 1, name: "Mail" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    fireEvent.click(screen.getByRole("button", { name: "Mail settings" }));
    expect(calls).toEqual(["sync", "settings"]);
    expect(
      syncTooltip([acc("a1", "W"), acc("a2", "P", { lastSyncedMs: NOW - 600_000 })], NOW),
    ).toBe("Synced 2 min ago");
    expect(syncTooltip([acc("a1", "W"), acc("a2", "P", { syncState: "syncing" })], NOW)).toBe(
      "Syncing…",
    );
  });

  it("New message runs compose, shows its c key cap outside the button, and hides on first run", () => {
    const { calls, ui } = renderRail();
    const btn = screen.getByRole("button", { name: "New message" });
    expect(btn.getAttribute("aria-keyshortcuts")).toBe("c");
    expect(btn.querySelector("kbd")).toBeNull();
    expect(btn.parentElement?.querySelector("kbd")?.textContent).toBe("c");
    fireEvent.click(btn);
    expect(calls).toEqual(["compose"]);
    ui.unmount();
    renderRail({ accounts: [], mailboxes: {} });
    expect(screen.queryByRole("button", { name: "New message" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
    expect(screen.getByRole("button", { name: "Connect account" })).toBeTruthy();
  });

  it("Outbox shows only while it holds a message, with its count, between Drafts and Archive", () => {
    const { ui } = renderRail();
    expect(screen.queryByRole("button", { name: /^Outbox/ })).toBeNull();
    ui.unmount();
    const { ui: ui2 } = renderRail({ outboxCount: 2 });
    const places = within(screen.getByRole("group", { name: "Places" }));
    expect(places.getByRole("button", { name: "Outbox, 2 waiting to send" })).toBeTruthy();
    const order = railOrder(ui2.container);
    const i = order.indexOf("Outbox, 2 waiting to send");
    expect(order[i - 1]).toMatch(/^Drafts/);
    expect(order[i + 1]).toBe("Archive");
  });

  it("places and smart views carry their counts and the follow-up due dot", () => {
    const { calls, ui } = renderRail();
    expect(screen.getByRole("button", { name: "Inbox, 12 unread" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Drafts, 3" })).toBeTruthy();
    const views = within(screen.getByRole("group", { name: "Views" }));
    expect(views.getByRole("button", { name: "Snoozed, 3" })).toBeTruthy();
    expect(views.getByRole("button", { name: "Follow-ups, 4, 1 due" })).toBeTruthy();
    expect(ui.container.querySelector("[data-slot=rail-due-dot]")).toBeTruthy();
    expect(views.queryByRole("button", { name: /New senders/ })).toBeNull();
    expect(views.getByRole("button", { name: "Subscriptions, 6" })).toBeTruthy();
    fireEvent.click(views.getByRole("button", { name: "Attachments, 7" }));
    expect(calls).toEqual(["attachments"]);
    ui.unmount();
    renderRail({ screenerOn: true });
    expect(screen.getByRole("button", { name: "New senders, 5" })).toBeTruthy();
  });

  it("orders header, New message, places, views, Accounts, Saved searches, then Connect account", () => {
    const { ui } = renderRail({ outboxCount: 1 });
    const order = railOrder(ui.container).map((n) => n.split(",")[0]!);
    const want = [
      "Mail",
      "Sync now",
      "Mail settings",
      "New message",
      "Inbox",
      "Sent",
      "Drafts",
      "Outbox",
      "Archive",
      "Trash",
      "Spam",
      "Snoozed",
      "Follow-ups",
      "Subscriptions",
      "Attachments",
      "Accounts",
      "Show folders for Work",
      "Work",
      "Show folders for Personal",
      "Personal",
      "Saved searches",
      "Invoices",
      "Connect account",
    ];
    expect(order.map((n) => n.replace(/ \d+.*$/, ""))).toEqual(want);
  });

  it("account rows: dot, label, unread, warning glyph; twist toggles the tree; the row scopes", () => {
    const { calls } = renderRail({ scope: "a1" });
    const work = screen.getByRole("button", { name: "Work, 3 unread" });
    expect(work.getAttribute("aria-pressed")).toBe("true");
    const personal = screen.getByRole("button", { name: /^Personal, 9 unread/ });
    expect(personal.getAttribute("aria-pressed")).toBe("false");
    expect(
      within(personal).getByRole("img", { name: ", needs you to sign in again" }),
    ).toBeTruthy();
    expect(within(work).queryByRole("img")).toBeNull();
    expect(screen.queryByRole("group", { name: "Folders in Work" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show folders for Work" }));
    const tree = within(screen.getByRole("group", { name: "Folders in Work" }));
    expect(tree.getByRole("button", { name: /INBOX/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide folders for Work" }));
    expect(screen.queryByRole("group", { name: "Folders in Work" })).toBeNull();
    fireEvent.click(personal);
    expect(calls).toEqual(["scope:a2"]);
  });

  it("saved searches open ⌘K on their query and hide while the store loads", () => {
    const { calls, ui } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Invoices" }));
    expect(calls).toEqual(["search:subject:invoice"]);
    ui.unmount();
    renderRail({ loading: true });
    expect(screen.queryByRole("heading", { name: "Saved searches" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Accounts" })).toBeTruthy();
  });

  it("first sync lists only the syncing account(s)", () => {
    const syncing = acc("a1", "Work", { syncState: "first_sync", lastSyncedMs: null });
    const fresh = acc("a2", "Personal", { lastSyncedMs: null });
    expect(railAccounts([syncing, fresh]).map((a) => a.id)).toEqual(["a1"]);
    expect(railAccounts([syncing, acc("a2", "Personal")]).map((a) => a.id)).toEqual(["a1", "a2"]);
    renderRail({ accounts: [syncing, fresh] });
    expect(screen.getByRole("button", { name: /^Work/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Personal/ })).toBeNull();
  });

  it("short windows: the rail row and gap tokens tighten at 780 px of height", () => {
    const css = readFileSync(path.join(process.cwd(), "src/styles/tokens.css"), "utf8");
    const media = css.slice(css.indexOf("@media (max-height: 780px)"));
    expect(media).toContain("--mail-rail-row: var(--row-h-sm)");
    expect(media).toContain("--mail-rail-gap:");
  });
});

const tick = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

describe("account scope through the thread window and tab counts (AC12)", () => {
  it("a row click scopes the list and tab counts; again, Inbox or removing the account unscopes", async () => {
    const engine = createFakeMailEngine({
      fixture: generateFixture({ messages: 300, accounts: 3 }),
      now: () => FIXTURE_NOW_MS,
    });
    const accounts = await engine.listAccounts();
    const store = createMailStore({ engine, accounts, counts: await engine.counts() });
    const ui = render(
      <TooltipProvider>
        <HotkeyScope scope="email">
          <MailShell store={store} now={() => FIXTURE_NOW_MS} />
        </HotkeyScope>
      </TooltipProvider>,
    );
    await tick();
    await tick();
    const rowAccounts = () =>
      new Set(
        [...ui.container.querySelectorAll("[data-thread-id]")].map((el) => {
          const id = el.getAttribute("data-thread-id")!;
          return ids.get(id);
        }),
      );
    const all = await engine.listThreads({
      view: { kind: "unified", role: "inbox" },
      tab: { kind: "personal" },
      limit: 1000,
    });
    const ids = new Map(all.rows.map((r) => [r.threadId, r.accountId]));
    expect(rowAccounts().size).toBeGreaterThan(1);

    const second = accounts[1]!;
    const personalTab = () => screen.getByRole("tab", { name: /Personal/ }).textContent;
    const globalCount = personalTab();
    const name = new RegExp(`^${second.displayName}`);
    fireEvent.click(screen.getByRole("button", { name }));
    await tick();
    await tick();
    expect([...rowAccounts()]).toEqual([second.id]);
    const counts = await engine.counts();
    const scopedUnread = counts.byViewKey[`mailbox:${second.id}:inbox|personal`] ?? 0;
    expect(personalTab()).toBe(scopedUnread ? `Personal${scopedUnread} unread` : "Personal");
    expect(personalTab()).not.toBe(globalCount);

    // Again unscopes.
    fireEvent.click(screen.getByRole("button", { name }));
    await tick();
    expect(rowAccounts().size).toBeGreaterThan(1);

    // Inbox unscopes.
    fireEvent.click(screen.getByRole("button", { name }));
    await tick();
    fireEvent.click(screen.getByRole("button", { name: /^Inbox/ }));
    await tick();
    await tick();
    expect(rowAccounts().size).toBeGreaterThan(1);

    // An account removed while scoped clears the scope.
    fireEvent.click(screen.getByRole("button", { name }));
    await tick();
    expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("true");
    act(() => {
      store.setState({ accounts: accounts.filter((a) => a.id !== second.id) });
    });
    await tick();
    await tick();
    expect(screen.queryByRole("button", { name })).toBeNull();
    expect(rowAccounts().size).toBeGreaterThan(1);
  });
});

// specs/mail-improve.md MI-0, AC4 (and AC5, AC25, AC26 on the rail): the rail's upper part
// scrolls above a pinned footer, a fade shows at its bottom edge while more is below, the
// rail is one Tab stop with arrow keys inside, account marks are the tick, and first run
// dims the places instead of hiding them.
describe("pinned footer and scroll fade (AC4)", () => {
  const two = [
    { ...account("idle", null), id: "a1", displayName: "Work", address: "w@x.com" },
    { ...account("idle", null), id: "a2", displayName: "Home", address: "h@x.com" },
  ];
  function mountRail(accounts: MailAccount[] = two) {
    return render(
      <TooltipProvider>
        <MailRail
          current={{ kind: "unified", role: "inbox" }}
          counts={null}
          accounts={accounts}
          mailboxes={{}}
          hues={{ a1: "blue", a2: "green" }}
          outboxCount={0}
          screenerOn={false}
          onSelect={() => {}}
          onConnect={() => {}}
        />
      </TooltipProvider>,
    );
  }

  it("the body scrolls above the footer and fades while more is below", () => {
    const sizes = Object.getOwnPropertyDescriptors(HTMLElement.prototype);
    let scrollTop = 0;
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return (this as HTMLElement).hasAttribute("data-rail-body") ? 800 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return (this as HTMLElement).hasAttribute("data-rail-body") ? 400 : 0;
      },
    });
    try {
      const ui = mountRail();
      const body = ui.container.querySelector<HTMLElement>("[data-rail-body]")!;
      const footer = ui.container.querySelector<HTMLElement>("[data-rail-footer]")!;
      expect(body.className).toContain("overflow-y-auto");
      expect(body.contains(footer)).toBe(false);
      within(footer).getByRole("button", { name: "Connect account" });
      Object.defineProperty(body, "scrollTop", { configurable: true, get: () => scrollTop });
      fireEvent.scroll(body);
      expect(body.getAttribute("data-fade")).toBe("bottom");
      scrollTop = 400;
      fireEvent.scroll(body);
      expect(body.hasAttribute("data-fade")).toBe(false);
    } finally {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", sizes.scrollHeight!);
      Object.defineProperty(HTMLElement.prototype, "clientHeight", sizes.clientHeight!);
    }
  });

  it("one Tab stop; ↓ ↑ Home End move between items", async () => {
    const ui = mountRail();
    await act(async () => await new Promise((r) => setTimeout(r, 0)));
    const nav = ui.getByRole("navigation", { name: "Mail folders" });
    const body = nav.querySelector<HTMLElement>("[data-rail-body]")!;
    const items = within(body).getAllByRole("button");
    expect(items.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    const start = items.find((b) => b.tabIndex === 0)!;
    start.focus();
    fireEvent.keyDown(start, { key: "ArrowDown" });
    const next = document.activeElement as HTMLElement;
    expect(next).not.toBe(start);
    expect(items).toContain(next);
    fireEvent.keyDown(next, { key: "ArrowUp" });
    expect(document.activeElement).toBe(start);
    fireEvent.keyDown(start, { key: "End" });
    expect(document.activeElement).toBe(items.at(-1));
    fireEvent.keyDown(items.at(-1)!, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
  });

  it("accounts carry the tick, not a dot or ring", () => {
    const ui = mountRail();
    const ticks = ui.container.querySelectorAll<HTMLElement>("[data-account-tick]");
    expect([...ticks].map((t) => t.dataset.label)).toEqual(["blue", "green"]);
    cleanup();
    // One account: no tick.
    const one = mountRail([two[0]!]);
    expect(one.container.querySelector("[data-account-tick]")).toBeNull();
  });

  it("first run dims folders and views (aria-disabled, a tooltip), never hides them", () => {
    const ui = mountRail([]);
    for (const name of ["Inbox", "Archive", "Snoozed", "Follow-ups"]) {
      const item = ui.getByRole("button", { name: new RegExp(`^${name}`) });
      expect(item.getAttribute("aria-disabled")).toBe("true");
      expect(item.title).toBe("Connect an account first");
      expect(item.className).toContain("text-muted-foreground");
    }
  });
});
