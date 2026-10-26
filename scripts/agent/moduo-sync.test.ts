import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  apply,
  blockIdFromTitle,
  blockIdsInLog,
  connectorRpc,
  type GitHubFacts,
  type Move,
  pickBlockTask,
  planEvent,
  releaseLog,
  type Rpc,
} from "./moduo-sync";

// specs/harness-v3.md AC11 · "event → status table": each PR or tag event maps
// to exactly one status call, unmatched PRs make no call, closed-unmerged goes
// back to To do.

const URL = "https://github.com/GrochowskiMichal/Moduo/pull/657";

function prEvent(
  action: string,
  pr: Partial<{ title: string; draft: boolean; merged: boolean }>,
  extra = {},
) {
  return {
    action,
    pull_request: {
      number: 657,
      title: "[HV-7] GitHub → Moduo sync",
      draft: false,
      merged: false,
      html_url: URL,
      ...pr,
    },
    ...extra,
  };
}

const noGitHub: GitHubFacts = {
  openPrs: async () => [],
  log: () => "",
};

/** A fake connector: one task per block ID, records every write. */
function fakeModuo(
  tasks: Record<string, { handle: string; title: string; status_category: string }[]>,
) {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const rpc: Rpc = async (tool, args) => {
    if (tool === "tasks_search") return tasks[String(args.q)] ?? [];
    calls.push({ tool, args });
    return {};
  };
  return { rpc, calls };
}

const HV7 = {
  handle: "MOD-590",
  title: "HV-7 — GitHub → Moduo sync",
  status_category: "in_progress",
};

async function callsFor(name: string, event: Record<string, unknown>, gh: GitHubFacts = noGitHub) {
  const { rpc, calls } = fakeModuo({ "HV-7": [HV7] });
  await apply(await planEvent(name, event, gh), rpc);
  return calls;
}

describe("event → status table", () => {
  const table: [string, Record<string, unknown>, string][] = [
    ["draft PR opened", prEvent("opened", { draft: true }), "Building"],
    ["PR opened ready", prEvent("opened", { draft: false }), "In review"],
    ["draft PR reopened", prEvent("reopened", { draft: true }), "Building"],
    ["marked ready for review", prEvent("ready_for_review", {}), "In review"],
    ["converted back to draft", prEvent("converted_to_draft", { draft: true }), "Building"],
    ["merged", prEvent("closed", { merged: true }), "Awaiting release"],
    ["closed unmerged", prEvent("closed", { merged: false }), "To do"],
    [
      "retitled to name the block",
      prEvent("edited", { draft: true }, { changes: { title: { from: "WIP sync" } } }),
      "Building",
    ],
  ];
  for (const [what, event, status] of table) {
    it(`${what} → ${status}, one status call`, async () => {
      for (const name of ["pull_request", "pull_request_target"]) {
        const calls = await callsFor(name, event);
        const statusCalls = calls.filter((c) => c.tool === "tasks_set_status");
        expect(statusCalls).toEqual([
          { tool: "tasks_set_status", args: { task_id: "MOD-590", status } },
        ]);
      }
    });
  }

  it("closed unmerged comments on the task with the PR", async () => {
    const calls = await callsFor("pull_request_target", prEvent("closed", { merged: false }));
    expect(calls.map((c) => c.tool)).toEqual(["tasks_set_status", "comments_add"]);
    expect(calls[1]!.args).toMatchObject({ entity_type: "task", entity_id: "MOD-590" });
    expect(String(calls[1]!.args.body)).toContain(URL);
  });

  it("a release tag → Shipped for every block merged since the previous tag", async () => {
    const log = [
      "Merge pull request #657 from GrochowskiMichal/t/mike/hv-7-github-sync",
      "",
      "[HV-7] GitHub → Moduo sync",
      "Merge pull request #660 from GrochowskiMichal/mike",
      "",
      "Sync mike into develop",
      "[HV-8] Moduo is the queue (#661)",
      "Claim HV-9",
      "  [HV-6] not at the line start counts too once trimmed",
    ].join("\n");
    const gh: GitHubFacts = { openPrs: async () => [], log: () => log };
    const moves = await planEvent(
      "workflow_run",
      { workflow_run: { conclusion: "success", event: "push", head_branch: "v1.5.0" } },
      gh,
    );
    expect(moves.map((m) => [m.id, m.status])).toEqual([
      ["HV-6", "Shipped"],
      ["HV-7", "Shipped"],
      ["HV-8", "Shipped"],
    ]);
    const calls = await callsFor(
      "workflow_run",
      { workflow_run: { conclusion: "success", event: "push", head_branch: "v1.5.0" } },
      gh,
    );
    expect(calls).toEqual([
      { tool: "tasks_set_status", args: { task_id: "MOD-590", status: "Shipped" } },
    ]);
  });

  it("a release run that doesn't name its tag finds it on its commit", async () => {
    const sha = "a".repeat(40);
    const gh: GitHubFacts = {
      openPrs: async () => [],
      log: () => "[HV-7] x",
      tagsAt: (s) => (s === sha ? ["v1.5.0"] : []),
    };
    const moves = await planEvent(
      "workflow_run",
      {
        workflow_run: {
          conclusion: "success",
          event: "push",
          head_branch: "develop",
          head_sha: sha,
        },
      },
      gh,
    );
    expect(moves.map((m) => m.reason)).toEqual(["released in v1.5.0"]);
  });

  it("a hand-run release sync takes the tag as input", async () => {
    const gh: GitHubFacts = { openPrs: async () => [], log: () => "[HV-7] x" };
    const moves = await planEvent("workflow_dispatch", { inputs: { tag: "v1.5.0" } }, gh);
    expect(moves).toEqual([{ id: "HV-7", status: "Shipped", reason: "released in v1.5.0" }]);
    await expect(planEvent("workflow_dispatch", { inputs: { tag: "mike" } }, gh)).rejects.toThrow();
  });
});

