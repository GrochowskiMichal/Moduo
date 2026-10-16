import { expect, type Page, test } from "@playwright/test";

import { type ChatRoom, makeChatRoom, removeChatRoom, sendAs } from "./support/chat-room";
import { rpc, runTag, signInPage } from "./support/local-stack";

/**
 * Chat v2 CV-19 · "⌘K and Chat's Search" (AC4.4, AC4.5, AC1.10) on the real
 * app, against the local stack (needs 20261016190000_chat_v2_search applied):
 *   scripts/agent/e2e.sh tests/chat-search.spec.ts
 * A Duo room of its own (search-owner@ and search-member@moduo.local). The
 * owner says "żółw" in General; the member says it in a private channel the
 * owner isn't in. ⌘K finds the first by "zolw", never the second, lists
 * Conversations and offers "See all in Chat", which opens Chat's Search with
 * the words; its FilterBar narrows by from, in, has a file and date; people
 * are found by name without diacritics; a failed search reads "Search isn't
 * available"; a conversation's own Search steps through its hits; ⌘J does
 * nothing.
 */

test.describe.configure({ mode: "serial", timeout: 120_000 });

const OWNER = {
  email: "search-owner@moduo.local",
  password: "localsearchowner",
  name: "Ola Żak",
};
const MEMBER = {
  email: "search-member@moduo.local",
  password: "localsearchmember",
  name: "Łucja Wróbel",
};

let room: ChatRoom;
let tag: string;
let generalHit = "";
let olderHit = "";
let privateId = "";
let plansId = "";
let sourcesId = "";
let bellGeneral = "";
let bellPlans = "";

test.beforeAll(async () => {
  tag = runTag();
  room = await makeChatRoom(OWNER, MEMBER, `Search ${tag}`);
  olderHit = await sendAs(room.owner, room.general, `Stary żółw ${tag} z wczoraj`);
  generalHit = await sendAs(room.member, room.general, `Mamy żółw ${tag} w ogrodzie`);
  const priv = await rpc<{ id: string } | Array<{ id: string }>>(
    room.member,
    "chat_op_create_channel",
    {
      p_workspace_id: room.ws,
      p_name: `quiet-${tag}`,
      p_topic: "",
      p_is_private: true,
      p_member_ids: [],
      p_announcement: false,
    },
  );
  privateId = (Array.isArray(priv) ? priv[0] : priv)?.id ?? "";
  await sendAs(room.member, privateId, `Tajny żółw ${tag} tylko dla mnie`);
  const plans = await rpc<{ id: string } | Array<{ id: string }>>(
    room.owner,
    "chat_op_create_channel",
    {
      p_workspace_id: room.ws,
      p_name: `plans-${tag}`,
      p_topic: "",
      p_is_private: false,
      p_member_ids: [],
      p_announcement: false,
    },
  );
  plansId = (Array.isArray(plans) ? plans[0] : plans)?.id ?? "";
  // AC4.5: one word said in two conversations comes back as one list.
  bellGeneral = await sendAs(room.owner, room.general, `Dzwonek ${tag} w General`);
  bellPlans = await sendAs(room.owner, plansId, `Dzwonek ${tag} w planach`);
  // ⌘K's Conversations find a name with diacritics typed without them.
  const sources = await rpc<{ id: string } | Array<{ id: string }>>(
    room.owner,
    "chat_op_create_channel",
    {
      p_workspace_id: room.ws,
      p_name: `źródła-${tag}`,
      p_topic: "",
      p_is_private: false,
      p_member_ids: [],
      p_announcement: false,
    },
  );
  sourcesId = (Array.isArray(sources) ? sources[0] : sources)?.id ?? "";
});

test.afterAll(async () => {
  await removeChatRoom(room);
});

const palette = (page: Page) => page.getByRole("dialog");
const view = (page: Page) => page.locator('[data-slot="chat-search"]');

