// Moduo for Claude Code: the My tasks panel (MCC-4, read-only).
// Spec: specs/moduo-for-claude-code.md. Talks only to Moduo's connector with the person's own key.
// Every function that uses `$` is declared at the top of this file, as the engine requires.

import type { EngineInterface, Register } from "claude-code";
import { atom, read, update } from "claude-code";

import type { Bucket, Filter, PanelState, Task } from "../types";
import {
  ConnectorError,
  DEFAULT_ENDPOINT,
  PROBLEM_TEXT,
  parseAnswer,
  requestBody,
  requestHeaders,
} from "./client";
import { buildView, formatMinutes, localDate, ownerOf, resolveTimeZone } from "./model";

export const PANE = "moduo-mine";
const PANE_TITLE = "Moduo · My tasks";
const REFRESH_MS = 60_000;
const OPEN_FLAG = "paneOpen";
const OWNER_KEY = "ownerId";
/** While the pane is closed, the band still refreshes every this many ticks (5 minutes). */
const BAND_EVERY = 5;
const PAGE = 200;

const INITIAL: PanelState = {
  filter: "me",
  view: null,
  problem: null,
  ownerId: null,
  updatedAt: null,
  showDone: false,
};
const panel = atom({ plugin: "moduo-tasks", key: "panel" } as const, INITIAL);

type Config = { apiKey: string; endpoint: string; timeZone: string };
type Options = { api_key?: string; endpoint?: string; time_zone?: string };

let ticking = false;
let ticks = 0;
let seq = 0;

async function callTool<T>(
  $: EngineInterface,
  cfg: Config,
  tool: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (!cfg.apiKey) throw new ConnectorError("nokey");
  const url = cfg.endpoint || DEFAULT_ENDPOINT;
  // The key rides this request: never send it anywhere but https.
  if (!url.startsWith("https://")) throw new ConnectorError("endpoint");
  seq += 1;
  let status: number;
  let text: string;
  try {
    const res = await $.http.fetch(url, {
      method: "POST",
      headers: requestHeaders(cfg.apiKey),
      body: requestBody(seq, tool, args),
    });
    status = res.status;
    text = res.text;
  } catch {
    throw new ConnectorError("offline");
  }
  return parseAnswer<T>(status, text);
}

/** The person's user id when they have no open tasks: the store, else one of their done tasks. */
async function findOwner($: EngineInterface, cfg: Config): Promise<string | null> {
  const stored = await $.store.get(OWNER_KEY);
  if (typeof stored === "string" && stored) return stored;
  const done = await callTool<Task[]>($, cfg, "tasks_list", {
    assignee: "me",
    status: "done",
    limit: 1,
  });
  return ownerOf(done);
}

/** Every page of `tasks_list` (a short page is the last). */
async function listAll(
  $: EngineInterface,
  cfg: Config,
  args: Record<string, unknown>,
): Promise<Task[]> {
  const out: Task[] = [];
  for (let offset = 0; offset < 5000; offset += PAGE) {
    const page = await callTool<Task[]>($, cfg, "tasks_list", { ...args, limit: PAGE, offset });
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

async function refresh($: EngineInterface, cfg: Config): Promise<void> {
  const state = await read($, panel);
  try {
    const now = await $.clock.now();
    const [buckets, mine, today] = await Promise.all([
      callTool<Bucket[]>($, cfg, "tasks_list_buckets", {}),
      listAll($, cfg, { assignee: "me", top_level: true }),
      callTool<{ date: string; queue: Task[] }>($, cfg, "tasks_today", {
        date: localDate(now, cfg.timeZone),
      }),
    ]);
    const tasks =
      state.filter === "me" ? mine : await listAll($, cfg, { assignee: "anyone", top_level: true });
    const ownerId = ownerOf(mine) ?? state.ownerId ?? (await findOwner($, cfg));
    if (ownerId && ownerId !== state.ownerId) await $.store.set(OWNER_KEY, ownerId);
    const view = buildView(
      tasks,
      buckets,
      today.queue ?? [],
      state.filter,
      ownerId,
      now,
      cfg.timeZone,
    );
    // A filter switched while this refresh ran wins: its own refresh writes the view.
    await update($, panel, (s) =>
      s.filter === state.filter ? { ...s, view, ownerId, problem: null, updatedAt: now } : s,
    );
  } catch (err) {
    const problem = err instanceof ConnectorError ? err.problem : "error";
    await update($, panel, (s) => ({ ...s, problem }));
  }
}

async function tick($: EngineInterface, cfg: Config): Promise<void> {
  ticks += 1;
  const isUp = (await $.ui.panes()).some((p) => p.id === PANE);
  const { problem } = await read($, panel);
  // A rejected key stops polling until the key changes (a settings change reloads the module).
  if (problem === "rejected" || problem === "endpoint") return;
  // Open pane: every minute. Closed: every 5 minutes, so the band line stays current.
  if (isUp || ticks % BAND_EVERY === 0) await refresh($, cfg);
}

function startTicker($: EngineInterface, cfg: Config): void {
  if (ticking) return;
  ticking = true;
  $.clock.every(REFRESH_MS, () => tick($, cfg));
}

async function openPane($: EngineInterface, cfg: Config): Promise<void> {
  await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true });
  await $.store.set(OPEN_FLAG, true);
  startTicker($, cfg);
  await refresh($, cfg);
}

async function setFilter($: EngineInterface, cfg: Config, filter: Filter): Promise<void> {
  await update($, panel, (s) => ({ ...s, filter }));
  await refresh($, cfg);
}

async function toggleDone($: EngineInterface): Promise<void> {
  await update($, panel, (s) => ({ ...s, showDone: !s.showDone }));
}