describe("no call", () => {
  const none: [string, string, Record<string, unknown>][] = [
    [
      "a PR without a block ID",
      "pull_request_target",
      prEvent("opened", { title: "Bump Storybook to 10.6.2" }),
    ],
    [
      "an ID not at the start",
      "pull_request_target",
      prEvent("opened", { title: "Sync mike [HV-7]" }),
    ],
    ["a lower-case ID", "pull_request_target", prEvent("opened", { title: "[hv-7] sync" })],
    ["a new push to the PR", "pull_request_target", prEvent("synchronize", {})],
    ["an edit that keeps the title", "pull_request_target", prEvent("edited", {})],
    [
      "a retitle within the same block",
      "pull_request_target",
      prEvent("edited", {}, { changes: { title: { from: "[HV-7] old words" } } }),
    ],
    ["labels", "pull_request_target", prEvent("labeled", {})],
    [
      "a failed release run",
      "workflow_run",
      { workflow_run: { conclusion: "failure", event: "push", head_branch: "v1.5.0" } },
    ],
    [
      "a release run that isn't a tag push",
      "workflow_run",
      {
        workflow_run: { conclusion: "success", event: "workflow_dispatch", head_branch: "v1.5.0" },
      },
    ],
    [
      "a successful run on a branch",
      "workflow_run",
      { workflow_run: { conclusion: "success", event: "push", head_branch: "develop" } },
    ],
    ["another event", "push", { ref: "refs/heads/mike" }],
  ];
  for (const [what, name, event] of none) {
    it(what, async () => {
      const gh: GitHubFacts = { openPrs: async () => [], log: () => "[HV-7] x" };
      expect(await planEvent(name, event, gh)).toEqual([]);
      expect(await callsFor(name, event, gh)).toEqual([]);
    });
  }

  it("a closed PR whose block another open PR carries (a replacement)", async () => {
    const gh: GitHubFacts = {
      openPrs: async () => [
        { number: 657, title: "[HV-7] GitHub → Moduo sync" },
        { number: 670, title: "[HV-7] GitHub → Moduo sync, take two" },
      ],
      log: () => "",
    };
    expect(await callsFor("pull_request_target", prEvent("closed", { merged: false }), gh)).toEqual(
      [],
    );
  });

  it("the closed PR itself, still listed as open, doesn't count as a replacement", async () => {
    const gh: GitHubFacts = {
      openPrs: async () => [{ number: 657, title: "[HV-7] GitHub → Moduo sync" }],
      log: () => "",
    };
    const calls = await callsFor("pull_request_target", prEvent("closed", { merged: false }), gh);
    expect(calls[0]).toEqual({
      tool: "tasks_set_status",
      args: { task_id: "MOD-590", status: "To do" },
    });
  });

  it("only a closed, unmerged block PR asks GitHub for the open PRs", async () => {
    let asked = 0;
    const gh: GitHubFacts = {
      openPrs: async () => {
        asked++;
        return [];
      },
      log: () => "",
    };
    await planEvent("pull_request_target", prEvent("closed", { merged: true }), gh);
    await planEvent("pull_request_target", prEvent("closed", { title: "Bump deps" }), gh);
    await planEvent("pull_request_target", prEvent("opened", {}), gh);
    expect(asked).toBe(0);
  });
});

