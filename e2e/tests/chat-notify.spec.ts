import { randomUUID } from "node:crypto";

import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import {
  rest,
  rpc,
  runTag,
  type Session,
  setLocalPassword,
  signIn,
  signInPage,
  stackKeys,
} from "./support/local-stack";

/**
 * Chat v2 CV-6b · "one device rings" (AC7.6, AC2.2, AC3.1, AC1.5) and "browser
 * permission and sound" (AC7.7, AC7.8), against the local stack.
 *   scripts/agent/e2e.sh tests/chat-notify.spec.ts
 * It needs CV-6a's …_chat_v2_device_notices.sql applied.
 *
 * Two people (notify-sender@ / notify-receiver@moduo.local) share two
 * workspaces this spec makes, each with chat on (Duo plans) and a direct
 * message between them. The receiver has two clients:
 *   • "the desktop app": a browser context where Moduo believes it runs in
 *     Tauri (a stub `__TAURI_INTERNALS__`), whose `window.Notification` (what
 *     the notification plugin calls) records each OS notification, whose
 *     focus the test sets (`__focus`), and whose Web Audio records the sound;
 *   • "a browser tab": a plain web context, its focus set the same way, its
 *     `Notification` recording too (the page itself must never ring).
 * A real Web Push isn't delivered in Playwright: "the browser rings after 8 s"
 * is proven as the row the push worker would claim (unacknowledged, due);
 * CV-6a's chat_notices.test.sql proves the claim itself.
 */

test.describe.configure({ mode: "serial", timeout: 240_000 });

type Person = { email: string; password: string; name: string };
const SENDER: Person = {
  email: "notify-sender@moduo.local",
  password: "localnotifysender",
  name: "Sofia Sender",
};
const RECEIVER: Person = {
  email: "notify-receiver@moduo.local",
  password: "localnotifyreceiver",
  name: "Rui Receiver",
};

type Room = { ws: string; name: string; dm: string };

let sender: Session;
let receiver: Session;
let roomA: Room;
let roomB: Room;
let tag: string;

/** A throwaway person, created once (the stack blanks passwords on insert). */
async function ensurePerson(who: Person): Promise<Session> {
  const { url, service } = stackKeys();
  const admin = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    "Content-Type": "application/json",
  };
  const list = await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers: admin });
  const users = ((await list.json()) as { users: Array<{ id: string; email: string }> }).users;
  let user = users.find((u) => u.email === who.email);
  if (!user) {
    const created = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        email: who.email,
        email_confirm: true,
        user_metadata: { full_name: who.name, display_name: who.name },
      }),
    });
    user = (await created.json()) as { id: string; email: string };
  }
  // Auth refuses password writes; set it in SQL (supabase/seed.sql does the same).
  setLocalPassword(user.id, who.password);
  await rest("service", `profiles?id=eq.${user.id}`, {
    method: "PATCH",
    body: { display_name: who.name, plan_tier: "duo" },
  });
  return signIn(who);
}

/** A new workspace of `owner`'s with `other` in it, chat opened and a direct message between them. */
async function makeRoom(owner: Session, other: Session, name: string): Promise<Room> {
  // A stopped run's workspaces go first.
  await rest("service", `workspaces?owner_id=eq.${owner.user.id}&deleted_at=is.null`, {
    method: "PATCH",
    body: { deleted_at: new Date().toISOString() },
  });
  const [created] = await rest<Array<{ id: string }>>(owner, "workspaces", {
    method: "POST",
    body: { name, owner_id: owner.user.id },
  });
  await rest("service", "workspace_members", {
    method: "POST",
    body: { workspace_id: created.id, user_id: other.user.id, role: "member" },
  });
  await rpc(owner, "chat_op_bootstrap", { p_workspace_id: created.id });
  const dm = await rpc<{ id: string }>(owner, "chat_op_open_dm", {
    p_workspace_id: created.id,
    p_user_ids: [other.user.id],
  });
  return { ws: created.id, name, dm: dm.id };
}

const say = async (room: Room, body: string): Promise<string> => {
  const row = await rpc<{ id: string }>(sender, "chat_op_send", {
    p_id: randomUUID(),
    p_channel_id: room.dm,
    p_body: body,
    p_reply_to_id: null,
  });
  return row.id;
};

