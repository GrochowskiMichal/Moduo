import { describe, expect, it } from "@rstest/core";

import type { OutboxRunSummary } from "../_shared/email/outbox.ts";
import { handleWorkerRequest, type WorkerDeps } from "./handler.ts";

const SECRET = "a".repeat(64);
const SUMMARY: OutboxRunSummary = { claimed: 2, sent: 2, retried: 0, failed: 0, unrecorded: 0 };

function deps(overrides: Partial<WorkerDeps> = {}) {
  let runs = 0;
  const value: WorkerDeps = {
    authorize: async (secret) => secret === SECRET,
    run: async () => {
      runs += 1;
      return SUMMARY;
    },
    ...overrides,
  };
  return { value, runs: () => runs };
}

describe("email-worker request", () => {
  it("runs the outbox for the database's kick", async () => {
    const d = deps();
    expect(await handleWorkerRequest({ method: "POST", secret: SECRET }, d.value)).toEqual({
      status: 200,
      body: { ok: true, ...SUMMARY },
    });
    expect(d.runs()).toBe(1);
  });

  it("answers 202 at once and leaves the run to the runtime when it can", async () => {
    const tasks: Promise<unknown>[] = [];
    const d = deps({ defer: (task) => tasks.push(task) });
    expect(await handleWorkerRequest({ method: "POST", secret: SECRET }, d.value)).toEqual({
      status: 202,
      body: { accepted: true },
    });
    await Promise.all(tasks);
    expect(d.runs()).toBe(1);
  });

  it("refuses a missing or wrong secret without running", async () => {
    const d = deps();
    expect((await handleWorkerRequest({ method: "POST", secret: null }, d.value)).status).toBe(401);
    expect((await handleWorkerRequest({ method: "POST", secret: "b".repeat(64) }, d.value)).status).toBe(401);
    expect(d.runs()).toBe(0);
  });

  it("refuses a malformed secret without asking the database", async () => {
    let asked = 0;
    const d = deps({
      authorize: async () => {
        asked += 1;
        return true;
      },
    });
    for (const secret of ["short", "A".repeat(64), `${"a".repeat(63)}g`, "a".repeat(65)]) {
      expect((await handleWorkerRequest({ method: "POST", secret }, d.value)).status).toBe(401);
    }
    expect(asked).toBe(0);
  });

  it("answers 503 when the database can't check the secret", async () => {
    const d = deps({
      authorize: async () => {
        throw new Error("rpc email_outbox__authorize: 503");
      },
    });
    expect((await handleWorkerRequest({ method: "POST", secret: SECRET }, d.value)).status).toBe(503);
    expect(d.runs()).toBe(0);
  });

  it("refuses anything but POST", async () => {
    const d = deps();
    expect((await handleWorkerRequest({ method: "GET", secret: SECRET }, d.value)).status).toBe(405);
  });

  it("reports a run that throws instead of failing the request", async () => {
    const events: string[] = [];
    const d = deps({
      run: async () => {
        throw new Error("claim failed");
      },
      report: (event) => events.push(event),
    });
    expect((await handleWorkerRequest({ method: "POST", secret: SECRET }, d.value)).status).toBe(200);
    expect(events).toContain("run_failed");
  });
});