describe("finding the block's task", () => {
  const row = (title: string, extra = {}) => ({
    id: title,
    handle: title,
    title,
    status_category: "todo",
    ...extra,
  });

  it("takes the title rule only: '<ID> — …' or '… (<ID>)'", () => {
    const rows = [
      row("HV-70 — Something"),
      row("Variant of HV-7 work"),
      row("HV-7 — GitHub → Moduo sync"),
    ];
    expect(pickBlockTask(rows, "HV-7")).toMatchObject({ title: "HV-7 — GitHub → Moduo sync" });
    expect(pickBlockTask([row("Sync from GitHub (HV-7)")], "HV-7")).toMatchObject({
      title: "Sync from GitHub (HV-7)",
    });
  });

  it("skips archived projects, and refuses none or two", () => {
    expect(pickBlockTask([row("HV-7 — a", { project_archived: true })], "HV-7")).toBe("none");
    expect(pickBlockTask([row("HV-7 — a"), row("HV-7 — b")], "HV-7")).toBe("ambiguous");
  });

  it("never moves a done or won't-do task, nor a missing one", async () => {
    const move: Move = { id: "HV-7", status: "Building", reason: "test" };
    for (const category of ["done", "wont_do"]) {
      const { rpc, calls } = fakeModuo({ "HV-7": [{ ...HV7, status_category: category }] });
      expect((await apply([move], rpc))[0]!.result).toBe("closed");
      expect(calls).toEqual([]);
    }
    const { rpc, calls } = fakeModuo({});
    expect((await apply([move], rpc))[0]!.result).toBe("no task");
    expect(calls).toEqual([]);
  });

  it("falls back to the category word when the project lacks the stage's name", async () => {
    const calls: unknown[] = [];
    const rpc: Rpc = async (tool, args) => {
      if (tool === "tasks_search") return [HV7];
      calls.push(args.status);
      if (args.status === "Awaiting release")
        throw new Error('tasks_set_status: Unknown task status "Awaiting release".');
      return {};
    };
    await apply([{ id: "HV-7", status: "Awaiting release", reason: "merged" }], rpc);
    expect(calls).toEqual(["Awaiting release", "in_progress"]);
  });

  it("lets any other error stop the run", async () => {
    const rpc: Rpc = async (tool) => {
      if (tool === "tasks_search") return [HV7];
      throw new Error("tasks_set_status: You can't change this task.");
    };
    await expect(apply([{ id: "HV-7", status: "Building", reason: "x" }], rpc)).rejects.toThrow(
      "can't change",
    );
  });
});

describe("block IDs", () => {
  it("reads the bracketed prefix", () => {
    expect(blockIdFromTitle("[HV-7] GitHub → Moduo sync")).toBe("HV-7");
    expect(blockIdFromTitle("[TV-D16] Agent sessions")).toBe("TV-D16");
    expect(blockIdFromTitle("[CV-2-fix] Chat ops")).toBe("CV-2-fix");
    expect(blockIdFromTitle("[HV] no number")).toBeNull();
    expect(blockIdsInLog("[B-1] x\n[A-2] y\n[B-1] again")).toEqual(["A-2", "B-1"]);
  });
});

describe("the connector call", () => {
  it("posts a tools/call with the key as a bearer header and returns the tool's JSON", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { content: [{ type: "text", text: '[{"id":"x"}]' }] },
        }),
      );
    }) as unknown as typeof fetch;
    const rpc = connectorRpc("https://mcp.example.test", "key-123", fake);
    expect(await rpc("tasks_search", { q: "HV-7" })).toEqual([{ id: "x" }]);
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer key-123");
    expect(JSON.parse(String(seen!.init.body))).toMatchObject({
      method: "tools/call",
      params: { name: "tasks_search", arguments: { q: "HV-7" } },
    });
  });

  it("reads an event-stream answer and throws a tool error", async () => {
    const sse = (text: string, isError = false) =>
      (async () =>
        new Response(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { isError, content: [{ type: "text", text }] } })}\n\n`,
        )) as unknown as typeof fetch;
    expect(await connectorRpc("u", "k", sse('{"ok":true}'))("t", {})).toEqual({ ok: true });
    await expect(connectorRpc("u", "k", sse("Unknown task status", true))("t", {})).rejects.toThrow(
      "Unknown task status",
    );
  });
});

describe("releaseLog", () => {
  it("reads the messages since the previous v* tag", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "moduo-sync-"));
    try {
      const git = (...args: string[]) =>
        spawnSync("git", args, {
          cwd: dir,
          encoding: "utf8",
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "t",
            GIT_AUTHOR_EMAIL: "t@example.test",
            GIT_COMMITTER_NAME: "t",
            GIT_COMMITTER_EMAIL: "t@example.test",
          },
        });
      git("init", "-q");
      const commit = (msg: string) => {
        writeFileSync(path.join(dir, "f"), msg);
        git("add", "f");
        git("commit", "-q", "-m", msg);
      };
      commit("[OLD-1] shipped before");
      git("tag", "v1.0.0");
      commit("Merge pull request #2 from x/y\n\n[NEW-1] in this release");
      git("tag", "v1.1.0");
      expect(blockIdsInLog(releaseLog("v1.1.0", dir))).toEqual(["NEW-1"]);
      expect(blockIdsInLog(releaseLog("v1.0.0", dir))).toEqual(["OLD-1"]);
      expect(() => releaseLog("v1.1.0; rm -rf /", dir)).toThrow("Not a release tag");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