export const register: Register = (on, options) => {
  const opts = (options ?? {}) as Options;
  const cfg: Config = {
    apiKey: (opts.api_key ?? "").trim(),
    endpoint: (opts.endpoint ?? "").trim(),
    timeZone: resolveTimeZone(opts.time_zone),
  };
  ticking = false;
  ticks = 0;

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "mine",
      description: "Open Moduo · My tasks (your tasks across every bucket)",
    });
    if (cfg.apiKey) {
      // With a key the band line loads at once; the pane comes back only if it was open.
      if ((await $.store.get(OPEN_FLAG)) === true) {
        void $.ui.open({ id: PANE, title: PANE_TITLE }).catch(() => undefined);
      }
      startTicker($, cfg);
      void refresh($, cfg);
    }
    return next(e);
  });

  on("command.run", { command: "mine" }, async ($) => {
    if (!cfg.apiKey) return { text: PROBLEM_TEXT.nokey };
    await openPane($, cfg);
    return { text: "Opened Moduo · My tasks." };
  });

  on("ui.close", async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === "person") {
      // Remembering the closed state must never stop the pane from closing.
      await $.store.set(OPEN_FLAG, false).catch(() => undefined);
    }
    return next(e);
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (!cfg.apiKey) return next(e);
    const { view, problem } = await read($, panel);
    if (!view && !problem) return next(e);
    const { Box, Text } = $.ui.resolve(e);
    return (
      <Box key="moduo-band">
        <Text bold>Moduo</Text>
        {problem === "offline" && <Text color="warning"> · offline</Text>}
        {view && <Text dimColor> · Queue {view.queue.length}</Text>}
        {view && view.drifting > 0 && <Text color="warning"> · {view.drifting} drifting</Text>}
      </Box>
    );
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e);
    const s = await read($, panel);
    const v = s.view;
    const stale = s.problem === "offline";
    return (
      <Box flexDirection="column" key="moduo-panel">
        <Box key="head">
          <Text bold>Moduo · My tasks</Text>
          {v && (
            <Text dimColor key="count">
              {"  "}
              {v.total} open · {v.groups.length} {v.groups.length === 1 ? "bucket" : "buckets"}
            </Text>
          )}
        </Box>
        <Box key="filters">
          <Button
            key="filter-me"
            label="Assigned to me"
            hotkey="m"
            variant={s.filter === "me" ? "primary" : "secondary"}
            onPress={() => setFilter($, cfg, "me")}
          />
          <Button
            key="filter-anyone"
            label="Everyone"
            hotkey="e"
            variant={s.filter === "anyone" ? "primary" : "secondary"}
            onPress={() => setFilter($, cfg, "anyone")}
          />
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => refresh($, cfg)} />
        </Box>
        {s.problem && (
          <Text key="problem" color={stale ? "warning" : "error"}>
            {PROBLEM_TEXT[s.problem]}
          </Text>
        )}
        {!v && !s.problem && (
          <Text key="loading" dimColor>
            Loading your tasks…
          </Text>
        )}
        {v && (
          <Box flexDirection="column" key="body">
            <Text key="queue-head" dimColor>
              TODAY'S QUEUE
              {v.plannedMinutes != null ? ` · ≈ ${formatMinutes(v.plannedMinutes)} planned` : ""}
            </Text>
            {v.queue.length === 0 && (
              <Text key="queue-empty" dimColor>
                Nothing committed for today. Press c on a task.
              </Text>
            )}
            {v.queue.map((c) => (
              <Text key={`q-${c.id}`} dimColor={stale}>
                {c.pos}. {c.title}
                {c.minutes != null ? ` · ${formatMinutes(c.minutes)}` : ""}
              </Text>
            ))}
            {v.total === 0 && s.filter === "me" && (
              <Text key="none-mine" dimColor>
                Nothing assigned to you. Everyone's tasks are one click away.
              </Text>
            )}
            {v.total === 0 && s.filter === "anyone" && (
              <Text key="none-anyone" dimColor>
                No open tasks in this workspace.
              </Text>
            )}
            {v.groups.map((g) => (
              <Box flexDirection="column" key={`g-${g.id}`}>
                <Text key="name" dimColor>
                  {g.name.toUpperCase()} {g.rows.length}
                </Text>
                {g.rows.map((r) => (
                  <Box key={`t-${r.id}`}>
                    <Text
                      dimColor={stale}
                      color={r.tone === "drift" ? "warning" : undefined}
                      wrap="truncate-end"
                    >
                      {r.tone === "drift" ? "◌" : "○"} {r.title}
                    </Text>
                    {r.meta && (
                      <Text dimColor color={r.tone === "drift" ? "warning" : undefined}>
                        {"  "}
                        {r.meta}
                      </Text>
                    )}
                    {r.subtasks > 0 && (
                      <Text dimColor>
                        {"  "}
                        {r.subtasks} {r.subtasks === 1 ? "subtask" : "subtasks"}
                      </Text>
                    )}
                    {r.queuePos != null && (
                      <Text color="suggestion">{`  Queue #${r.queuePos}`}</Text>
                    )}
                  </Box>
                ))}
              </Box>
            ))}
            <Button
              key="done-toggle"
              label={`Done today (${v.doneToday.length})${s.showDone ? " ▾" : " ▸"}`}
              hotkey="d"
              onPress={() => toggleDone($)}
            />
            {s.showDone &&
              v.doneToday.map((d) => (
                <Text key={`d-${d.id}`} dimColor strikethrough>
                  ✓ {d.title}
                </Text>
              ))}
          </Box>
        )}
      </Box>
    );
  });
};
