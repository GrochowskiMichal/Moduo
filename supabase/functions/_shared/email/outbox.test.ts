import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@rstest/core";

import { heading, lockup } from "./blocks.ts";
import {
  buildOutboxEmail,
  nextRetryAt,
  OUTBOX_BACKOFF_MINUTES,
  OUTBOX_MAX_ATTEMPTS,
  type OutboxOutcome,
  type OutboxRow,
  type QueuedTemplate,
  runOutbox,
} from "./outbox.ts";
import type { OutgoingEmail, SendResult } from "./send.ts";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations/20261008233000_email_outbox_worker.sql",
);

function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: "row-1",
    kind: "ops_alert",
    stream: "account",
    to_email: "hello@moduo.app",
    to_user_id: null,
    payload: { reason: "test" },
    dedupe_key: "ops_alert:test:1",
    attempts: 1,
    ...overrides,
  };
}

/** An in-memory queue: claim hands out rows in order, finish records outcomes. */
function fakeQueue(rows: OutboxRow[], results: SendResult[] = []) {
  const pending = [...rows];
  const finished: OutboxOutcome[] = [];
  const sent: OutgoingEmail[] = [];
  const claims: number[] = [];
  let clock = NOW;
  const deps = {
    claim: async (limit: number) => {
      claims.push(limit);
      return pending.splice(0, limit);
    },
    finish: async (outcome: OutboxOutcome) => {
      finished.push(outcome);
    },
    send: async (email: OutgoingEmail): Promise<SendResult> => {
      sent.push(email);
      return results.shift() ?? { ok: true, id: `re_${sent.length}` };
    },
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  };
  return { deps, finished, sent, claims, advance: (ms: number) => (clock += ms) };
}

describe("claim, send, retry", () => {
  it("sends a due row once, with its dedupe key as the idempotency key, and records it sent", async () => {
    const queue = fakeQueue([row()]);
    const summary = await runOutbox(queue.deps);

    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0].idempotencyKey).toBe("ops_alert:test:1");
    expect(queue.sent[0].to).toBe("hello@moduo.app");
    expect(queue.sent[0].from).toBe('"Moduo" <hello@moduo.app>');
    expect(queue.sent[0].subject).toBe("Email test: the outbox works");
    expect(queue.sent[0].tags).toEqual([{ name: "kind", value: "ops_alert" }]);
    expect(queue.finished).toEqual([{ id: "row-1", outcome: "sent", providerId: "re_1" }]);
    expect(summary).toEqual({ claimed: 1, sent: 1, retried: 0, failed: 0, unrecorded: 0 });
  });

  it("claims in batches until nothing is due", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => row({ id: `r${i}`, dedupe_key: `k${i}` }));
    const queue = fakeQueue(rows);
    const summary = await runOutbox({ ...queue.deps, batchSize: 5 });
    // 5 + 5 + 2, then a claim that finds nothing ends the run.
    expect(queue.claims).toEqual([5, 5, 5, 5]);
    expect(summary.sent).toBe(12);
    // Every row went out exactly once.
    expect(new Set(queue.sent.map((email) => email.idempotencyKey)).size).toBe(12);
  });

  it("backs off 1, 5, 15, 60 minutes, then marks the 5th failed attempt failed", async () => {
    expect(OUTBOX_BACKOFF_MINUTES).toEqual([1, 5, 15, 60]);
    for (const [attempt, minutes] of [
      [1, 1],
      [2, 5],
      [3, 15],
      [4, 60],
    ] as const) {
      const queue = fakeQueue([row({ attempts: attempt })], [
        { ok: false, retryable: true, status: 503, error: "resend_http_503" },
      ]);
      await runOutbox(queue.deps);
      const outcome = queue.finished[0];
      expect(outcome.outcome).toBe("retry");
      if (outcome.outcome !== "retry") throw new Error("unreachable");
      expect(Date.parse(outcome.retryAt) - NOW).toBe(minutes * 60_000);
      expect(outcome.error).toBe("resend_http_503");
    }

    const last = fakeQueue([row({ attempts: OUTBOX_MAX_ATTEMPTS })], [
      { ok: false, retryable: true, status: null, error: "timeout" },
    ]);
    const summary = await runOutbox(last.deps);
    expect(last.finished).toEqual([{ id: "row-1", outcome: "failed", error: "timeout" }]);
    expect(summary.failed).toBe(1);
    expect(nextRetryAt(OUTBOX_MAX_ATTEMPTS, NOW)).toBeNull();
  });

  it("never retries a permanent refusal", async () => {
    const queue = fakeQueue([row()], [{ ok: false, retryable: false, status: 422, error: "Invalid `to` field" }]);
    await runOutbox(queue.deps);
    expect(queue.finished).toEqual([{ id: "row-1", outcome: "failed", error: "Invalid `to` field" }]);
  });

  it("never sends a row it can't render; a kind without a template waits for a deploy, a bad payload fails", async () => {
    const queue = fakeQueue([
      row({ id: "a", kind: "welcome" }),
      row({ id: "a5", kind: "welcome", attempts: OUTBOX_MAX_ATTEMPTS }),
      row({ id: "b", kind: "not_a_kind" }),
      row({ id: "c", payload: { reason: "nonsense" } }),
      row({ id: "d", payload: null }),
    ]);
    await runOutbox(queue.deps);
    expect(queue.sent).toHaveLength(0);
    expect(queue.finished.map((outcome) => [outcome.id, outcome.outcome, "error" in outcome ? outcome.error : ""])).toEqual([
      ["a", "retry", "no_template:welcome"],
      ["a5", "failed", "no_template:welcome"],
      ["b", "failed", "unknown_kind:not_a_kind"],
      ["c", "failed", "render_failed:ops_alert: unknown reason"],
      ["d", "failed", "payload_not_object"],
    ]);
  });

  it("carries on when recording an outcome fails, and counts it (the lease brings the row back)", async () => {
    const queue = fakeQueue([row({ id: "a", dedupe_key: "a" }), row({ id: "b", dedupe_key: "b" })]);
    let calls = 0;
    const summary = await runOutbox({
      ...queue.deps,
      finish: async () => {
        calls += 1;
        if (calls === 1) throw new Error("rpc email_outbox__finish: 503");
      },
    });
    expect(queue.sent).toHaveLength(2);
    expect(summary.unrecorded).toBe(1);
    expect(summary.sent).toBe(2);
  });

  it("paces sends and stops claiming once the time budget is spent", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => row({ id: `r${i}`, dedupe_key: `k${i}` }));
    const queue = fakeQueue(rows);
    const sendTimes: number[] = [];
    const summary = await runOutbox({
      ...queue.deps,
      batchSize: 2,
      paceMs: 250,
      budgetMs: 400,
      send: async (email) => {
        sendTimes.push(queue.deps.now());
        return queue.deps.send(email);
      },
    });
    // Two per batch, 250 ms apart. The second batch is claimed at 250 ms, inside
    // the budget; after it the clock reads 750 ms, so no third batch.
    expect(sendTimes.map((t) => t - NOW)).toEqual([0, 250, 500, 750]);
    expect(summary.claimed).toBe(4);
  });

  it("uses the updates sender for the updates stream and the template's From name, reply-to and headers", () => {
    const template: QueuedTemplate = () => ({
      doc: { subject: "s", preheader: "p", blocks: [lockup(), heading("h")], footer: { reason: "You got this." } },
      fromName: "Anna Carter via Moduo",
      replyTo: "anna@northwind.studio",
      headers: { "List-Unsubscribe": "<https://moduo.app/email?u=1>" },
    });
    const built = buildOutboxEmail(row({ kind: "build_update", stream: "updates" }), { build_update: template });
    if (!built.ok) throw new Error(built.error);
    expect(built.email.from).toBe('"Anna Carter via Moduo" <updates@news.moduo.app>');
    expect(built.email.replyTo).toBe("anna@northwind.studio");
    expect(built.email.headers).toEqual({ "List-Unsubscribe": "<https://moduo.app/email?u=1>" });
  });
});

