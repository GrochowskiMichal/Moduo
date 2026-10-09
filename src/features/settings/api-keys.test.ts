import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MCP_TOOL_NEEDS, mcpToolNeeds } from "@contracts/mcp-key-scopes";
import { normalizeMcpKeyScope, type PermissionKey } from "@contracts/vocabularies";
import { describe, expect, it } from "@rstest/core";

import { moduleManifests } from "../../lib/module-registry";
import {
  ceilingHint,
  clampScopes,
  DEFAULT_KEY_EXPIRY,
  DEFAULT_KEY_SCOPES,
  effectiveScopes,
  expiryDays,
  grantsAnyAccess,
  KEY_EXPIRY_OPTIONS,
  KEY_SCOPE_LABELS,
  KEY_SCOPE_MODULES,
  KEY_SCOPE_NEEDS,
  type KeyActor,
  keyLifecycle,
  keyScopeCap,
  MCP_KEY_MODULES,
  MCP_KEY_SCOPES,
  type McpKeyScopes,
  sameScopes,
  scopeCeiling,
  scopeDependencyNotes,
  scopeSummary,
  scopesPayload,
  toKeyScopes,
} from "./api-keys";

const MODULE_IDS = KEY_SCOPE_MODULES.map(({ module }) => module);

const scopes = (overrides: Partial<McpKeyScopes>): McpKeyScopes => ({
  tasks: "none",
  notes: "none",
  calendar: "none",
  email: "none",
  contacts: "none",
  chat: "none",
  links: "none",
  ...overrides,
});

// ── connector + SQL readers (the connector is Deno code: read it as text) ────

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CONNECTOR_DIR = resolve(REPO, "supabase/functions/moduo-mcp");

type ToolSpan = { name: string; access: "view" | "edit"; source: string };
type ConnectorFile = {
  file: string;
  id: string | undefined;
  /** Everything before the first tool: shared helpers. */
  preamble: string;
  tools: ToolSpan[];
};

function connectorModuleSources(): ConnectorFile[] {
  const registry = readFileSync(resolve(CONNECTOR_DIR, "registry.ts"), "utf8");
  const files = [...registry.matchAll(/from "\.\/(modules\/[a-z_]+\.ts)"/g)].map((m) => m[1]);
  return files.map((file) => {
    const source = readFileSync(resolve(CONNECTOR_DIR, file), "utf8");
    const id = source.match(/^\s*module: "([a-z_]+)",$/m)?.[1];
    // Each tool runs from its `name:` to the next tool's (or the file's end).
    const starts = [...source.matchAll(/^\s{6}name: "([a-z0-9_]+)",$/gm)];
    const tools = starts.map((m, i) => {
      const span = source.slice(m.index, starts[i + 1]?.index ?? source.length);
      const access = span.match(/access: "(view|edit)"/)?.[1] as "view" | "edit" | undefined;
      if (!access) throw new Error(`${file}: tool ${m[1]} has no access level`);
      return { name: m[1], access, source: span };
    });
    return { file, id, preamble: source.slice(0, starts[0]?.index ?? source.length), tools };
  });
}

const RPC_CALL = /(?:callOp\(ctx,\s*|\.rpc\(\s*)"(\w+)"/g;

/**
 * The newest body of every public SQL function: migrations replayed in
 * filename order, `--` comments stripped first (so a commented-out definition
 * can't capture the next body), names matched case-insensitively.
 */
function latestSqlFunctionBodies(): Map<string, string> {
  const dir = resolve(REPO, "supabase/migrations");
  const bodies = new Map<string, string>();
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(resolve(dir, file), "utf8").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(/gi,
    )) {
      const rest = sql.slice((m.index ?? 0) + m[0].length);
      const tag = rest.match(/\bas\s+(\$\w*\$)/i);
      if (!tag || tag.index === undefined) continue;
      const start = tag.index + tag[0].length;
      bodies.set(m[1].toLowerCase(), rest.slice(start, rest.indexOf(tag[1], start)));
    }
  }
  return bodies;
}

const PEOPLE_ONLY =
  /if\s+(?:public\.)?module_api_key_id\(\)\s+is\s+null\s+then([\s\S]*?)end\s+if\s*;/g;
