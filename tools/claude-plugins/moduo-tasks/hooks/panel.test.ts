import type { On } from "claude-code";
import { describe, expect, mock, test } from "claude-code/testing";

const ME = "u-mike";
const NOW = Date.UTC(2026, 9, 7, 22, 30); // 00:30 on 8 October in Warsaw
const DAY = 86_400_000;

const BUCKETS = [
  { id: "b-inbox", name: "Inbox", is_system: true },
  { id: "b-build", name: "Build" },
  { id: "b-setup", name: "Setup" },
];
const MINE = [
  {
    id: "t1",
    title: "MCP-1 · Connector hardening",
    bucket_id: "b-build",
    status: "in_progress",
    assignee_id: ME,
    duration_minutes: 120,
    committed_for: "2026-10-08",
    commit_order: 1,
  },
  {
    id: "t2",
    title: "Tasks · Recurring tasks",
    bucket_id: "b-build",
    status: "todo",
    assignee_id: ME,
    subtask_count: 3,
    blocked: true,
    recurrence: { rrule: "FREQ=WEEKLY" },
  },
  {
    id: "t3",
    title: "Install the Claude GitHub App",
    bucket_id: "b-setup",
    status: "todo",
    assignee_id: ME,
    drifted: true,
    scheduled_at: new Date(NOW - 2 * DAY - 3600_000).toISOString(),
  },
];
const THEIRS = [
  {
    id: "t4",
    title: "Privacy policy copy",
    bucket_id: "b-inbox",
    status: "todo",
    assignee_id: "u-maciej",
    committed_for: "2026-10-08",
    commit_order: 2,
  },
];
const QUEUE = [
  {
    id: "t5",
    title: "Landing · pricing copy",
    bucket_id: "b-build",
    status: "done",
    assignee_id: ME,
    committed_for: "2026-10-08",
    commit_order: 0,
  },
  MINE[0],
  THEIRS[0],
];

type Calls = { tools: string[]; dates: string[]; auth: string[] };

/** A fake moduo-mcp: answers tools/call by tool name, records what it was asked. */
function fakeModuo(on: On, calls: Calls, mode: "ok" | "offline" | "nomine" | "rejected" = "ok") {
  on("http.fetch", (_$, e) => {
    if (mode === "offline") throw new Error("network down");
    if (mode === "rejected") {
      calls.tools.push("rejected");
      return { value: { status: 401, ok: false, headers: {}, text: "Unauthorized" } } as never;
    }
    const req = JSON.parse(e.init?.body ?? "{}") as {
      id: number;
      params: { name: string; arguments: Record<string, unknown> };
    };
    const { name, arguments: args } = req.params;
    calls.tools.push(name);
    calls.auth.push(e.init?.headers?.Authorization ?? "");
    let payload: unknown = null;
    if (name === "tasks_list_buckets") payload = BUCKETS;
    if (name === "tasks_list") {
      const mine = mode === "nomine" ? [] : MINE;
      payload = args.status === "done" ? [] : args.assignee === "me" ? mine : [...mine, ...THEIRS];
    }
    if (name === "tasks_today") {
      calls.dates.push(String(args.date));
      payload = { date: args.date, queue: QUEUE };
    }
    const text = JSON.stringify({
      jsonrpc: "2.0",
      id: req.id,
      result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
    });
    return { value: { status: 200, ok: true, headers: {}, text } } as never;
  });
}

/** Stands in for Claude Code's pane host: open, list and close. */
function fakePanes(on: On): Set<string> {
  const open = new Set<string>();
  on("ui.open", (_$, e) => {
    open.add(e.id);
    return { value: { isPlaced: true } } as never;
  });
  on("ui.close", (_$, e) => {
    open.delete(e.id);
    return { value: undefined } as never;
  });
  on(
    "ui.panes",
    () =>
      ({
        value: [...open].map((id) => ({
          id,
          title: id,
          isShown: true,
          isFocused: false,
          isPlaced: true,
        })),
      }) as never,
  );
  return open;
}