type Notice = { id: string; acked_at: string | null; push_after: string | null; title: string };
const noticeOf = async (messageId: string): Promise<Notice | null> => {
  const rows = await rest<Notice[]>(
    "service",
    `notice_deliveries?user_id=eq.${receiver.user.id}&message_id=eq.${messageId}&select=id,acked_at,push_after,title`,
  );
  return rows[0] ?? null;
};
const ackedSoon = (messageId: string) =>
  expect
    .poll(async () => (await noticeOf(messageId))?.acked_at ?? null, { timeout: 15_000 })
    .not.toBeNull();

/** Recorders every client of the receiver gets: OS notifications, focus, sound. */
function recorders({ desktop, focused }: { desktop: boolean; focused: boolean }) {
  {
    const w = window as unknown as Record<string, unknown>;
    w.__rung = [] as Array<{ title: string; body?: string }>;
    w.__sounds = 0;
    w.__focus = focused;
    document.hasFocus = () => w.__focus === true;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (w.__focus === true ? "visible" : "hidden"),
    });
    class RecordedNotification {
      static permission = "granted";
      static requestPermission = async () => "granted";
      constructor(title: string, options?: { body?: string }) {
        (w.__rung as Array<{ title: string; body?: string }>).push({ title, body: options?.body });
      }
    }
    w.Notification = RecordedNotification;
    const noop = () => undefined;
    const param = { setValueAtTime: noop, exponentialRampToValueAtTime: noop };
    w.AudioContext = class {
      currentTime = 0;
      destination = {};
      constructor() {
        w.__sounds = (w.__sounds as number) + 1;
      }
      createGain() {
        return { gain: param, connect: noop };
      }
      createOscillator() {
        return { type: "sine", frequency: param, connect: noop, start: noop, stop: noop };
      }
      close() {
        return Promise.resolve();
      }
    };
    if (desktop) {
      w.__TAURI_INTERNALS__ = {
        invoke: async () => null,
        transformCallback: () => 0,
        convertFileSrc: (p: string) => p,
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      };
    }
  }
}

async function client(
  context: BrowserContext,
  room: Room,
  path: string,
  desktop: boolean,
): Promise<Page> {
  // A desktop app starts in front; a browser tab in the background.
  await context.addInitScript(recorders, { desktop, focused: desktop });
  const page = await context.newPage();
  await signInPage(page, receiver, room.ws);
  await page.goto(path);
  await expect(page.locator('[data-slot="module-tab"]').first()).toBeVisible({ timeout: 30_000 });
  return page;
}

const rung = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __rung: Array<{ title: string; body?: string }> }).__rung,
  );
const sounds = (page: Page) =>
  page.evaluate(() => (window as unknown as { __sounds: number }).__sounds);
const setFocus = (page: Page, on: boolean) =>
  page.evaluate((v) => {
    (window as unknown as { __focus: boolean }).__focus = v;
    window.dispatchEvent(new Event(v ? "focus" : "blur"));
    document.dispatchEvent(new Event("visibilitychange"));
  }, on);

