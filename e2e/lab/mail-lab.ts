// The Mail screen's lab states and journeys (MR-16, specs/mail-v3.md MV-12, AC38), kept apart
// so lab.config.ts stays under the size limit. Every one runs on the fixture engine
// (`moduo:mail:engine` = "fixture", features/email/engine/behavior.ts): the seeded reference
// mailbox in memory, so no frame shows real mail and nothing reaches an IMAP server. States
// are named by the prototype's ids (.design/email/v3/part4-interact.js) and start the fixture
// in a lab scenario (`moduo:mail:fixture-scenario`: MAIL_FIXTURE_SCENARIOS, the compose
// fake's and testing/fixture-settings.ts's).

import type { Locator, Page } from "@playwright/test";

type Target = string | Locator;
type J = {
  page: Page;
  press: (keys: string) => Promise<void>;
  type: (text: string) => Promise<void>;
  click: (target: Target, opts?: object) => Promise<void>;
  step: (
    label: string,
    opts?: { expect?: Target | (() => Promise<boolean>); gone?: Target; view?: boolean },
  ) => Promise<void>;
};

const list = (page: Page) => page.getByRole("listbox", { name: "Conversations" });
const rows = (page: Page) => list(page).locator("[data-thread-id]");
const reader = (page: Page) => page.locator("[data-reader-thread]");
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Conversation actions" });
const tab = (page: Page, name: string) =>
  page
    .getByRole("tablist", { name: "Inbox tabs" })
    .getByRole("tab", { name: new RegExp(`^${name}`) });
const composer = (page: Page) => page.locator("section[data-placement]");
const bulkSummary = (page: Page) => page.getByRole("region", { name: /^\d+ selected$/ });

type Fixture = {
  messages?: number;
  /** Lab scenarios, joined into `moduo:mail:fixture-scenario`. */
  scenario?: string[];
  /** Mail behavior overrides (`moduo:mail:behavior`), e.g. compact density. */
  behavior?: Record<string, unknown>;
  /** The window size the page loads at (the side panel decides on mount). */
  size?: { width: number; height: number };
  /** What shows once the page is up; the first row by default. */
  ready?: (page: Page) => Locator;
};

/** Switch this page to the fixture engine (with a lab scenario), then reload /email. */
export async function onFixture(page: Page, opts: number | Fixture = {}) {
  const o = typeof opts === "number" ? { messages: opts } : opts;
  if (o.size) await page.setViewportSize(o.size);
  await page.evaluate(
    ({ n, scenario, behavior }) => {
      window.localStorage.setItem("moduo:mail:engine", "fixture");
      window.localStorage.setItem("moduo:mail:fixture-messages", String(n));
      window.localStorage.setItem("moduo:mail:fixture-scenario", scenario);
      if (behavior) window.localStorage.setItem("moduo:mail:behavior", behavior);
      else window.localStorage.removeItem("moduo:mail:behavior");
    },
    {
      n: o.messages ?? 100_000,
      scenario: (o.scenario ?? []).join(","),
      behavior: o.behavior ? JSON.stringify(o.behavior) : null,
    },
  );
  await page.reload();
  await (o.ready ?? ((p: Page) => rows(p).first()))(page).waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

const fixtureState = (opts: Fixture, then?: (page: Page) => Promise<unknown>) => ({
  act: async ({ page }: { page: Page }) => {
    await onFixture(page, { messages: 5_000, ...opts });
    await then?.(page);
  },
});

/** Open the first conversation in the list. */
async function openFirst(page: Page) {
  await rows(page).first().click();
  await reader(page).waitFor();
}

/** Pick an inbox tab, through the "+N" menu when it is folded away. */
async function pickTab(page: Page, name: string) {
  const t = tab(page, name);
  if (await t.isVisible()) await t.click();
  else {
    await page.locator("[data-slot='mail-tabs-more']").click();
    await page.getByRole("menuitem", { name: new RegExp(`^${name}`) }).click();
  }
  await rows(page).first().waitFor();
}

async function openWhyHere(page: Page) {
  await pickTab(page, "Notifications");
  await openFirst(page);
  await toolbar(page).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /^Why is this in/ }).click();
  await page.getByRole("list", { name: "The order Moduo checks" }).waitFor();
}

async function pickThree(page: Page) {
  await page.keyboard.press("j");
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("x");
    if (i < 2) await page.keyboard.press("j");
  }
  await bulkSummary(page).waitFor();
}

