/**
 * The push-send request (TV-D12): only the database's own kick gets in, then
 * every waiting delivery goes to its person's browsers.
 *
 * `notice_deliveries__kick` posts here with `x-push-sender-secret` (from Vault)
 * after the reminder sender ran. The secret is checked by the database itself
 * (`notice_deliveries__authorize`); the function holds no copy. The run claims
 * deliveries (each claim counts an attempt; five and a delivery is dropped),
 * sends each to every browser of its person, and settles: a delivery is done
 * once one browser took it, and endpoints the push service says are gone are
 * forgotten.
 *
 * Plain TypeScript with injected dependencies; index.ts wires the real ones.
 */

import type { PushOutcome, PushSubscriptionKeys } from "../_shared/web-push.ts";

export type ClaimedDelivery = {
  id: string;
  /** Whose it is: the browser shows the words only while they're signed in there. */
  user_id: string;
  /** What it is (TV-D16: "reminder" or "agent"); absent from a database before it. */
  kind?: string | null;
  title: string;
  body: string | null;
  url: string | null;
  task_id: string | null;
  /** A burst's shared tag (CV-6a: "chat:<conversation>"); absent from a database before it. */
  tag?: string | null;
  subscriptions: PushSubscriptionKeys[];
};

export type SettledDelivery = { id: string; ok: boolean; error?: string; gone?: string[] };

export type PushRequest = { method: string; secret: string | null };
export type PushResponse = { status: number; body: Record<string, unknown> };

export type PushDeps = {
  authorize: (secret: string) => Promise<boolean>;
  claim: (limit: number) => Promise<ClaimedDelivery[]>;
  settle: (results: SettledDelivery[]) => Promise<unknown>;
  send: (subscription: PushSubscriptionKeys, message: Record<string, unknown>) => Promise<PushOutcome>;
  /** False when the VAPID keys aren't configured: nothing can be sent. */
  configured: boolean;
  defer?: (task: Promise<unknown>) => void;
  report?: (event: string, detail: Record<string, unknown>) => void;
  /**
   * `notice_deliveries__next_due`: milliseconds until the next notice inside
   * its hold is due (a chat notice waits 8 s for a client to acknowledge it),
   * or null when none is due within 10 s. Without it (or `sleep`) one claim.
   */
  nextDue?: () => Promise<number | null>;
  sleep?: (ms: number) => Promise<void>;
};

/** Long enough for any secret the migration's kick sends, short enough to refuse junk early. */
const SECRET_SHAPE = /^[A-Za-z0-9_-]{32,256}$/;
const BATCH = 100;
/** The longest one run waits for a held notice (round-3 §2.14 d). */
export const HOLD_WAIT_MAX_MS = 10_000;
/** Claims per run: now, and after waiting for what was held (a burst drains in one kick). */
const DRAIN_ROUNDS = 3;
/** A little past the hold, so the claim's clock sees it due. */
const HOLD_SLACK_MS = 250;

const CHAT_KINDS = new Set([
  "chat_message",
  "chat_mention",
  "chat_reply",
  "chat_announcement",
  "chat_reminder",
  "chat_focus_summary",
]);

/**
 * What a browser gets (public/push-display.js reads these keys): ids and the
 * task's title, cut short, never a description or comment. The browser shows
 * it only while its person is signed in there; anyone else sees a plain line.
 */
