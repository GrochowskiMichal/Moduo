/**
 * Asks the server to delete what PostHog holds for the signed-in person (PRIV-3), after
 * they switch app analytics off. The server side is supabase/functions/analytics-forget.
 * Loaded on demand by lib/analytics.ts.
 */

import { getRuntime } from "./runtime";
import { SUPABASE_URL } from "./runtime.web";

/** true once the server has taken the request, or has nothing to delete with. false means
 *  try again later: offline, a server error, or `userId` isn't who's signed in now. */
export async function requestAnalyticsForget(userId: string): Promise<boolean> {
  const runtime = getRuntime();
  if (!runtime) return false;
  try {
    const { data } = await runtime.auth.getSession();
    const session = data.session;
    // Only ever for the person who's signed in; their next session retries otherwise.
    if (!session || session.user.id !== userId) return false;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/analytics-forget`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
