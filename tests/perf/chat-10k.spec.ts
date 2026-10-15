import { expect, type Page, test } from "@playwright/test";

import { CHAT_PERF_MESSAGES, seedChatPerfFixture } from "../../scripts/perf/seed-chat-10k";
import type { ChatRoom } from "../support/chat-room";
import { rest, signInPage } from "../support/local-stack";

/**
 * Chat v2 CV-7a · "the budgets" (AC1.15, AC12.3; spec §Assumptions #22, spike
 * 1) on the 10,000-message fixture, against the LOCAL stack only:
 *   bun scripts/perf/seed-chat-10k.ts
 *   E2E_BASE_URL=http://127.0.0.1:<port> bunx playwright test --project=perf tests/perf/chat-10k.spec.ts
 * (or scripts/agent/e2e.sh --project=perf tests/perf/chat-10k.spec.ts).
 *
 * Every number is taken inside the page: from the input's first event to the
 * frame that shows its result, and the reader's row is sampled on every
 * painted frame (a one-frame jump counts). Budgets: warm open ≤ 100 ms, your
 * own message ≤ 50 ms, ≤ 3,000 elements in the stream, no frame over 50 ms
 * in a 2 s fling, the reader's row moves ≤ 1 px on a prepend, an edit above
 * it and a density switch. Wrap up's fold is CV-12's (its own check there).
 */

const WARM_OPEN_MS = 100;
const OWN_MESSAGE_MS = 50;
const MAX_ELEMENTS = 3000;
const MAX_FRAME_MS = 50;
const MAX_DRIFT_PX = 1;

let room: ChatRoom;

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 }, locale: "en-US" });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  room = await seedChatPerfFixture();
});

async function openGeneral(page: Page): Promise<void> {
  await signInPage(page, room.owner, room.ws);
  await page.goto(`/chat?c=${room.general}`);
  await expect(page.getByTestId("message-stream").getByRole("article").first()).toBeVisible({
    timeout: 30_000,
  });
}