const OPTIONS = { options: { api_key: "moduo_sk_test", time_zone: "Europe/Warsaw" } };
const PANE_PROPS = {
  title: "Moduo · My tasks",
  isFocused: true,
  bodyColumns: 90,
  placement: "dock",
} as never;

function texts(found: { text: string }[] | undefined): string {
  return (found ?? []).map((f) => f.text).join("\n");
}

describe("My tasks panel", () => {
  test("groups and renders my tasks", OPTIONS, async ($, on) => {
    const calls: Calls = { tools: [], dates: [], auth: [] };
    mock.clock(on, { now: NOW });
    mock.store(on);
    fakePanes(on);
    fakeModuo(on, calls);

    const opened = await $.command.run({ command: "mine", args: "" } as never);
    expect(opened.text).toContain("Opened Moduo · My tasks");

    for (const surface of ["terminal", "desktop"] as const) {
      const ui = await $.ui.mount({
        plugin: "moduo-tasks",
        surface,
        component: "Pane",
        requestId: "moduo-mine",
        props: PANE_PROPS,
      } as never);
      const all = texts(await ui.findAll({ type: "Text" }));
      expect(all).toContain("BUILD 2");
      expect(all.indexOf("BUILD 2")).toBeLessThan(all.indexOf("SETUP 1"));
      expect(all).toContain("blocked · repeats");
      expect(all).toContain("SETUP 1");
      expect(all).not.toContain("INBOX");
      // Scheduled 23:30 on 5 October Warsaw time, now 00:30 on 8 October: 3 local calendar days.
      expect(all).toContain("drifting 3 days");
      expect(all).toContain("3 subtasks");
      expect(all).toContain("Queue #1");
      expect(all).toContain("1. MCP-1 · Connector hardening · 2 h");
      expect(all).not.toContain("Privacy policy copy");
      expect((await ui.find({ key: "done-toggle" }))?.text ?? "").toContain("Done today (1)");

      await ui.press({ key: "filter-anyone" });
      const everyone = texts(await ui.findAll({ type: "Text" }));
      expect(everyone).toContain("INBOX 1");
      expect(everyone.indexOf("INBOX 1")).toBeLessThan(everyone.indexOf("BUILD 2"));
      expect(everyone).toContain("Privacy policy copy");
      expect(everyone).toContain("2. Privacy policy copy");
      await ui.press({ key: "filter-me" });
      await ui.unmount();
    }
    // Every date sent is the Warsaw day; the key only ever rides the header.
    expect(new Set(calls.dates)).toEqual(new Set(["2026-10-08"]));
    expect(calls.auth.every((a) => a === "Bearer moduo_sk_test")).toBe(true);
  });

  test("refreshes on a 60 s clock", OPTIONS, async ($, on) => {
    const calls: Calls = { tools: [], dates: [], auth: [] };
    const clock = mock.clock(on, { now: NOW });
    mock.store(on);
    const panes = fakePanes(on);
    fakeModuo(on, calls);

    await $.command.run({ command: "mine", args: "" } as never);
    const before = calls.tools.filter((t) => t === "tasks_list_buckets").length;
    await clock.advance(60_000);
    const after = calls.tools.filter((t) => t === "tasks_list_buckets").length;
    expect(after).toBe(before + 1);

    panes.delete("moduo-mine"); // the person closed it
    await clock.advance(60_000);
    expect(calls.tools.filter((t) => t === "tasks_list_buckets").length).toBe(after);
  });

  test("shows offline and keeps quiet about the key", OPTIONS, async ($, on) => {
    const calls: Calls = { tools: [], dates: [], auth: [] };
    mock.clock(on, { now: NOW });
    mock.store(on);
    fakePanes(on);
    fakeModuo(on, calls, "offline");

    await $.command.run({ command: "mine", args: "" } as never);
    const ui = await $.ui.mount({
      plugin: "moduo-tasks",
      surface: "terminal",
      component: "Pane",
      requestId: "moduo-mine",
      props: PANE_PROPS,
    } as never);
    const all = texts(await ui.findAll({ type: "Text" }));
    expect(all).toContain("Offline · retrying");
    expect(all).not.toContain("moduo_sk_test");
  });
});