describe("one run at a time", () => {
  it("runs while it holds the lease and releases it afterwards", async () => {
    const queue = fakeQueue([row()]);
    const calls: string[] = [];
    const summary = await runOutbox({
      ...queue.deps,
      lock: {
        start: async () => {
          calls.push("start");
          return "token-1";
        },
        stop: async (token) => {
          calls.push(`stop:${token}`);
        },
      },
    });
    expect(summary.sent).toBe(1);
    expect(calls).toEqual(["start", "stop:token-1"]);
  });

  it("does nothing when another run holds the lease", async () => {
    const queue = fakeQueue([row()]);
    const summary = await runOutbox({
      ...queue.deps,
      lock: { start: async () => null, stop: async () => {} },
    });
    expect(summary).toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0, unrecorded: 0, busy: true });
    expect(queue.claims).toEqual([]);
  });

  it("releases the lease when the run throws", async () => {
    const released: string[] = [];
    await expect(
      runOutbox({
        ...fakeQueue([]).deps,
        claim: async () => {
          throw new Error("rpc email_outbox__claim: 503");
        },
        lock: { start: async () => "t", stop: async (token) => void released.push(token) },
      }),
    ).rejects.toThrow("503");
    expect(released).toEqual(["t"]);
  });

  it("keeps addresses out of its reports", async () => {
    const events: Record<string, unknown>[] = [];
    const queue = fakeQueue([row()], [{ ok: false, retryable: false, status: 422, error: "Invalid to: tom@becker.studio" }]);
    await runOutbox({ ...queue.deps, report: (_event, detail) => events.push(detail) });
    expect(JSON.stringify(events)).not.toContain("tom@becker.studio");
    expect(JSON.stringify(events)).toContain("[address]");
  });
});

describe("the SQL side agrees", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("caps attempts at the same number the worker does (plus one idempotent claim for a lost run)", () => {
    expect(sql).toContain(`o.attempts >= ${OUTBOX_MAX_ATTEMPTS + 1};`);
    expect(sql).toContain(`WHEN p_outcome = 'retry' AND o.attempts < ${OUTBOX_MAX_ATTEMPTS} THEN 'queued'`);
  });

  it("never queues or suppresses sign-in codes", () => {
    expect(sql).toContain("IF p_kind = 'auth_code' THEN");
    expect(sql).toContain("WHERE o.kind <> 'auth_code'");
  });
});
