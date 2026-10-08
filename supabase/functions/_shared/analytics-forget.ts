/**
 * What analytics-forget does once it knows who is calling (PRIV-3): delete the PostHog
 * person whose distinct id is the caller's user id, with their events
 * (posthog-erasure.ts). The function (functions/analytics-forget) adds the HTTP and the
 * auth around it.
 *
 * Every answer but 200 tells the app to keep its request and send it again in a later
 * session. That includes a missing or refused PostHog setup, so a switch-off made before
 * the setup was fixed is still carried out afterwards.
 *
 * Plain TypeScript with injected clients (no Deno globals), so the unit tests can run it:
 * see analytics-forget.test.ts.
 */

import type { ErasurePostHog } from "./posthog-erasure.ts";

/** How long to wait before deleting. The app asks the moment the person switches off,
 *  when it may still be sending its last batch, and PostHog only deletes events it
 *  already has. Waiting here rather than in the app means the request leaves while the
 *  person is still signed in. */
export const FORGET_SETTLE_MS = 10_000;

export type ForgetDeps = {
  /** null when the PostHog secrets aren't configured. */
  posthog: ErasurePostHog | null;
  sleep: (ms: number) => Promise<void>;
};

export type ForgetResponse =
  | { status: 200; body: { ok: true } }
  | { status: 502 | 503; body: { error: string } };

const TRY_AGAIN = "Couldn't delete your analytics right now. Moduo will try again later.";

export async function forgetAnalytics(deps: ForgetDeps, userId: string): Promise<ForgetResponse> {
  if (!deps.posthog) {
    // Logged with the user id, like a refusal, so the deletion can't be lost.
    console.warn("[analytics-forget] PostHog erasure isn't configured", userId);
    return { status: 503, body: { error: TRY_AGAIN } };
  }
  await deps.sleep(FORGET_SETTLE_MS);
  try {
    const result = await deps.posthog.erasePerson(userId);
    if (result.status === "queued") return { status: 200, body: { ok: true } };
    // A wrong key, scope or project id: the app keeps asking until the setup is fixed.
    console.warn("[analytics-forget] PostHog refused", userId, result.httpStatus);
    return { status: 503, body: { error: TRY_AGAIN } };
  } catch (err) {
    console.error("[analytics-forget] PostHog failed", userId, err);
    return { status: 502, body: { error: TRY_AGAIN } };
  }
}