test("⌘K finds messages and conversations, and See all opens Chat's Search", async ({ page }) => {
  await signInPage(page, room.owner, room.ws);
  await page.goto("/chat");
  await expect(page).toHaveURL(new RegExp(`c=${room.general}`), { timeout: 20_000 });

  await page.keyboard.press("ControlOrMeta+k");
  const input = palette(page).getByRole("combobox");
  await input.fill(`zolw ${tag}`);
  const messages = palette(page).getByRole("group", { name: "Messages" });
  await expect(messages.getByRole("option")).toHaveCount(2, { timeout: 15_000 });
  // Newest first, the typed word marked as written.
  await expect(messages.getByRole("option").first()).toContainText(`Mamy żółw ${tag}`);
  await expect(messages.locator("mark").first()).toHaveText("żółw");
  await expect(palette(page).getByText("Tajny")).toHaveCount(0);

  await input.fill(`plans-${tag}`);
  const conversations = palette(page).getByRole("group", { name: "Conversations" });
  await expect(conversations.getByRole("option", { name: new RegExp(`plans-${tag}`) })).toBeVisible(
    {
      timeout: 15_000,
    },
  );

  // Without diacritics: "zrodla" finds "źródła-…".
  await input.fill(`zrodla ${tag}`);
  await expect(conversations.locator(`[data-chat-conversation="${sourcesId}"]`)).toBeVisible({
    timeout: 15_000,
  });

  // A failed message search says so; "No results." never shows meanwhile.
  await page.route("**/rest/v1/rpc/chat_search", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"boom"}' }),
  );
  await input.fill(`zolw ${tag} boom`);
  await expect(palette(page).getByText("Search isn't available")).toBeVisible({ timeout: 15_000 });
  await expect(palette(page).getByText("No results.")).toHaveCount(0);
  await page.unroute("**/rest/v1/rpc/chat_search");

  await input.fill(`zolw ${tag}`);
  await expect(messages.getByRole("option")).toHaveCount(2, { timeout: 15_000 });
  await palette(page).getByRole("option", { name: "See all in Chat" }).click();
  await expect(page).toHaveURL(/view=search/);
  await expect(view(page).getByLabel("Search messages")).toHaveValue(`zolw ${tag}`);
  const hits = view(page).locator("[data-search-hit]");
  await expect(hits).toHaveCount(2, { timeout: 15_000 });
  await expect(hits.first()).toHaveAttribute("data-search-hit", generalHit);

  // A hit lands in its conversation, on the message.
  await hits.first().click();
  await expect(page).toHaveURL(new RegExp(`m=${generalHit}`));

  // AC4.5: hits from two conversations come back as one list, newest first.
  await page.goto(`/chat?view=search&q=${encodeURIComponent(`dzwonek ${tag}`)}`);
  await expect(hits).toHaveCount(2, { timeout: 15_000 });
  await expect(hits.nth(0)).toHaveAttribute("data-search-hit", bellPlans);
  await expect(hits.nth(1)).toHaveAttribute("data-search-hit", bellGeneral);
  await expect(hits.nth(0)).toContainText(`plans-${tag}`);
  await expect(hits.nth(1)).toContainText("general", { ignoreCase: true });
});

