/** Outlook Calendar through the calendar-microsoft-web function (view only). Web and desktop share it. */

import type { CalendarRuntime } from "./runtime.types";
import { supabaseClient } from "./runtime.web.client";

const FUNCTION = "calendar-microsoft-web";

/**
 * No web token for the login, no Microsoft client on the server, or no function
 * deployed yet: not this account's fault.
 */
const SKIPPED = new Set([
  "outlook_not_connected",
  "outlook_not_configured",
  "outlook_not_deployed",
]);

/** The function's `{ error }` code from a refused call, else the error's message. */
async function refusalCode(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error) return body.error;
    } catch {
      // Not JSON: fall back to the message.
    }
    // The gateway's own 404: the function isn't deployed here yet.
    if (context.status === 404) return "outlook_not_deployed";
  }
  return error instanceof Error && error.message ? error.message : "outlook_unavailable";
}

async function call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseClient.functions.invoke(FUNCTION, { body });
  if (error) throw new Error(await refusalCode(error));
  const payload = (data ?? {}) as Record<string, unknown>;
  if (typeof payload.error === "string" && payload.error) throw new Error(payload.error);
  return payload;
}

export const webCalendarOutlook: Pick<
  CalendarRuntime,
  "startOutlookConnect" | "outlookEvents" | "disconnectOutlook"
> = {
  async startOutlookConnect(origin) {
    const payload = await call({ action: "start", origin });
    if (typeof payload.url !== "string" || !payload.url) throw new Error("outlook_no_url");
    return payload.url;
  },
  async outlookEvents(input) {
    let payload: Record<string, unknown>;
    try {
      payload = await call({ action: "events", ...input });
    } catch (err) {
      if (err instanceof Error && SKIPPED.has(err.message)) {
        throw new Error("web_provider_sync_skipped");
      }
      throw err;
    }
    if (!Array.isArray(payload.events)) throw new Error("outlook_no_events");
    return payload.events as Record<string, unknown>[];
  },
  async disconnectOutlook(email) {
    await call({ action: "disconnect", email });
  },
};