/** Both clients have told the server they're open (their listeners start with it). */
async function clientsSeen(n: number): Promise<void> {
  await expect
    .poll(
      async () =>
        (await rest<unknown[]>("service", `user_clients?user_id=eq.${receiver.user.id}&select=id`))
          .length,
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(n);
  // The Realtime join lands a moment after the first stamp.
  await new Promise((resolve) => setTimeout(resolve, 2500));
}

test.beforeAll(async () => {
  tag = runTag();
  sender = await ensurePerson(SENDER);
  receiver = await ensurePerson(RECEIVER);
  roomA = await makeRoom(sender, receiver, `Notify A ${tag}`);
  roomB = await makeRoom(receiver, sender, `Notify B ${tag}`);
});

test.beforeEach(async () => {
  // Every client this person ever had: a test starts from none.
  await rest("service", `user_clients?user_id=eq.${receiver.user.id}`, { method: "DELETE" });
});

test.afterAll(async () => {
  const at = new Date().toISOString();
  for (const room of [roomA, roomB]) {
    if (!room) continue;
    await rest("service", `workspaces?id=eq.${room.ws}`, {
      method: "PATCH",
      body: { deleted_at: at },
    });
  }
});

test("one device rings", async ({ browser }) => {
  const desktopCtx = await browser.newContext();
  const webCtx = await browser.newContext();
  const desktop = await client(desktopCtx, roomA, `/chat?c=${roomA.dm}`, true);
  const web = await client(webCtx, roomA, "/tasks", false);
  await setFocus(web, false);
  await setFocus(desktop, true);
  await clientsSeen(2);

  // 1 · The desktop app in front, on Chat in that workspace: no notice, shown
  // in place and acknowledged, so the browser tab doesn't ring either.
  const inFront = await say(roomA, `in front ${tag}`);
  await ackedSoon(inFront);
  expect(await rung(desktop)).toHaveLength(0);
  expect(await rung(web)).toHaveLength(0);

  // 2 · The desktop app on another module, a tab in the background: exactly
  // one notice, from the desktop, naming the sender and the workspace.
  await desktop.goto("/tasks");
  await expect(desktop.locator('[data-slot="module-tab"]').first()).toBeVisible();
  await setFocus(desktop, true);
  await clientsSeen(2);
  const elsewhere = await say(roomA, `elsewhere ${tag}`);
  await ackedSoon(elsewhere);
  await expect.poll(async () => (await rung(desktop)).length).toBe(1);
  const [first] = await rung(desktop);
  expect(first.title).toContain(SENDER.name);
  expect(first.title).toContain(roomA.name);
  expect(await rung(web)).toHaveLength(0);
  const firstRingAt = Date.now();
  // It rang while Moduo was in front (on Tasks): switching away and back is
  // not a click on it, so nothing jumps to the message.
  await setFocus(desktop, false);
  await setFocus(desktop, true);
  await desktop.waitForTimeout(500);
  expect(new URL(desktop.url()).pathname).toBe("/tasks");

  // 3 · A burst in that conversation: no second notice for a minute; every
  // row is acknowledged, so no browser rings for them either. The next
  // message after the minute rings once with the burst's count.
  const burst = [await say(roomA, `burst one ${tag}`), await say(roomA, `burst two ${tag}`)];
  for (const id of burst) await ackedSoon(id);
  expect(await rung(desktop)).toHaveLength(1);
  await desktop.waitForTimeout(Math.max(0, firstRingAt + 61_000 - Date.now()));
  await setFocus(desktop, true);
  const after = await say(roomA, `burst three ${tag}`);
  await ackedSoon(after);
  await expect.poll(async () => (await rung(desktop)).length).toBe(2);
  const summary = (await rung(desktop))[1];
  expect(summary.title).toContain(SENDER.name);
  expect(summary.body).toMatch(/^3 messages: burst three/);
  expect(await rung(web)).toHaveLength(0);

  // 4 · A notice from the other workspace says its name; the click (Moduo
  // coming to the front right after) switches workspace and lands on it.
  await setFocus(desktop, false);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const other = await say(roomB, `other workspace ${tag}`);
  // Unfocused and not idle long: the desktop is still the latest active client.
  await ackedSoon(other);
  await expect.poll(async () => (await rung(desktop)).length).toBe(3);
  expect((await rung(desktop))[2].title).toContain(roomB.name);
  await setFocus(desktop, true);
  await expect(desktop).toHaveURL(new RegExp(`/chat\\?.*c=${roomB.dm}`));
  expect(new URL(desktop.url()).searchParams.get("m")).toBe(other);
  expect(
    await desktop.evaluate(
      (uid) => window.localStorage.getItem(`moduo:selected-workspace:${uid}`),
      receiver.user.id,
    ),
  ).toBe(roomB.ws);
  expect(await rung(web)).toHaveLength(0);

  // 5 · You moved to the browser tab (it has your attention now), the desktop
  // in the background: the tab is the latest client, so the desktop doesn't
  // ring, and the tab leaves it to its push (unacknowledged once due).
  await setFocus(desktop, false);
  await setFocus(web, true);
  type Seen = { surface: string; last_active_at: string | null };
  await expect
    .poll(
      async () => {
        const rows = await rest<Seen[]>(
          "service",
          `user_clients?user_id=eq.${receiver.user.id}&select=surface,last_active_at`,
        );
        const at = (surface: string) =>
          Math.max(
            0,
            ...rows
              .filter((r) => r.surface === surface && r.last_active_at)
              .map((r) => Date.parse(r.last_active_at ?? "")),
          );
        return at("web") > at("desktop");
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const rungBefore = (await rung(desktop)).length;
  const contested = await say(roomA, `the tab is latest ${tag}`);
  await new Promise((resolve) => setTimeout(resolve, 9_500));
  const left = await noticeOf(contested);
  expect(left).not.toBeNull();
  expect(left?.acked_at).toBeNull();
  expect(Date.parse(left?.push_after ?? "")).toBeLessThanOrEqual(Date.now());
  expect(await rung(desktop)).toHaveLength(rungBefore);
  expect(await rung(web)).toHaveLength(0);

  // 6 · Both closed: nobody acknowledges, so the row is the browser's to push
  // once it is due (8 s after the message).
  await desktopCtx.close();
  await webCtx.close();
  const closed = await say(roomA, `both closed ${tag}`);
  await new Promise((resolve) => setTimeout(resolve, 9_000));
  const notice = await noticeOf(closed);
  expect(notice).not.toBeNull();
  expect(notice?.acked_at).toBeNull();
  expect(Date.parse(notice?.push_after ?? "")).toBeLessThanOrEqual(Date.now());
});

test("browser permission and sound", async ({ browser }) => {
  // The first Chat open in a browser asks once; refused, Settings says so.
  const askCtx = await browser.newContext();
  // Headless Chromium answers "denied" before anyone asks. Play a browser
  // that hasn't asked yet and whose person says no, remembering it (as a
  // browser does) across reloads.
  await askCtx.addInitScript(() => {
    const read = () =>
      (window.localStorage.getItem("__test_permission") ?? "default") as NotificationPermission;
    Object.defineProperty(window.Notification, "permission", { configurable: true, get: read });
    window.Notification.requestPermission = async () => {
      window.localStorage.setItem("__test_permission", "denied");
      return "denied";
    };
  });
  const ask = await askCtx.newPage();
  await signInPage(ask, receiver, roomA.ws);
  await ask.goto("/settings?section=preferences");
  const browserRow = ask.getByText(/Get reminders and messages from this browser|aren't set up/);
  await expect(browserRow).toBeVisible({ timeout: 30_000 });
  test.skip(
    (await browserRow.textContent())?.includes("aren't set up") ?? false,
    "This build has no VAPID key: run with PUBLIC_VAPID_PUBLIC_KEY set.",
  );
  await ask.goto(`/chat?c=${roomA.dm}`);
  const prompt = ask.getByText("Get a notice when someone messages you");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await ask.getByRole("button", { name: "Allow" }).click();
  await expect(prompt).toBeHidden();
  await expect
    .poll(() => ask.evaluate(() => window.localStorage.getItem("moduo:chat-notice-ask")))
    .toBe("refused");
  // Asked once: never again in this browser.
  await ask.reload();
  await expect(ask.locator('[data-slot="module-tab"]').first()).toBeVisible({ timeout: 30_000 });
  await ask.waitForTimeout(2000);
  await expect(prompt).toBeHidden();
  await ask.goto("/settings?section=preferences");
  await expect(ask.getByText(/Not allowed by the browser/)).toBeVisible({ timeout: 15_000 });
  await askCtx.close();
  // That tab was the latest client a moment ago: forget it.
  await rest("service", `user_clients?user_id=eq.${receiver.user.id}`, { method: "DELETE" });

  // Sound: off by default, then one switch turns it on.
  const desktopCtx = await browser.newContext();
  const desktop = await client(desktopCtx, roomA, "/tasks", true);
  await setFocus(desktop, true);
  await clientsSeen(1);
  const quiet = await say(roomA, `no sound ${tag}`);
  await ackedSoon(quiet);
  expect(await sounds(desktop)).toBe(0);

  await desktop.goto("/settings?section=preferences");
  const toggle = desktop.getByRole("switch", { name: "Chat sound" });
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await desktop.goto("/tasks");
  await expect(desktop.locator('[data-slot="module-tab"]').first()).toBeVisible();
  await setFocus(desktop, true);
  await clientsSeen(1);
  // The page reloaded, so this client's per-tag memory starts empty.
  const loud = await say(roomA, `with sound ${tag}`);
  await ackedSoon(loud);
  await expect.poll(() => sounds(desktop)).toBe(1);
  // Turn it back off for the next run (the preference follows the person).
  await desktop.goto("/settings?section=preferences");
  await desktop.getByRole("switch", { name: "Chat sound" }).click();
  await expect(desktop.getByRole("switch", { name: "Chat sound" })).not.toBeChecked();
  await desktopCtx.close();
});
