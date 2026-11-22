/**
 * HV-15 509-4 on the connector's engine port (recurrence.ts, a port of the
 * app's recurrence-engine.ts): rules are read in the person's zone, DTSTART
 * floated and UNTIL as written (the person's wall clock, as the picker and the
 * connector store it). Mirrors apps/app/src/features/tasks/repeat.509-4.test.ts:
 * a daily repeat "until Dec 15" ends on Dec 15 in Los Angeles and in Auckland.
 * Also: tasks_skip_occurrence computes in the zone of the person the repeat
 * rolls over for (the assignee, else the owner).
 */

import { describe, expect, it, rs } from "@rstest/core";
import * as rruleFromNpm from "rrule";

// The port loads rrule from esm.sh (Deno); here the same major version from npm.
rs.mock("https://esm.sh/rrule@2.8.1?target=deno", () => rruleFromNpm);

import { tasksConnectorModule } from "./modules/tasks.ts";
import { pointerOnStatusChange, type RecurringTaskRow, skipOccurrenceTargets } from "./recurrence.ts";
import type { KeyContext, ToolContext } from "./registry.ts";

type Row = Record<string, unknown>;

const UNTIL_DEC_15 = "FREQ=DAILY;INTERVAL=1;UNTIL=20261215T235959Z";

const row = (dtstart: string, scheduledAt: string, extra: Partial<RecurringTaskRow> = {}): RecurringTaskRow => ({
  status: "todo",
  scheduled_at: scheduledAt,
  committed_for: null,
  created_at: dtstart,
  recurrence: { rrule: UNTIL_DEC_15, dtstart, nextOccurrence: null },
  ...extra,
});

describe("the port reads a repeat's end as the person's local day", () => {
  it("Los Angeles: a 6 PM daily repeat 'until Dec 15' still comes on Dec 15, then ends", () => {
    const zone = "America/Los_Angeles";
    // Dec 12, 18:00 PST; the current occurrence is Dec 14, 18:00 PST.
    const task = row("2026-12-13T02:00:00.000Z", "2026-12-15T02:00:00.000Z");
    const skip = skipOccurrenceTargets(task, new Date("2026-12-15T03:00:00Z"), zone);
    expect(skip?.scheduledAt).toBe("2026-12-16T02:00:00.000Z"); // Dec 15, 18:00 PST
    expect(skip?.recurrence.nextOccurrence).toBeNull();
    // From Dec 15's occurrence there is nothing left.
    const last = row("2026-12-13T02:00:00.000Z", "2026-12-16T02:00:00.000Z");
    expect(skipOccurrenceTargets(last, new Date("2026-12-16T03:00:00Z"), zone)).toBeNull();
  });

  it("Auckland: a 9 AM daily repeat 'until Dec 15' does not come back on Dec 16", () => {
    const zone = "Pacific/Auckland";
    // Dec 12, 09:00 NZDT; the current occurrence is Dec 15, 09:00 NZDT.
    const task = row("2026-12-11T20:00:00.000Z", "2026-12-14T20:00:00.000Z");
    expect(skipOccurrenceTargets(task, new Date("2026-12-14T21:00:00Z"), zone)).toBeNull();
    const done = pointerOnStatusChange(task, "done", new Date("2026-12-14T21:00:00Z"), zone);
    expect(done?.nextOccurrence).toBeNull();
    // From Dec 14 the next is Dec 15 09:00 NZDT, and then nothing.
    const before = row("2026-12-11T20:00:00.000Z", "2026-12-13T20:00:00.000Z");
    const skip = skipOccurrenceTargets(before, new Date("2026-12-13T21:00:00Z"), zone);
    expect(skip?.scheduledAt).toBe("2026-12-14T20:00:00.000Z");
    expect(skip?.recurrence.nextOccurrence).toBeNull();
  });

  it("a 9:00 repeat stays at 9:00 across a clock change (Warsaw, Oct 25)", () => {
    const task: RecurringTaskRow = {
      ...row("2026-10-19T07:00:00.000Z", "2026-10-19T07:00:00.000Z"),
      recurrence: { rrule: "FREQ=WEEKLY;BYDAY=MO", dtstart: "2026-10-19T07:00:00.000Z", nextOccurrence: null },
    };
    const skip = skipOccurrenceTargets(task, new Date("2026-10-19T08:00:00Z"), "Europe/Warsaw");
    expect(skip?.scheduledAt).toBe("2026-10-26T08:00:00.000Z");
  });

  it("releases today's commit by the person's day, not the UTC day", () => {
    // 19:00 on Dec 14 in Los Angeles is already Dec 15 in UTC.
    const task = row("2026-12-13T02:00:00.000Z", "2026-12-15T02:00:00.000Z", { committed_for: "2026-12-14" });
    const skip = skipOccurrenceTargets(task, new Date("2026-12-15T03:00:00Z"), "America/Los_Angeles");
    expect(skip?.releaseCommit).toBe(true);
  });

  it("without a zone it is UTC, as before", () => {
    const task: RecurringTaskRow = {
      ...row("2026-10-19T07:00:00.000Z", "2026-10-19T07:00:00.000Z"),
      recurrence: { rrule: "FREQ=WEEKLY;BYDAY=MO", dtstart: "2026-10-19T07:00:00.000Z", nextOccurrence: null },
    };
    expect(skipOccurrenceTargets(task, new Date("2026-10-19T08:00:00Z"))?.scheduledAt).toBe(
      "2026-10-26T07:00:00.000Z",
    );
  });
});