export const mailStates = {
  default: fixtureState({}),
  /** A thread open in the reader. */
  reading: fixtureState({}, openFirst),
  /** Every account offline: the offline line and the pending states (AC3, AC18). */
  offline: fixtureState({ scenario: ["offline"] }),
  /** AC1: a queued send while offline, Outbox open. */
  outbox: fixtureState({ scenario: ["outbox", "offline"] }, async (page) => {
    await page
      .getByRole("group", { name: "Places" })
      .getByRole("button", { name: /^Outbox/ })
      .click();
    await page.getByRole("list", { name: "Outbox" }).waitFor();
  }),
  /** AC11: a failed send back in Drafts with its reason and Fix and send. */
  sendFailed: fixtureState({ scenario: ["sendFailed"] }, async (page) => {
    await page
      .getByRole("group", { name: "Places" })
      .getByRole("button", { name: /^Drafts/ })
      .click();
    await page.getByRole("list", { name: "Not sent" }).waitFor();
  }),
  /** AC4, AC14: snoozes that came back while the app was closed. */
  away: fixtureState({ scenario: ["away"] }, (page) =>
    page
      .getByText(/came back while you were away/i)
      .first()
      .waitFor(),
  ),
  /** AC2, AC13: three custom tabs at 1024 px, Investors picked (the rest fold into "+N"). */
  investors: fixtureState(
    { scenario: ["customTabs"], size: { width: 1024, height: 700 } },
    async (page) => {
      await pickTab(page, "Investors");
      await openFirst(page);
    },
  ),
  /** AC8: "Why is this in Notifications?" over its thread. */
  whyHere: fixtureState({}, openWhyHere),
  /** AC20: three threads picked, the reader turned into the bulk summary. */
  bulk: fixtureState({}, pickThree),
  /** AC21: the `?` sheet over the list. */
  keys: fixtureState({}, async (page) => {
    await page.keyboard.press("Shift+Slash");
    await page.getByRole("dialog").waitFor();
  }),
  /** AC3: offline, the newest message's body not downloaded yet. */
  bodyOffline: fixtureState({ scenario: ["bodyOffline"] }, openFirst),
  /** AC28, AC30: a New message filling the reader column. */
  newMessage: fixtureState({}, async (page) => {
    await page.keyboard.press("c");
    await composer(page).waitFor();
  }),
  /** AC29: an inline reply with the From menu open on the aliases. */
  alias: fixtureState({ scenario: ["aliases"] }, async (page) => {
    await openFirst(page);
    await page.keyboard.press("r");
    await composer(page)
      .getByRole("button", { name: /^From .*change address$/ })
      .click();
    await page.getByRole("menuitemradio").first().waitFor();
  }),
  /** AC32: files over the provider's limit, Send disabled. */
  tooBig: fixtureState({ scenario: ["tooBig"] }, async (page) => {
    await page.keyboard.press("c");
    await composer(page).getByRole("button", { name: "Attach files" }).click();
    await composer(page).getByRole("alert").first().waitFor();
  }),
  /** AC33: replying to an intro, the banner offering to move the introducer to Bcc. */
  intro: fixtureState({ scenario: ["intro"] }, async (page) => {
    await openFirst(page);
    await page.keyboard.press("a");
    await composer(page)
      .getByRole("button", { name: /^Move .* to Bcc$/ })
      .waitFor();
  }),
  /** AC34: ⌥2, the side panel's Contact view. */
  contact: fixtureState({}, async (page) => {
    await openFirst(page);
    await page.keyboard.press("Alt+2");
    await page.locator("[data-mail-panel='contact']").waitFor();
  }),
  /** AC16: the reference mailbox at full scale (100k over 6 accounts) in compact rows. */
  dense: fixtureState({ messages: 100_000, behavior: { density: "compact" } }),
  /** AC17: Personal cleared (⌘A, then Done). */
  inboxZero: fixtureState({ messages: 1_000 }, async (page) => {
    await page.keyboard.press("j");
    await page.keyboard.press("Meta+a");
    await bulkSummary(page).waitFor();
    await page.keyboard.press("e");
    await page.getByText(/^Personal is clear$/).waitFor();
  }),
  /** AC12, AC17: every account in its first sync, skeleton rows. */
  firstSync: fixtureState({
    scenario: ["firstSync"],
    ready: (page) => page.locator("[data-slot='mail-skeleton']"),
  }),
  /** AC9, AC18: two failed actions, each named with its thread. */
  failed: fixtureState({ scenario: ["failed"] }),
  /** AC5, AC18: one account needs you to sign in again. */
  reconnect: fixtureState({ scenario: ["reconnect"] }),
  /** AC36: the web view, no engine: the honest banner and Linked conversations. */
  web: {
    act: async ({ page }: { page: Page }) => {
      await page.getByRole("note").first().waitFor({ timeout: 30_000 });
    },
  },
  // ── specs/mail-improve.md MI-7: the improve states ──────────────────────────────────
  /** AC10, AC11: Done on the open thread; the one toast with Undo and its key. */
  undoDone: fixtureState({}, async (page) => {
    await openFirst(page);
    await page.keyboard.press("e");
    await toast(page, /^Done · in Archive/).waitFor();
  }),
  /** AC12: ⌘⇧↩ sent a reply and marked it Done; the undo-send toast, the next thread open. */
  undoSend: fixtureState({}, async (page) => {
    await openFirst(page);
    await page.keyboard.press("r");
    await composer(page).getByRole("textbox", { name: "Message" }).fill("Works for me.");
    await page.keyboard.press("Meta+Shift+Enter");
    await toast(page, /sends in/).waitFor();
  }),
  /** AC13: `t` made a task; the title open for renaming, "Also mark the email Done  e". */
  taskMade: fixtureState({}, async (page) => {
    await openFirst(page);
    await page.keyboard.press("t");
    await toast(page, /^Task created/).waitFor({ timeout: 15_000 });
  }),
  /** AC21: `;;tha` typed in a reply: the offer before anything is inserted. */
  snippet: fixtureState({ scenario: ["snippets"] }, async (page) => {
    await openFirst(page);
    await page.keyboard.press("r");
    await composer(page).getByRole("textbox", { name: "Message" }).pressSequentially(";;tha");
    await page.getByRole("group", { name: "Snippet offer" }).waitFor();
  }),
  /** AC20: the failed actions folded, then shown. */
  failedOpen: fixtureState({ scenario: ["failed"] }, async (page) => {
    await page.getByRole("button", { name: "Show", exact: true }).click();
    await page.getByRole("list", { name: "Actions that didn't sync" }).waitFor();
  }),
  /** AC22: an empty place: its state in the list, Back to Inbox with g i; the reader empty. */
  emptyFolder: fixtureState({}, async (page) => {
    await page.keyboard.press("g");
    await page.keyboard.press("f");
    await page.getByRole("button", { name: "Back to Inbox" }).waitFor();
  }),
  /** AC24: the Screener: a new sender's thread open, decided in the reader's header. */
  newSenders: fixtureState(
    { scenario: ["newSenders"], behavior: { screener: true } },
    async (page) => {
      await page
        .getByRole("group", { name: "Views" })
        .getByRole("button", { name: /^New senders/ })
        .click();
      await openFirst(page);
    },
  ),
  /** AC25: no account yet: places and views dimmed, the connect card. */
  firstRun: fixtureState({
    scenario: ["noAccount"],
    ready: (page) => page.getByRole("button", { name: "Google" }),
  }),
  /** AC25: the connect dialog over the first run, on its scrim. */
  connect: fixtureState(
    { scenario: ["noAccount"], ready: (page) => page.getByRole("button", { name: "Google" }) },
    async (page) => {
      await page.getByRole("button", { name: "Google" }).click();
      await page.getByRole("dialog").waitFor();
    },
  ),
  /** AC15: Why here on a thread a setting decided (a custom tab), the step "decided it". */
  whyRule: fixtureState({ scenario: ["customTabs"] }, async (page) => {
    await pickTab(page, "Investors");
    await openFirst(page);
    await toolbar(page).getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /^Why is this in/ }).click();
    await page.locator("[data-why-sheet]").waitFor();
  }),
  /** AC3, AC16: a 200-character subject: the title wraps, the column keeps its measure. */
  long: fixtureState({ scenario: ["long"] }, openFirst),
  /** AC35: Settings → Mail with the account cards. */
  "settings-mail": fixtureState({}, async (page) => {
    await page.getByRole("button", { name: "Mail settings" }).click();
    await page.getByRole("region", { name: "Accounts" }).waitFor({ timeout: 20_000 });
  }),
};