test("Chat's Search: the FilterBar, people by name, honest errors", async ({ page }) => {
  await signInPage(page, room.owner, room.ws);
  await page.goto(`/chat?view=search&q=${encodeURIComponent(`zolw ${tag}`)}`);
  const hits = view(page).locator("[data-search-hit]");
  await expect(hits).toHaveCount(2, { timeout: 20_000 });

  // From: the member only.
  await view(page).getByRole("button", { name: "Filter" }).click();
  await page.getByRole("option", { name: "From" }).click();
  await page.getByRole("option", { name: MEMBER.name }).click();
  await expect(page).toHaveURL(new RegExp(`from=${room.member.user.id}`));
  await expect(hits).toHaveCount(1, { timeout: 15_000 });
  await expect(hits.first()).toHaveAttribute("data-search-hit", generalHit);

  // In, has a file and date travel in the link the same way.
  await page.goto(`/chat?view=search&q=${encodeURIComponent(`zolw ${tag}`)}&in=${plansId}`);
  await expect(view(page).getByText("No messages match.")).toBeVisible({ timeout: 15_000 });
  await page.goto(`/chat?view=search&q=${encodeURIComponent(`zolw ${tag}`)}&file=1`);
  await expect(view(page).getByText("No messages match.")).toBeVisible({ timeout: 15_000 });
  await page.goto(`/chat?view=search&q=${encodeURIComponent(`zolw ${tag}`)}&date=today`);
  await expect(hits).toHaveCount(2, { timeout: 15_000 });
  await expect(view(page).getByRole("button", { name: /Date values: Today/ })).toBeVisible();

  // Negated words only name nothing to find: never every message.
  await page.goto(`/chat?view=search&q=${encodeURIComponent(`-${tag}`)}`);
  await expect(view(page).getByText("Type a word to search for.")).toBeVisible({ timeout: 15_000 });
  await expect(hits).toHaveCount(0);

  // Typing fast keeps every key in the box (the link follows a beat later).
  const box = view(page).getByLabel("Search messages");
  await box.fill("");
  await box.pressSequentially(`zolw ${tag}`, { delay: 5 });
  await expect(box).toHaveValue(`zolw ${tag}`);
  await expect(hits).toHaveCount(2, { timeout: 15_000 });

  // People by name, Polish without diacritics; never through message text.
  await page.goto("/chat?view=search&q=lucja");
  await expect(view(page).locator("[data-search-person]")).toContainText(MEMBER.name, {
    timeout: 15_000,
  });

  // A failed search says so, never "No messages match".
  await page.route("**/rest/v1/rpc/chat_search", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"boom"}' }),
  );
  await page.goto(`/chat?view=search&q=${encodeURIComponent(`zolw ${tag}`)}`);
  await expect(view(page).getByText("Search isn't available")).toBeVisible({ timeout: 15_000 });
  await expect(view(page).getByText("No messages match.")).toHaveCount(0);
  await page.unroute("**/rest/v1/rpc/chat_search");
});

test("a conversation's own Search, the bottom bar's Search, and ⌘J retired", async ({ page }) => {
  await signInPage(page, room.owner, room.ws);
  await page.goto(`/chat?c=${room.general}`);
  const toolbar = page.locator('[data-slot="conversation-toolbar"]');
  await expect(toolbar).toBeVisible({ timeout: 20_000 });

  await toolbar.getByRole("button", { name: "Search in this conversation" }).click();
  const bar = page.locator('[data-slot="find-bar"]');
  await bar.getByLabel("Search in this conversation").fill(`zolw ${tag}`);
  await expect(bar.locator("[data-find-status]")).toHaveText("1 of 2", { timeout: 15_000 });
  await expect(page).toHaveURL(new RegExp(`m=${generalHit}`));
  await bar.getByLabel("Search in this conversation").press("ArrowUp");
  await expect(bar.locator("[data-find-status]")).toHaveText("2 of 2");
  await expect(page).toHaveURL(new RegExp(`m=${olderHit}`));
  await bar.getByLabel("Search in this conversation").press("Escape");
  await expect(bar).toHaveCount(0);

  // ⌘J does nothing (CH63): no dialog, no navigation.
  const before = page.url();
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(page.url()).toBe(before);

  // The bottom bar's Search opens Chat's Search while Chat is open.
  await page.getByRole("button", { name: /^Search \(/ }).click();
  await expect(page).toHaveURL(/view=search/);
  await expect(view(page)).toBeVisible();

  // …and comes back with the words and filters it had after you open a hit.
  await page.goto(
    `/chat?view=search&q=${encodeURIComponent(`zolw ${tag}`)}&from=${room.member.user.id}`,
  );
  const hit = view(page).locator("[data-search-hit]");
  await expect(hit).toHaveCount(1, { timeout: 15_000 });
  await hit.first().click();
  await expect(page).not.toHaveURL(/view=search/);
  await page.getByRole("button", { name: /^Search \(/ }).click();
  await expect(page).toHaveURL(new RegExp(`from=${room.member.user.id}`));
  await expect(view(page).getByLabel("Search messages")).toHaveValue(`zolw ${tag}`);
});