describe("tasks_skip_occurrence computes in the zone of the person it repeats for", () => {
  const WS = "11111111-1111-4111-8111-111111111111";
  const ME = "22222222-2222-4222-8222-222222222222";
  const BEA = "33333333-3333-4333-8333-333333333333";
  const TASK = "44444444-4444-4444-8444-444444444444";

  /** A permissive stand-in for supabase-js: table reads filtered by eq, RPCs by name. */
  function fakeCtx(tables: Record<string, Row[]>, rpcs: Record<string, (a: Row) => unknown>) {
    const rpcCalls: Array<{ fn: string; args: Row }> = [];
    const from = (table: string) => {
      const eqs: Array<[string, unknown]> = [];
      const result = () => (tables[table] ?? []).filter((r) => eqs.every(([c, v]) => r[c] === v));
      const q: Record<string, unknown> = {};
      for (const m of ["select", "neq", "in", "or", "order", "limit", "range", "not", "filter", "contains"]) {
        q[m] = () => q;
      }
      q.eq = (c: string, v: unknown) => (eqs.push([c, v]), q);
      q.is = (c: string, v: unknown) => (eqs.push([c, v]), q);
      q.maybeSingle = async () => ({ data: result()[0] ?? null, error: null });
      q.single = async () => ({ data: result()[0] ?? null, error: null });
      q.then = (resolve: (r: { data: Row[]; error: null }) => unknown) =>
        Promise.resolve({ data: result(), error: null }).then(resolve);
      return q;
    };
    const rpc = async (fn: string, args: Row) => {
      rpcCalls.push({ fn, args });
      const answer = rpcs[fn];
      return { data: answer ? answer(args) : [], error: null };
    };
    const key: KeyContext = { id: "key-1", workspaceId: WS, name: "Claude", createdBy: ME, scopes: { tasks: "edit" } };
    return { ctx: { key, db: { from, rpc } as unknown as ToolContext["db"] } as ToolContext, rpcCalls };
  }

  const tool = (name: string) => tasksConnectorModule.tools.find((t) => t.name === name)!;

  it("Auckland assignee: nothing to skip to past Dec 15 (the UTC reading offered Dec 16)", async () => {
    const task = {
      id: TASK,
      workspace_id: WS,
      owner_id: ME,
      assignee_id: BEA,
      status: "todo",
      deleted_at: null,
      created_at: "2026-12-11T20:00:00.000Z",
      scheduled_at: "2026-12-14T20:00:00.000Z",
      committed_for: null,
      recurrence: { rrule: UNTIL_DEC_15, dtstart: "2026-12-11T20:00:00.000Z", nextOccurrence: null },
    };
    const { ctx, rpcCalls } = fakeCtx(
      {
        tasks: [task],
        user_preferences: [
          { user_id: ME, time_zone: "America/Los_Angeles" },
          { user_id: BEA, time_zone: "Pacific/Auckland" },
        ],
      },
      { share_visible_ids: () => [TASK] },
    );
    // Dec 15, 10:00 in Auckland.
    rs.useFakeTimers();
    rs.setSystemTime(new Date("2026-12-14T21:00:00Z"));
    try {
      await expect(tool("tasks_skip_occurrence").handler({ task_id: TASK }, ctx)).rejects.toThrow(/Nothing to skip/);
      expect(rpcCalls.some((c) => c.fn === "tasks_op_skip_occurrence")).toBe(false);
    } finally {
      rs.useRealTimers();
    }
  });

  it("Los Angeles owner (no assignee): skips to Dec 15's evening", async () => {
    const task = {
      id: TASK,
      workspace_id: WS,
      owner_id: ME,
      assignee_id: null,
      status: "todo",
      deleted_at: null,
      created_at: "2026-12-13T02:00:00.000Z",
      scheduled_at: "2026-12-15T02:00:00.000Z",
      committed_for: null,
      recurrence: { rrule: UNTIL_DEC_15, dtstart: "2026-12-13T02:00:00.000Z", nextOccurrence: null },
    };
    const { ctx, rpcCalls } = fakeCtx(
      { tasks: [task], user_preferences: [{ user_id: ME, time_zone: "America/Los_Angeles" }] },
      { share_visible_ids: () => [TASK], tasks_op_skip_occurrence: () => [task] },
    );
    rs.useFakeTimers();
    rs.setSystemTime(new Date("2026-12-15T03:00:00Z"));
    try {
      // The answer's shaping reads more than this stand-in holds; the op call is what counts.
      await tool("tasks_skip_occurrence").handler({ task_id: TASK }, ctx).catch(() => null);
    } finally {
      rs.useRealTimers();
    }
    const call = rpcCalls.find((c) => c.fn === "tasks_op_skip_occurrence");
    expect(call?.args.p_scheduled_at).toBe("2026-12-16T02:00:00.000Z");
  });
});