const LANE_CHECK = /\b(\w+?)_(?:op__guard\w*|module_permission|key_scope)\s*\(/g;

/**
 * The key-scope lanes a call into `fn` is checked against, following its calls:
 * `<module>_op__guard*`, inline `<module>_module_permission(…)` and
 * `<module>_key_scope(…)` (spine = Links). Those are leaves: their insides
 * resolve a lane, they don't add one. Blocks under `IF module_api_key_id() IS
 * NULL` are people-only, so keys never reach them (such a block must be a plain
 * IF). An auth.uid()-only `*_can_access_workspace` check refuses every key; it
 * comes back as "no-key". Not caught: bare auth.uid() comparisons, and NOT
 * NULL writes of auth.uid() (the keyed round-trip in docs/testing caught six).
 */
function keyLanes(fn: string, bodies: Map<string, string>, seen = new Set<string>()): Set<string> {
  const lanes = new Set<string>();
  const raw = bodies.get(fn);
  if (raw === undefined || seen.has(fn)) return lanes;
  seen.add(fn);
  const body = raw.toLowerCase().replace(PEOPLE_ONLY, (_block, inner: string) => {
    expect(inner, `${fn}: a people-only block must be a plain IF`).not.toMatch(
      /\b(?:else|elsif|if)\b/,
    );
    return "";
  });
  for (const [, owner] of body.matchAll(LANE_CHECK)) lanes.add(owner === "spine" ? "links" : owner);
  if (/\b\w+_can_access_workspace\s*\(/.test(body)) lanes.add("no-key");
  for (const [, callee] of body.matchAll(/\b(\w+)\s*\(/g)) {
    if (callee === fn || !bodies.has(callee)) continue;
    if (callee.endsWith("_module_permission") || callee.endsWith("_key_scope")) continue;
    for (const lane of keyLanes(callee, bodies, seen)) lanes.add(lane);
  }
  return lanes;
}

// ── vocabulary + rows ────────────────────────────────────────────────────────

describe("key-scope vocabulary", () => {
  it("is none / view / edit, and admin is never key-grantable", () => {
    expect([...MCP_KEY_SCOPES]).toEqual(["none", "view", "edit"]);
    expect(MCP_KEY_SCOPES).not.toContain("admin");
  });

  it("labels the levels plainly (the landing's key card shows these words)", () => {
    expect(MCP_KEY_SCOPES.map((level) => KEY_SCOPE_LABELS[level])).toEqual([
      "None",
      "View",
      "Edit",
    ]);
  });
});

describe("key-scope modules", () => {
  it("lists every module in key-card order with plain labels", () => {
    expect(KEY_SCOPE_MODULES.map(({ module, label }) => [module, label])).toEqual([
      ["tasks", "Tasks"],
      ["notes", "Notes"],
      ["calendar", "Calendar"],
      ["email", "Email"],
      ["contacts", "Contacts"],
      ["chat", "Chat"],
      ["links", "Links"],
    ]);
    expect(MODULE_IDS).toEqual([...MCP_KEY_MODULES]);
  });

  it("covers exactly the app's module registry (a new module needs a row)", () => {
    expect([...MODULE_IDS].sort()).toEqual(moduleManifests.map((m) => m.module).sort());
  });

  it("covers exactly the modules the MCP connector registers", () => {
    const modules = connectorModuleSources();
    expect(modules.length).toBeGreaterThan(0);
    for (const { file, id } of modules) expect(id, `no module id in ${file}`).toBeTruthy();
    expect(modules.map(({ id }) => id).sort()).toEqual([...MODULE_IDS].sort());
  });

  it("matches the CHECK the scopes column carries (workspace_api_key_scopes_valid)", () => {
    const sql = readFileSync(
      resolve(REPO, "supabase/migrations/20261008120000_workspace_api_keys_set_scopes.sql"),
      "utf8",
    );
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    expect(sql).toContain(`e.key NOT IN (${inList(MCP_KEY_MODULES)})`);
    expect(sql).toContain(`NOT IN (${inList(MCP_KEY_SCOPES)})`);
    expect(sql).toContain(`v_scope.key NOT IN (${inList(MCP_KEY_MODULES)})`);
  });
});

describe("cross-module needs: the connector, the SQL and the key card agree", () => {
  it("every listed need names a real connector tool, on its module and level", () => {
    const tools = new Map(
      connectorModuleSources().flatMap(({ id, tools: spans }) =>
        spans.map((t) => [t.name, { module: id, access: t.access }] as const),
      ),
    );
    for (const need of MCP_TOOL_NEEDS) {
      expect(tools.get(need.tool), need.tool).toEqual({ module: need.module, access: need.access });
    }
  });

  it("matches the server: every lane a tool's RPCs check beyond its own module, and nothing else", () => {
    // Walk each connector tool's RPCs (`callOp(ctx, "…")` / `.rpc("…")`) through
    // the latest SQL to the key-scope checks they hit. A tool's own module at
    // Edit is what its row grants; any other module must be in MCP_TOOL_NEEDS,
    // and a stale entry fails too. This is the check that caught the contacts /
    // calendar / email deletes re-guarding through Links, and links_suggest
    // sitting behind the Links Edit guard while listed at View.
    const bodies = latestSqlFunctionBodies();
    expect(bodies.size).toBeGreaterThan(50);
    for (const { file, id, preamble, tools } of connectorModuleSources()) {
      for (const tool of tools) {
        const lanes = new Set<string>();
        for (const m of tool.source.matchAll(RPC_CALL)) {
          const rpc = m[1];
          expect(bodies.has(rpc), `${file} calls ${rpc}, which no migration defines`).toBe(true);
          for (const lane of keyLanes(rpc, bodies)) lanes.add(lane);
        }
        expect(lanes.has("no-key"), `${tool.name} has an auth.uid()-only check`).toBe(false);
        if (lanes.has(id ?? "") && tool.access === "view") {
          throw new Error(`${tool.name} is listed at View but its RPC needs ${id} Edit`);
        }
        const needs = [...lanes].filter((lane) => lane !== id).sort();
        expect(needs, `${file}: ${tool.name}`).toEqual([...mcpToolNeeds(tool.name)].sort());
      }
      // Helpers above the tools (chat's plan check) must not hit a key lane.
      for (const m of preamble.matchAll(RPC_CALL)) {
        expect([...keyLanes(m[1], bodies)], `${file}: helper call to ${m[1]}`).toEqual([]);
      }
    }
  });

  it("never stamps auth.uid() where a key calls: rows a key makes belong to its creator", () => {
    // Under a key auth.uid() is NULL (the connector calls as service_role), so an
    // op that writes it into a creator / owner column breaks: NOT NULL columns
    // refuse the write, nullable ones leave a row nobody can open. Six ops did
    // until 20261008123000. Ops use perm_actor_id() (the user, or the key's
    // creator). The people-only reads below are the legitimate ones.
    const PEOPLE_BRANCH = new Set([
      "perm_actor_id", // defines the fallback itself
      "module_activity_log", // `IF auth.uid() IS NOT NULL` → the user branch; keys go to the api_key branch
      "perm_can_view_entity", // reached only for types without a module (true for everyone)
    ]);
    const bodies = latestSqlFunctionBodies();
    const roots = new Set<string>();
    const shared = readFileSync(resolve(CONNECTOR_DIR, "share.ts"), "utf8");
    for (const m of shared.matchAll(RPC_CALL)) roots.add(m[1]);
    for (const { preamble, tools } of connectorModuleSources()) {
      for (const m of preamble.matchAll(RPC_CALL)) roots.add(m[1]);
      for (const tool of tools) for (const m of tool.source.matchAll(RPC_CALL)) roots.add(m[1]);
    }
    const reached = new Set<string>();
    const walk = (fn: string) => {
      const body = bodies.get(fn);
      if (body === undefined || reached.has(fn)) return;
      reached.add(fn);
      for (const [, callee] of body.toLowerCase().matchAll(/\b(\w+)\s*\(/g)) walk(callee);
    };
    for (const rpc of roots) walk(rpc);
    expect(reached.size).toBeGreaterThan(40);
    const offenders = [...reached].filter(
      (fn) =>
        /auth\.uid\(\)/i.test(bodies.get(fn) ?? "") &&
        !PEOPLE_BRANCH.has(fn) &&
        // <module>_module_permission: the key branch returns first; the rest is people.
        !fn.endsWith("_module_permission"),
    );
    expect(offenders).toEqual([]);
  });

  it("gives every need a row note, and the notes come from the needs", () => {
    expect(
      KEY_SCOPE_NEEDS.map(({ module, when, needs }) => `${module}@${when}>${needs}`).sort(),
    ).toEqual(["calendar@edit>tasks", "notes@edit>links"]);
    for (const need of KEY_SCOPE_NEEDS) expect(need.note.length).toBeGreaterThan(0);
  });
});

describe("scopeDependencyNotes: tools that need another module", () => {
  it("flags Calendar edit without Tasks edit (its task-block tools move the task)", () => {
    expect(scopeDependencyNotes(scopes({ calendar: "edit" }))).toEqual({
      calendar: "Moving scheduled tasks also needs Tasks: Edit.",
    });
    expect(scopeDependencyNotes(scopes({ calendar: "edit", tasks: "view" }))).toHaveProperty(
      "calendar",
    );
  });

  it("flags Notes edit without Links edit (notes_link is a Links op)", () => {
    expect(scopeDependencyNotes(scopes({ notes: "edit", links: "view" }))).toEqual({
      notes: "Linking notes also needs Links: Edit.",
    });
  });

  it("stays quiet once the other module is at Edit, or below the level that lists the tool", () => {
    expect(
      scopeDependencyNotes(
        scopes({ calendar: "edit", tasks: "edit", notes: "edit", links: "edit" }),
      ),
    ).toEqual({});
    expect(scopeDependencyNotes(scopes({ calendar: "view", notes: "view" }))).toEqual({});
    expect(scopeDependencyNotes(scopes({ links: "view" }))).toEqual({});
    expect(scopeDependencyNotes(DEFAULT_KEY_SCOPES)).toEqual({});
  });
});

describe("scopesPayload: what create / set-scopes send as p_scopes", () => {
  it("sends the new-key default as read-only Tasks with every other module explicitly none", () => {
    expect(JSON.stringify(scopesPayload(DEFAULT_KEY_SCOPES))).toBe(
      '{"tasks":"view","notes":"none","calendar":"none","email":"none","contacts":"none","chat":"none","links":"none"}',
    );
  });

  it("spells out every module, even from a sparse map", () => {
    const payload = scopesPayload({ notes: "edit" });
    expect(Object.keys(payload)).toEqual(MODULE_IDS);
    expect(payload).toEqual(scopes({ notes: "edit" }));
  });

  it("carries a mixed per-module choice through unchanged", () => {
    const choice = scopes({ tasks: "edit", notes: "view", calendar: "edit", chat: "view" });
    expect(scopesPayload(choice)).toEqual(choice);
  });

  it("never sends admin, or anything outside none / view / edit", () => {
    const payload = scopesPayload({
      tasks: "admin",
      notes: "ADMIN",
      contacts: "write",
      calendar: null,
      email: 2,
      links: { level: "edit" },
    });
    expect(payload).toEqual(scopes({}));
    for (const level of Object.values(payload)) expect(MCP_KEY_SCOPES).toContain(level);
  });

  it("tidies case and whitespace instead of dropping a real grant", () => {
    expect(scopesPayload({ tasks: "Edit", email: " view " })).toEqual(
      scopes({ tasks: "edit", email: "view" }),
    );
  });

  it("drops modules it doesn't know", () => {
    const payload = scopesPayload({ tasks: "view", finance: "edit", dashboard: "view" });
    expect(Object.keys(payload)).toEqual(MODULE_IDS);
    expect(payload).not.toHaveProperty("finance");
  });

  it("returns a fresh object and leaves its input alone", () => {
    const input = { tasks: "edit", notes: "admin" };
    const payload = scopesPayload(input);
    expect(payload).not.toBe(input);
    expect(input).toEqual({ tasks: "edit", notes: "admin" });
  });
});

describe("toKeyScopes: reading a stored key", () => {
  it("reads a legacy tasks + chat key as those two and nothing else", () => {
    expect(toKeyScopes({ tasks: "edit", chat: "view" })).toEqual(
      scopes({ tasks: "edit", chat: "view" }),
    );
  });

  it("reads a key with no scopes as no access, not the new-key default", () => {
    expect(toKeyScopes({})).toEqual(scopes({}));
    expect(toKeyScopes(null)).toEqual(scopes({}));
    expect(toKeyScopes(undefined)).toEqual(scopes({}));
  });

  it("reads a stored admin as none, matching what the connector grants", () => {
    expect(toKeyScopes({ tasks: "admin", notes: "view" })).toEqual(scopes({ notes: "view" }));
    expect(normalizeMcpKeyScope("admin")).toBe("none");
  });
});

describe("grantsAnyAccess / sameScopes / clampScopes", () => {
  it("is false only when every module is none", () => {
    expect(grantsAnyAccess(scopes({}))).toBe(false);
    expect(grantsAnyAccess(DEFAULT_KEY_SCOPES)).toBe(true);
    expect(grantsAnyAccess(scopes({ chat: "view" }))).toBe(true);
  });

  it("compares access module by module", () => {
    expect(sameScopes(scopes({ tasks: "view" }), { ...DEFAULT_KEY_SCOPES })).toBe(true);
    expect(sameScopes(scopes({ tasks: "view" }), scopes({ tasks: "edit" }))).toBe(false);
    expect(sameScopes(scopes({ email: "view" }), scopes({}))).toBe(false);
  });

  it("caps each module at its own cap", () => {
    expect(
      clampScopes(
        scopes({ tasks: "edit", notes: "edit", email: "view" }),
        scopes({ tasks: "view", notes: "edit" }),
      ),
    ).toEqual(scopes({ tasks: "view", notes: "edit" }));
  });
});

describe("scopeSummary: a key row's one-line access", () => {
  it("leads with edit, then view, in key-card order", () => {
    expect(scopeSummary(scopes({ email: "view", notes: "edit", tasks: "edit" }))).toBe(
      "Edit: Tasks, Notes · View: Email",
    );
  });

  it("reads the default as View: Tasks", () => {
    expect(scopeSummary(DEFAULT_KEY_SCOPES)).toBe("View: Tasks");
  });

  it("collapses a level every module holds", () => {
    const all = (level: "view" | "edit") =>
      Object.fromEntries(MODULE_IDS.map((module) => [module, level])) as McpKeyScopes;
    expect(scopeSummary(all("edit"))).toBe("Edit: all modules");
    expect(scopeSummary(all("view"))).toBe("View: all modules");
  });

  it("says when a key reaches nothing", () => {
    expect(scopeSummary(scopes({}))).toBe("No access");
  });
});

// ── the creator cap (mirror of module_api_key_cap / module_member_permission) ─

const actor = (role: KeyActor["role"], perms: string[]): KeyActor => ({
  role,
  perms: perms as PermissionKey[],
});

describe("keyScopeCap: a key never gets more than its creator", () => {
  it("gives the owner Edit everywhere, whatever their resolved keys say", () => {
    for (const module of MCP_KEY_MODULES)
      expect(keyScopeCap(actor("owner", []), module)).toBe("edit");
  });

  it("follows each module's own keys: any of create / edit / delete is Edit, view is View", () => {
    const member = actor("editor", ["notes.view", "notes.create", "tasks.view", "chat.view"]);
    expect(keyScopeCap(member, "notes")).toBe("edit");
    expect(keyScopeCap(member, "tasks")).toBe("view");
    expect(keyScopeCap(member, "chat")).toBe("view");
    expect(keyScopeCap(member, "contacts")).toBe("none");
    expect(keyScopeCap(member, "calendar")).toBe("none");
  });

  it("puts Links on any module: Edit if they can change anything, View if they can only look", () => {
    expect(keyScopeCap(actor("editor", ["tasks.view", "tasks.delete"]), "links")).toBe("edit");
    expect(keyScopeCap(actor("viewer", ["notes.view", "tasks.view"]), "links")).toBe("view");
    expect(keyScopeCap(actor("editor", []), "links")).toBe("none");
  });

  it("puts Email on the member's tier: viewers read, everyone else edits", () => {
    expect(keyScopeCap(actor("viewer", ["notes.view"]), "email")).toBe("view");
    expect(keyScopeCap(actor("editor", []), "email")).toBe("edit");
    expect(keyScopeCap(actor("admin", []), "email")).toBe("edit");
  });

  it("gives a creator who left the workspace nothing", () => {
    for (const module of MCP_KEY_MODULES) expect(keyScopeCap(null, module)).toBe("none");
  });

  it("effectiveScopes caps the stored map by the creator", () => {
    const stored = scopes({ tasks: "edit", notes: "edit", email: "edit" });
    expect(effectiveScopes(stored, actor("viewer", ["tasks.view"]))).toEqual(
      scopes({ tasks: "view", email: "view" }),
    );
    expect(effectiveScopes(stored, null)).toEqual(scopes({}));
    expect(effectiveScopes(stored, actor("owner", []))).toEqual(stored);
  });
});

describe("scopeCeiling: who may raise what", () => {
  it("lets the creator go up to their own access (or keep what the key holds)", () => {
    expect(scopeCeiling({ stored: "none", isCreator: true, myCap: "edit" })).toBe("edit");
    expect(scopeCeiling({ stored: "none", isCreator: true, myCap: "view" })).toBe("view");
    // A narrowed role never traps a row: the stored level stays choosable.
    expect(scopeCeiling({ stored: "edit", isCreator: true, myCap: "view" })).toBe("edit");
  });

  it("lets anyone else only lower it", () => {
    expect(scopeCeiling({ stored: "view", isCreator: false, myCap: "edit" })).toBe("view");
    expect(scopeCeiling({ stored: "none", isCreator: false, myCap: "edit" })).toBe("none");
  });

  it("explains the ceiling in the row's words", () => {
    expect(
      ceilingHint({ module: "notes", isCreator: true, myCap: "view", creatorName: "you" }),
    ).toBe("You can only view Notes yourself.");
    expect(
      ceilingHint({ module: "chat", isCreator: true, myCap: "none", creatorName: "you" }),
    ).toBe("You don't have access to Chat yourself.");
    expect(
      ceilingHint({ module: "tasks", isCreator: false, myCap: "edit", creatorName: "Anna" }),
    ).toBe("Only Anna can give this key more access.");
  });
});

describe("key expiry", () => {
  it("starts the picker at 90 days and maps every choice to the days the server takes", () => {
    expect(DEFAULT_KEY_EXPIRY).toBe("90");
    expect(KEY_EXPIRY_OPTIONS.map((o) => expiryDays(o.value))).toEqual([null, 30, 90, 365]);
    expect(expiryDays("nonsense")).toBeNull();
  });

  const NOW = Date.parse("2026-10-09T12:00:00Z");
  const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

  it("reads a key with no expiry as active and never expiring", () => {
    const life = keyLifecycle({ createdAt: day(-5), lastUsedAt: day(-1), expiresAt: null }, NOW);
    expect(life).toEqual({ status: "active", expiryLine: null, staleNote: null });
  });

  it("says when a key expires, and gets louder in the last week", () => {
    const far = keyLifecycle({ createdAt: day(-5), lastUsedAt: day(-1), expiresAt: day(60) }, NOW);
    expect(far.status).toBe("active");
    expect(far.expiryLine).toMatch(/^Expires \d/);
    const soon = keyLifecycle({ createdAt: day(-5), lastUsedAt: day(-1), expiresAt: day(4) }, NOW);
    expect(soon).toMatchObject({ status: "expiring", expiryLine: "Expires in 4 days" });
    const tomorrow = keyLifecycle(
      { createdAt: day(-5), lastUsedAt: day(-1), expiresAt: day(0.5) },
      NOW,
    );
    expect(tomorrow.expiryLine).toBe("Expires tomorrow");
  });

  it("marks a key expired once its time has passed, and an unreadable one too", () => {
    const gone = keyLifecycle(
      { createdAt: day(-99), lastUsedAt: day(-3), expiresAt: day(-1) },
      NOW,
    );
    expect(gone.status).toBe("expired");
    expect(gone.expiryLine).toMatch(/^Expired \d/);
    expect(gone.staleNote).toBeNull();
    const broken = keyLifecycle({ createdAt: day(-9), lastUsedAt: null, expiresAt: "soon" }, NOW);
    expect(broken).toMatchObject({ status: "expired", expiryLine: "Expired" });
  });

  it("nudges to revoke a key unused for 60 days, or never used for 60 days", () => {
    const idle = keyLifecycle({ createdAt: day(-200), lastUsedAt: day(-61), expiresAt: null }, NOW);
    expect(idle.staleNote).toBe("Unused for 61 days. Revoke it if you no longer need it.");
    const never = keyLifecycle({ createdAt: day(-70), lastUsedAt: null, expiresAt: null }, NOW);
    expect(never.staleNote).toBe("Never used in 70 days. Revoke it if you no longer need it.");
    const fresh = keyLifecycle({ createdAt: day(-10), lastUsedAt: null, expiresAt: null }, NOW);
    expect(fresh.staleNote).toBeNull();
    const used = keyLifecycle({ createdAt: day(-200), lastUsedAt: day(-59), expiresAt: null }, NOW);
    expect(used.staleNote).toBeNull();
  });
});
