/**
 * Erasing a person's app analytics at PostHog (PRIV-3).
 *
 * The app knows an analytics user by their Supabase user id alone (src/lib/analytics.ts),
 * so deleting the PostHog person with that distinct id, with `delete_events`, removes
 * everything PostHog holds for the account. PostHog deletes the person at once and
 * queues the events for its weekly deletion run (Sundays, 05:00 UTC); only events
 * captured before the request go. Used by account deletion (account-erasure.ts) and by
 * the analytics-forget function, when someone switches app analytics off.
 *
 * Configured by Edge Function secrets. Without the first two there is nothing to erase
 * with, and the callers treat that as "not configured":
 *   POSTHOG_PERSONAL_API_KEY  a personal API key with the person:write scope
 *   POSTHOG_PROJECT_ID        the project's numeric id
 *   POSTHOG_API_HOST          optional; default https://eu.posthog.com, the private API.
 *                             Not eu.i.posthog.com, which only takes events.
 *
 * Plain TypeScript with an injected fetch (no Deno globals), so the unit tests can run it.
 */

export const POSTHOG_DEFAULT_API_HOST = "https://eu.posthog.com";

export type PostHogEraseResult =
  /** PostHog took the request: the person is gone (if there was one), their events are
   *  queued. */
  | { status: "queued" }
  /** PostHog refused it (wrong key, scope or project): retrying won't help until the
   *  setup is fixed. */
  | { status: "refused"; httpStatus: number };

export interface ErasurePostHog {
  /** Deletes the person with this distinct id and queues their events for deletion.
   *  Throws on a failure worth retrying: a network error, a rate limit, a 5xx. */
  erasePerson(distinctId: string): Promise<PostHogEraseResult>;
}

export type PostHogEraserConfig = {
  apiKey: string;
  projectId: string;
  host?: string;
  fetch?: typeof fetch;
};

/** Reads the secrets above; null when the key or the project id isn't set. */
export function postHogEraserFromEnv(
  env: (name: string) => string | undefined,
  fetchImpl?: typeof fetch,
): ErasurePostHog | null {
  const apiKey = env("POSTHOG_PERSONAL_API_KEY")?.trim();
  const projectId = env("POSTHOG_PROJECT_ID")?.trim();
  if (!apiKey || !projectId) return null;
  return makePostHogEraser({
    apiKey,
    projectId,
    host: env("POSTHOG_API_HOST")?.trim() || undefined,
    fetch: fetchImpl,
  });
}

/** 400 / 401 / 403 / 404: the request itself is wrong for this key or project. */
const PERMANENT = new Set([400, 401, 403, 404]);

export function makePostHogEraser(config: PostHogEraserConfig): ErasurePostHog {
  const host = (config.host || POSTHOG_DEFAULT_API_HOST).replace(/\/+$/, "");
  const url = `${host}/api/projects/${encodeURIComponent(config.projectId)}/persons/bulk_delete/`;
  const send = config.fetch ?? fetch;

  return {
    async erasePerson(distinctId) {
      // bulk_delete reads a JSON body (PostHog's API reference lists these as query
      // parameters; the server reads request.data). It answers 202 with a summary.
      const res = await send(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          distinct_ids: [distinctId],
          delete_events: true,
          delete_recordings: true,
        }),
      });
      const text = await res.text();
      if (res.ok) {
        const summary = parseJson(text) as { deletion_errors?: unknown } | null;
        // A person PostHog matched but couldn't finish deleting: worth another go.
        if (Array.isArray(summary?.deletion_errors) && summary.deletion_errors.length > 0) {
          throw new Error(`PostHog couldn't finish the deletion: ${clip(text)}`);
        }
        return { status: "queued" };
      }
      if (PERMANENT.has(res.status)) return { status: "refused", httpStatus: res.status };
      throw new Error(`PostHog ${res.status}: ${clip(text)}`);
    },
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function clip(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