/** In the page: resolves with ms from `arm` to the first frame where the wanted message is drawn. */
async function timeUntil(
  page: Page,
  arm: () => Promise<void>,
  /** The first message is drawn (null), or one that holds this text. */
  text: string | null,
): Promise<number> {
  await page.evaluate((wanted) => {
    const w = window as Window & { __t0?: number; __tDone?: Promise<number> };
    w.__t0 = undefined;
    const check = () => {
      const rows = document.querySelectorAll('[data-testid="message-stream"] [role="article"]');
      if (wanted === null) return rows.length > 0;
      return [...rows].some((a) => (a.textContent ?? "").includes(wanted));
    };
    w.__tDone = new Promise((resolve) => {
      const start = () => {
        if (w.__t0 === undefined) w.__t0 = performance.now();
      };
      window.addEventListener("pointerdown", start, { capture: true, once: true });
      window.addEventListener("keydown", start, { capture: true, once: true });
      const tick = () => {
        if (w.__t0 !== undefined && check()) {
          requestAnimationFrame(() => resolve(performance.now() - (w.__t0 ?? 0)));
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, text);
  await arm();
  return page.evaluate(() => (window as Window & { __tDone?: Promise<number> }).__tDone ?? 0);
}

/** In the page: samples the reader's row on every frame for `ms`; the largest move. */
async function driftWhile(page: Page, act: () => Promise<void>, ms = 2500): Promise<number> {
  await page.evaluate((duration) => {
    const w = window as Window & { __drift?: Promise<number> };
    const stream = document.querySelector<HTMLElement>('[data-testid="message-stream"]')!;
    const box = stream.getBoundingClientRect();
    const rows = [...stream.querySelectorAll<HTMLElement>("[data-message-id]")];
    const anchor = rows.find((r) => {
      const b = r.getBoundingClientRect();
      return b.top >= box.top && b.bottom <= box.bottom;
    })!;
    const id = anchor.dataset.messageId;
    const top0 = anchor.getBoundingClientRect().top;
    let worst = 0;
    const until = performance.now() + duration;
    w.__drift = new Promise((resolve) => {
      const tick = () => {
        const el = stream.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
        if (el) worst = Math.max(worst, Math.abs(el.getBoundingClientRect().top - top0));
        if (performance.now() < until) requestAnimationFrame(tick);
        else resolve(worst);
      };
      requestAnimationFrame(tick);
    });
  }, ms);
  await act();
  return page.evaluate(() => (window as Window & { __drift?: Promise<number> }).__drift ?? 0);
}

test("the budgets", async ({ page }) => {
  test.setTimeout(240_000);
  await openGeneral(page);

  // Warm open: away to Home and back to Chat (the store and the device copy are held).
  await page.getByRole("button", { name: /^Home/ }).first().click();
  await expect(page.getByTestId("message-stream")).toHaveCount(0);
  const warm = await timeUntil(
    page,
    () => page.getByRole("button", { name: /^Chat/ }).first().click(),
    null,
  );
  console.log(`warm open: ${warm.toFixed(1)} ms`);
  expect(warm).toBeLessThanOrEqual(WARM_OPEN_MS);

  // Elements: only what's on screen is drawn.
  const elements = await page
    .getByTestId("message-stream")
    .evaluate((el) => el.querySelectorAll("*").length);
  console.log(`stream elements: ${elements} (of ${CHAT_PERF_MESSAGES} messages)`);
  expect(elements).toBeLessThanOrEqual(MAX_ELEMENTS);

  // Your own message is on screen within 50 ms of ⏎.
  const composer = page.locator("[data-chat-composer] textarea");
  const text = `perf own ${Date.now()}`;
  await composer.fill(text);
  const own = await timeUntil(page, () => composer.press("Enter"), text);
  console.log(`own message: ${own.toFixed(1)} ms`);
  expect(own).toBeLessThanOrEqual(OWN_MESSAGE_MS);

  // A 2 s fling up through history: no frame over 50 ms.
  await page.getByTestId("message-stream").hover();
  await page.evaluate(() => {
    const w = window as Window & { __frames?: Promise<number> };
    let last = performance.now();
    let worst = 0;
    const until = last + 2000;
    w.__frames = new Promise((resolve) => {
      const tick = (t: number) => {
        worst = Math.max(worst, t - last);
        last = t;
        if (t < until) requestAnimationFrame(tick);
        else resolve(worst);
      };
      requestAnimationFrame(tick);
    });
  });
  const flingEnd = Date.now() + 2000;
  while (Date.now() < flingEnd) await page.mouse.wheel(0, -600);
  const worstFrame = await page.evaluate(
    () => (window as Window & { __frames?: Promise<number> }).__frames ?? 0,
  );
  console.log(`worst frame in a fling: ${worstFrame.toFixed(1)} ms`);
  expect(worstFrame).toBeLessThanOrEqual(MAX_FRAME_MS);

  // A prepend near the top: the reader's row stays put.
  await page.waitForTimeout(800);
  const stream = page.getByTestId("message-stream");
  const prepend = await driftWhile(page, async () => {
    await stream.evaluate((el) => {
      el.scrollTop = Math.min(el.scrollTop, 900);
      el.dispatchEvent(new Event("scroll"));
    });
  });
  console.log(`drift on prepend: ${prepend.toFixed(2)} px`);

  // An edit above the viewport (a longer body arrives live): the row stays put.
  const above = await stream.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const rows = [...el.querySelectorAll<HTMLElement>("[data-message-id]")];
    return rows.filter((r) => r.getBoundingClientRect().bottom < box.top).pop()?.dataset.messageId;
  });
  let edit = 0;
  if (above) {
    edit = await driftWhile(page, async () => {
      await rest("service", `chat_messages?id=eq.${above}`, {
        method: "PATCH",
        body: { body: "Edited above the reader.\n\nA second paragraph.\n\nAnd a third one." },
      });
    });
    console.log(`drift on an edit above: ${edit.toFixed(2)} px`);
  }

  // A density switch while reading history.
  const density = await driftWhile(page, async () => {
    await page.evaluate(() => {
      document.documentElement.dataset.density = "dense";
    });
  });
  console.log(`drift on density: ${density.toFixed(2)} px`);

  expect(prepend).toBeLessThanOrEqual(MAX_DRIFT_PX);
  expect(edit).toBeLessThanOrEqual(MAX_DRIFT_PX);
  expect(density).toBeLessThanOrEqual(MAX_DRIFT_PX);
});
