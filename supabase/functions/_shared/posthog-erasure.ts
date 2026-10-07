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
 *                             Not eu.i.posthog.com, which only takes events. Anything
 *                             but an https URL counts as not configured.
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

/** Reads the secrets above; null when the key or the project id isn't set, or the host
 *  isn't an https URL. A broken setup must read as "not configured", never as an error
 *  that fails every account deletion. */
export function postHogEraserFromEnv(
  env: (name: string) => string | undefined,
  fetchImpl?: typeof fetch,
): ErasurePostHog | null {
  const apiKey = env("POSTHOG_PERSONAL_API_KEY")?.trim();
  const projectId = env("POSTHOG_PROJECT_ID")?.trim();
  const host = env("POSTHOG_API_HOST")?.trim() || undefined;
  if (!apiKey || !projectId) return null;
  if (host !== undefined && !isHttpsUrl(host)) return null;
  return makePostHogEraser({ apiKey, projectId, host, fetch: fetchImpl });
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Worth another go later: a timeout, a rate limit, or PostHog having a bad moment (5xx).
 *  Any other answer that isn't a success means this request will never work as set up. */
function isTransient(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Long enough for PostHog, short enough that account deletion doesn't hang on it. */
export const POSTHOG_TIMEOUT_MS = 10_000;

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
        signal: AbortSignal.timeout(POSTHOG_TIMEOUT_MS),
      });
      const text = await res.text();
      if (res.ok) {
        const summary = parseJson(text);
        // 202 is bulk_delete's answer, with or without a summary. Any other success must
        // at least be JSON: an HTML page means a wrong host, which won't delete anything.
        if (res.status !== 202 && (summary === null || typeof summary !== "object")) {
          return { status: "refused", httpStatus: res.status };
        }
        const errors = (summary as { deletion_errors?: unknown } | null)?.deletion_errors;
        // A person PostHog matched but couldn't finish deleting: worth another go.
        if (Array.isArray(errors) && errors.length > 0) {
          throw new Error(`PostHog couldn't finish the deletion: ${clip(text)}`);
        }
        return { status: "queued" };
      }
      if (!isTransient(res.status)) return { status: "refused", httpStatus: res.status };
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