describe("band and reopen", () => {
  test("band shows the queue and drift; the panel reopens next session", OPTIONS, async ($, on) => {
    const calls: Calls = { tools: [], dates: [], auth: [] };
    mock.clock(on, { now: NOW });
    mock.store(on, { paneOpen: true });
    const panes = fakePanes(on);
    fakeModuo(on, calls);
    on("command.register", () => ({ value: undefined }) as never);
    on("session.start", (_$, e) => ({ cwd: e.cwd }) as never);

    await $.session.start({ cwd: "/repo", surface: "terminal" } as never);
    expect(panes.has("moduo-mine")).toBe(true);
    await $.command.run({ command: "mine", args: "" } as never);

    const band = await $.ui.mount({
      plugin: "moduo-tasks",
      surface: "terminal",
      component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 90 } as never,
    } as never);
    const line = texts(await band.findAll({ type: "Text" }));
    expect(line).toContain("Queue 1");
    expect(line).toContain("1 drifting");
  });
});

describe("edge cases", () => {
  test(
    "no open tasks of mine: no one else's queue under Assigned to me",
    OPTIONS,
    async ($, on) => {
      const calls: Calls = { tools: [], dates: [], auth: [] };
      mock.clock(on, { now: NOW });
      mock.store(on);
      fakePanes(on);
      fakeModuo(on, calls, "nomine");

      await $.command.run({ command: "mine", args: "" } as never);
      const ui = await $.ui.mount({
        plugin: "moduo-tasks",
        surface: "terminal",
        component: "Pane",
        requestId: "moduo-mine",
        props: PANE_PROPS,
      } as never);
      const all = texts(await ui.findAll({ type: "Text" }));
      expect(all).toContain("Nothing assigned to you");
      expect(all).toContain("Nothing committed for today");
      expect(all).not.toContain("Privacy policy copy");
    },
  );

  test("a rejected key says so and stops polling", OPTIONS, async ($, on) => {
    const calls: Calls = { tools: [], dates: [], auth: [] };
    const clock = mock.clock(on, { now: NOW });
    mock.store(on);
    fakePanes(on);
    fakeModuo(on, calls, "rejected");

    await $.command.run({ command: "mine", args: "" } as never);
    const ui = await $.ui.mount({
      plugin: "moduo-tasks",
      surface: "terminal",
      component: "Pane",
      requestId: "moduo-mine",
      props: PANE_PROPS,
    } as never);
    expect(texts(await ui.findAll({ type: "Text" }))).toContain("Moduo rejected the key");
    const before = calls.tools.length;
    await clock.advance(5 * 60_000);
    expect(calls.tools.length).toBe(before);
  });
});

describe("without a key", () => {
  test("silent without a key", async ($, on) => {
    const calls: Calls = { tools: [], dates: [], auth: [] };
    mock.clock(on, { now: NOW });
    mock.store(on);
    fakePanes(on);
    fakeModuo(on, calls);

    // Stands in for the engine's own band: an empty Box the plugin passes through to.
    on("ui.render", ($, e) => {
      const { Box } = $.ui.resolve(e);
      return h(Box, { key: "engine-band" }) as never;
    });
    const answer = await $.command.run({ command: "mine", args: "" } as never);
    expect(answer.text).toContain("Add your Moduo API key");
    const band = await $.ui.mount({
      plugin: "moduo-tasks",
      surface: "terminal",
      component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 90 } as never,
    } as never);
    expect(texts(await band.findAll({ type: "Text" }))).not.toContain("Moduo");
    expect(calls.tools).toEqual([]);
  });
});