export function pushMessage(delivery: ClaimedDelivery): Record<string, unknown> {
  const url = delivery.url && /^\/(?!\/)/.test(delivery.url) ? delivery.url : "/";
  // Chat (CV-6a): the server wrote "Sofia Ortiz · #plans · Acme" and the
  // text (only while "Show message text" is on) for this person; a burst
  // shares its tag, so the browser replaces the last notice.
  if (delivery.kind && CHAT_KINDS.has(delivery.kind)) {
    return {
      uid: delivery.user_id,
      title: delivery.title.slice(0, 120),
      body: (delivery.body ?? "").slice(0, 160),
      url,
      tag: delivery.tag ? delivery.tag.slice(0, 80) : `notice-${delivery.id}`,
    };
  }
  // A reminder carries only the task's title; an agent's notice (TV-D16)
  // carries its own line ("Claude is ready for review") and the task's title
  // as its body. A database from before TV-D16 sends no kind: a reminder.
  const agent = delivery.kind === "agent";
  return {
    uid: delivery.user_id,
    title: agent ? delivery.title.slice(0, 80) : "Reminder",
    body: (agent ? (delivery.body ?? "") : delivery.title).slice(0, 80),
    url,
    tag: delivery.task_id
      ? `${agent ? "agent" : "reminder"}-${delivery.task_id}`
      : `notice-${delivery.id}`,
  };
}

export async function runPush(deps: PushDeps): Promise<{ claimed: number; sent: number; failed: number }> {
  const claimed = await deps.claim(BATCH);
  const results: SettledDelivery[] = [];
  let sent = 0;
  let failed = 0;
  for (const delivery of claimed) {
    const message = pushMessage(delivery);
    const gone: string[] = [];
    let ok = false;
    let error: string | undefined;
    for (const subscription of delivery.subscriptions ?? []) {
      const outcome: PushOutcome = await deps
        .send(subscription, message)
        .catch((e: unknown) => ({
          ok: false as const,
          gone: false as const,
          status: 0,
          error: e instanceof Error ? e.message : String(e),
        }));
      if (outcome.ok) ok = true;
      else if (outcome.gone) gone.push(subscription.endpoint);
      else error = outcome.error;
    }
    if (ok) sent += 1;
    else failed += 1;
    results.push({ id: delivery.id, ok, error: ok ? undefined : (error ?? "no browser took it"), gone });
  }
  if (results.length > 0) await deps.settle(results);
  return { claimed: claimed.length, sent, failed };
}

/**
 * One kick drains a burst: claim what is due, then, while a notice is still
 * inside its hold (≤ 10 s away), wait for it and claim again. The minute job
 * stays the sweeper for anything left.
 */
export async function drainPush(deps: PushDeps): Promise<{ claimed: number; sent: number; failed: number }> {
  const total = { claimed: 0, sent: 0, failed: 0 };
  for (let round = 1; ; round += 1) {
    const summary = await runPush(deps);
    total.claimed += summary.claimed;
    total.sent += summary.sent;
    total.failed += summary.failed;
    if (round >= DRAIN_ROUNDS || !deps.nextDue || !deps.sleep) break;
    // A database without the wait (before CV-6a's migration) just stops here.
    const wait = await deps.nextDue().catch(() => null);
    if (wait === null || !Number.isFinite(wait) || wait < 0 || wait > HOLD_WAIT_MAX_MS) break;
    await deps.sleep(wait + HOLD_SLACK_MS);
  }
  return total;
}

export async function handlePushRequest(request: PushRequest, deps: PushDeps): Promise<PushResponse> {
  const report = deps.report ?? (() => {});
  if (request.method !== "POST") return { status: 405, body: { error: "method_not_allowed" } };
  const secret = (request.secret ?? "").trim();
  if (!SECRET_SHAPE.test(secret)) return { status: 401, body: { error: "unauthorized" } };
  let authorized: boolean;
  try {
    authorized = await deps.authorize(secret);
  } catch (error) {
    report("authorize_failed", { error: error instanceof Error ? error.message : String(error) });
    return { status: 503, body: { error: "unavailable" } };
  }
  if (!authorized) return { status: 401, body: { error: "unauthorized" } };
  if (!deps.configured) {
    report("not_configured", {});
    return { status: 503, body: { error: "not_configured" } };
  }
  const task = drainPush(deps)
    .then((summary) => {
      if (summary.claimed > 0) report("run", summary);
    })
    .catch((error: unknown) => {
      report("run_failed", { error: error instanceof Error ? error.message : String(error) });
    });
  if (deps.defer) {
    deps.defer(task);
    return { status: 202, body: { accepted: true } };
  }
  await task;
  return { status: 200, body: { done: true } };
}