const firstId = (page: Page) => rows(page).first().getAttribute("data-thread-id");
/** The thread the reader shows. */
const openId = (page: Page) => reader(page).getAttribute("data-reader-thread");
const toast = (page: Page, text: RegExp) =>
  page.locator("[data-sonner-toast]").filter({ hasText: text });

export const mailJourneys = [
  {
    id: "mail-open",
    screen: "email",
    goal: "Open Mail and read the newest conversation (Mail paints within 150 ms)",
    target: { keys: 1, clicks: 1 },
    async keyboard({ page, press, step }: J) {
      await onFixture(page);
      await step("mail painted", { expect: rows(page).first() });
      await press("j");
      await step("conversation open", { expect: reader(page), view: true });
    },
    async pointer({ page, click, step }: J) {
      await onFixture(page);
      await step("mail painted", { expect: rows(page).first() });
      await click(rows(page).first());
      await step("conversation open", { expect: reader(page), view: true });
    },
  },
  {
    id: "mail-triage-50",
    screen: "email",
    goal: "Clear 50 conversations with Done, each landing in one frame and moving to the next",
    target: { keys: 51, clicks: 0 },
    async keyboard({ page, press, step }: J) {
      await onFixture(page);
      await press("j");
      await step("first conversation selected", { expect: reader(page) });
      for (let i = 0; i < 50; i += 1) {
        const before = await firstId(page);
        await press("e");
        await step(`done ${i + 1}`, { expect: async () => (await firstId(page)) !== before });
      }
    },
  },
  {
    id: "mail-triage-undo",
    screen: "email",
    goal: "Clear three conversations with Done, then take the last one back with Undo",
    target: { keys: 5, clicks: 4 },
    async keyboard({ page, press, step }: J) {
      await onFixture(page, 5_000);
      await press("j");
      await step("first conversation open", { expect: reader(page) });
      let last: string | null = null;
      for (let i = 0; i < 3; i += 1) {
        last = await firstId(page);
        await press("e");
        await step(`done ${i + 1}`, { expect: async () => (await firstId(page)) !== last });
      }
      await press("z");
      await step("last one back, selected and open", {
        expect: async () => (await firstId(page)) === last && (await openId(page)) === last,
      });
    },
    // The toast's Undo is the pointer path (specs/mail-improve.md AC10).
    async pointer({ page, click, step }: J) {
      await onFixture(page, 5_000);
      await click(rows(page).first());
      await step("first conversation open", { expect: reader(page) });
      let last: string | null = null;
      for (let i = 0; i < 3; i += 1) {
        last = await firstId(page);
        await click(toolbar(page).getByRole("button", { name: "Done", exact: true }));
        await step(`done ${i + 1}`, { expect: async () => (await firstId(page)) !== last });
      }
      await click(toast(page, /^Done · in Archive/).getByRole("button", { name: /^Undo/ }));
      await step("last one back, selected and open", {
        expect: async () => (await firstId(page)) === last && (await openId(page)) === last,
      });
    },
  },
  {
    id: "mail-send-done",
    screen: "email",
    goal: "Reply and send with ⌘⇧↩ (Send & Done): the next thread opens; undo the send",
    target: { keys: 4, clicks: 1 },
    async keyboard({ page, press, type, click, step }: J) {
      await onFixture(page, 5_000);
      await press("j");
      await step("conversation open", { expect: reader(page) });
      const sent = await openId(page);
      await press("r");
      await step("reply open", { expect: composer(page) });
      await type("Works for me.");
      await press("Meta+Shift+Enter");
      await step("next thread open", {
        expect: async () => (await openId(page)) !== sent && !!(await openId(page)),
      });
      await click(toast(page, /sends in/).getByRole("button", { name: /^Undo/ }));
      await step("the reply back on the sent thread", {
        expect: async () => (await openId(page)) === sent && (await composer(page).isVisible()),
      });
    },
  },
  {
    id: "mail-keyboard-reach",
    screen: "email",
    goal: "From the top, reach the mail list in three Tabs, then cycle the panes with F6",
    target: { keys: 6, clicks: 0 },
    async keyboard({ page, press, step }: J) {
      await onFixture(page, 5_000);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await press("Tab");
      await step("skip link first", {
        expect: page.getByRole("link", { name: "Skip to mail list" }),
      });
      await press("Enter");
      await step("in the list", {
        expect: async () =>
          page.evaluate(() => !!document.activeElement?.closest('[aria-label="Mail list"]')),
      });
      await press("F6");
      await step("the reader", {
        expect: async () =>
          page.evaluate(() => !!document.activeElement?.closest('[aria-label="Reader"]')),
      });
      // Reader → the side panel (open at 1440 px) → round to the rail.
      await press("F6");
      await press("F6");
      await step("round to the rail", {
        expect: async () =>
          page.evaluate(() => !!document.activeElement?.closest('[aria-label="Mail folders"]')),
      });
    },
  },
  {
    id: "mail-reply-snippet",
    screen: "email",
    goal: "Reply under the conversation with a ;; snippet, then send it",
    target: { keys: 13, clicks: 4 },
    async keyboard({ page, press, type, step }: J) {
      await onFixture(page, { messages: 5_000, scenario: ["snippets"] });
      await press("j");
      await step("conversation open", { expect: reader(page) });
      await press("r");
      await step("reply open", { expect: composer(page) });
      await type(";;thanks");
      await step("snippet offered", { expect: page.getByRole("listbox", { name: "Snippets" }) });
      await press("Enter");
      await step("snippet in", { expect: composer(page).getByText(/that works for me/) });
      await press("Meta+Enter");
      await step("sending", { expect: toast(page, /sends in/) });
    },
    async pointer({ page, click, type, step }: J) {
      await onFixture(page, { messages: 5_000, scenario: ["snippets"] });
      await click(rows(page).first());
      await step("conversation open", { expect: reader(page) });
      await click(toolbar(page).getByRole("button", { name: "Reply", exact: true }));
      await step("reply open", { expect: composer(page) });
      await click(composer(page).getByRole("textbox", { name: "Message" }));
      await type(";;thanks");
      await click(page.getByRole("listbox", { name: "Snippets" }).getByRole("option").first());
      await step("snippet in", { expect: composer(page).getByText(/that works for me/) });
      await click(composer(page).getByRole("button", { name: /^Send/ }));
      await step("sending", { expect: toast(page, /sends in/) });
    },
  },
  {
    id: "mail-why-here",
    screen: "email",
    goal: "Ask why a notification landed in Notifications and read the answer",
    target: { keys: 0, clicks: 4 },
    // Pointer only: no key opens the ⋯ menu, and WebKit's Tab skips buttons unless the person
    // turns on keyboard navigation, so a Tab walk can't reach it there.
    async pointer({ page, click, step }: J) {
      await onFixture(page, 5_000);
      await click(tab(page, "Notifications"));
      await click(rows(page).first());
      await step("conversation open", { expect: reader(page) });
      await click(toolbar(page).getByRole("button", { name: "More actions" }));
      await click(page.getByRole("menuitem", { name: /^Why is this in/ }));
      await step("the answer", {
        expect: page.getByRole("list", { name: "The order Moduo checks" }),
      });
    },
  },
  {
    id: "mail-bulk-done",
    screen: "email",
    goal: "Pick three conversations and mark them all Done at once",
    target: { keys: 7, clicks: 4 },
    async keyboard({ page, press, step }: J) {
      await onFixture(page, 5_000);
      const before = await firstId(page);
      await press("j");
      for (let i = 0; i < 3; i += 1) {
        await press("x");
        if (i < 2) await press("j");
      }
      await step("three picked", { expect: bulkSummary(page) });
      await press("e");
      await step("all three done", {
        gone: bulkSummary(page),
        expect: async () => (await firstId(page)) !== before,
      });
    },
    async pointer({ page, click, step }: J) {
      await onFixture(page, 5_000);
      const before = await firstId(page);
      for (let i = 0; i < 3; i += 1) {
        const row = rows(page).nth(i);
        await row.hover();
        await click(row.locator('[data-row-control="Select · x"]'));
      }
      await step("three picked", { expect: bulkSummary(page) });
      await click(bulkSummary(page).getByRole("button", { name: /^Done/ }));
      await step("all three done", {
        gone: bulkSummary(page),
        expect: async () => (await firstId(page)) !== before,
      });
    },
  },
  {
    id: "mail-scroll",
    screen: "email",
    goal: "Scroll through a 100k-message mailbox without dropping below 55 fps",
    target: { keys: 0, clicks: 0 },
    async pointer({ page, step }: J) {
      await onFixture(page);
      const box = await list(page).boundingBox();
      if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 40; i += 1) await page.mouse.wheel(0, 1200);
      await step("deep in the list", {
        expect: async () =>
          (await list(page).evaluate((el) => {
            let n: HTMLElement | null = el as HTMLElement;
            while (n && n.scrollHeight <= n.clientHeight + 4) n = n.parentElement;
            return n?.scrollTop ?? 0;
          })) > 10_000,
      });
    },
  },
];
