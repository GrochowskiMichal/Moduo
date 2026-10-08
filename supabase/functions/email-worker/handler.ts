/**
 * The email-worker request (specs/transactional-email.md TX-3, T12): only the
 * database's own kicks get in, then the run happens after the answer.
 *
 * pg_net posts here from the outbox's insert trigger and from the minute job,
 * with `x-email-worker-secret`. The value is checked by the database itself
 * (`email_outbox__authorize`, against the copy in Vault), so the function holds
 * no copy of it. Authorized requests are answered 202 at once and the run goes
 * on in the background (`defer` = EdgeRuntime.waitUntil): a run can take tens of
 * seconds, longer than pg_net should wait.
 *
 * Plain TypeScript with injected dependencies; index.ts wires the real ones.
 */

import type { OutboxRunSummary } from "../_shared/email/outbox.ts";

/** The shape of the Vault secret 20261008233000_email_outbox_worker.sql creates. */
export const WORKER_SECRET_SHAPE = /^[0-9a-f]{64}$/;

export type WorkerRequest = { method: string; secret: string | null };
export type WorkerResponse = { status: number; body: Record<string, unknown> };

export type WorkerDeps = {
  /** `email_outbox__authorize(secret)`; may throw when the database is unreachable. */
  authorize: (secret: string) => Promise<boolean>;
  run: () => Promise<OutboxRunSummary>;
  /** Keeps the run alive after the answer. Without it the run is awaited (tests). */
  defer?: (task: Promise<unknown>) => void;
  report?: (event: string, detail: Record<string, unknown>) => void;
};

export async function handleWorkerRequest(request: WorkerRequest, deps: WorkerDeps): Promise<WorkerResponse> {
  const report = deps.report ?? (() => {});
  if (request.method !== "POST") return { status: 405, body: { error: "method_not_allowed" } };
  const secret = (request.secret ?? "").trim();
  // The migration generates 64 hex characters. Anything else is refused before
  // it costs a database call (the URL is public).
  if (!WORKER_SECRET_SHAPE.test(secret)) return { status: 401, body: { error: "unauthorized" } };

  let authorized: boolean;
  try {
    authorized = await deps.authorize(secret);
  } catch (error) {
    report("authorize_failed", { error: error instanceof Error ? error.message : String(error) });
    return { status: 503, body: { error: "unavailable" } };
  }
  if (!authorized) {
    report("unauthorized", {});
    return { status: 401, body: { error: "unauthorized" } };
  }

  let summary: OutboxRunSummary | null = null;
  const task = deps
    .run()
    .then((result) => {
      summary = result;
      if (result.claimed > 0) report("run", result);
    })
    .catch((error: unknown) => {
      report("run_failed", { error: error instanceof Error ? error.message : String(error) });
    });

  if (deps.defer) {
    deps.defer(task);
    return { status: 202, body: { accepted: true } };
  }
  await task;
  return { status: 200, body: { ok: true, ...(summary ?? {}) } };
}
