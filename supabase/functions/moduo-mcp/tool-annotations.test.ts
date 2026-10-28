/**
 * Code-mode readiness (MCPO-6, specs/mcp-oauth.md AC12): every tool says how
 * calling it behaves (read-only, destructive, idempotent), and the five main
 * reads publish an output schema their answers match.
 *
 * Real answers are checked where the fixtures are: every call a connector test
 * makes to one of the five through the SDK (through-sdk.ts) must answer
 * `structuredContent` equal to its text and matching its schema; tasks_list,
 * tasks_queue and tasks_today in tasks-queue.test.ts and tasks-ops.test.ts,
 * tasks_get and tasks_search in tasks-v3.test.ts. This file checks the
 * listing, the hints and that the check itself bites.
 */

import { describe, expect, it, rs } from "@rstest/core";

// tasks.ts pulls rrule from esm.sh, which only Deno can load; nothing here uses it.
rs.mock("https://esm.sh/rrule@2.8.1?target=deno", () => ({ RRule: class {} }));

import { connectorModules, toolAnnotations, type KeyContext } from "./registry.ts";
import { checkStructuredAnswer, listThroughSdk } from "./through-sdk.ts";
import { TOOL_OUTPUT_SCHEMAS } from "./tool-outputs.ts";

const tools = connectorModules.flatMap((m) => m.tools);
const MAIN_READS = ["tasks_list", "tasks_get", "tasks_search", "tasks_today", "tasks_queue"];

/** Every tool that can delete, trash or overwrite, reviewed by hand. */
const DESTRUCTIVE = [
  "calendar_delete_event",
  "contacts_delete",
  "contacts_unlink",
  "email_clear_follow_up",
  "email_remove",
  "imports_undo",
  "links_delete",
  "notes_archive",
  "notes_trash",
  "notes_update",
  "projects_update",
  "tasks_reminder_remove",
  "tasks_unschedule",
  "tasks_waiting_clear",
  "tasks_work_session_remove",
];

/**
 * Names that read as removal but lose nothing: a task leaving the key
 * creator's queue stays as it is (the deprecated aliases do the same).
 */
const REMOVES_NOTHING = ["tasks_queue_remove", "tasks_uncommit", "tasks_skip_today"];

describe("tool annotations", () => {
  it("every tool is annotated, every hint stated", () => {
    expect(tools.length).toBe(111);
    for (const tool of tools) {
      const a = toolAnnotations(tool);
      expect(typeof a.readOnlyHint, tool.name).toBe("boolean");
      expect(typeof a.destructiveHint, tool.name).toBe("boolean");
      expect(typeof a.idempotentHint, tool.name).toBe("boolean");
      expect(a.openWorldHint, tool.name).toBe(false);
    }
  });

  it("every View tool is read-only, and so is links_suggest; no other Edit tool is", () => {
    for (const tool of tools) {
      const readOnly = toolAnnotations(tool).readOnlyHint;
      expect(readOnly, tool.name).toBe(tool.access === "view" || tool.name === "links_suggest");
    }
  });

  it("a read-only tool is never destructive and is safe to repeat", () => {
    for (const tool of tools.filter((t) => toolAnnotations(t).readOnlyHint)) {
      expect(toolAnnotations(tool), tool.name).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  it("the destructive tools are the reviewed list, and every delete / trash / remove / clear / undo is on it", () => {
    const destructive = tools.filter((t) => toolAnnotations(t).destructiveHint).map((t) => t.name).sort();
    expect(destructive).toEqual(DESTRUCTIVE);
    const removal = /(delete|trash|remove|unlink|clear|undo|archive)/;
    for (const tool of tools.filter((t) => removal.test(t.name) && !REMOVES_NOTHING.includes(t.name))) {
      expect(toolAnnotations(tool).destructiveHint, tool.name).toBe(true);
    }
  });

  it("a destructive tool is idempotent: deleting twice deletes once", () => {
    for (const name of DESTRUCTIVE) {
      const tool = tools.find((t) => t.name === name)!;
      expect(toolAnnotations(tool).idempotentHint, name).toBe(true);
    }
  });

  it("are what a client lists through the SDK", async () => {
    const scopes = Object.fromEntries(connectorModules.map((m) => [m.module, "edit"]));
    const key: KeyContext = { id: "key-1", workspaceId: "ws", name: "Agent", createdBy: "u", scopes };
    const listed = await listThroughSdk(key);
    for (const tool of tools) {
      expect(listed.find((t) => t.name === tool.name)?.annotations, tool.name).toEqual(toolAnnotations(tool));
    }
  });
});

describe("output schemas", () => {
  it("only the five main reads have one, and a client lists it", async () => {
    expect(Object.keys(TOOL_OUTPUT_SCHEMAS).sort()).toEqual([...MAIN_READS].sort());
    const scopes = Object.fromEntries(connectorModules.map((m) => [m.module, "view"]));
    const key: KeyContext = { id: "key-1", workspaceId: "ws", name: "Agent", createdBy: "u", scopes };
    const listed = await listThroughSdk(key);
    for (const entry of listed) {
      if (MAIN_READS.includes(entry.name)) expect(entry.outputSchema?.type, entry.name).toBe("object");
      else expect(entry.outputSchema, entry.name).toBeUndefined();
    }
    // A list is listed in the 2025-era wire shape, { result: [...] }.
    const list = listed.find((t) => t.name === "tasks_list")!.outputSchema as any;
    expect(list.required).toEqual(["result"]);
    expect(list.properties.result.type).toBe("array");
  });

  it("tasks_list describes both of its shapes: the short row and the full task", () => {
    const schema = TOOL_OUTPUT_SCHEMAS.tasks_list!;
    const summary = { handle: "MOD-1", id: "t1", title: "Ship", status: "todo", assignee: "Ana", due: "2026-10-23 09:00" };
    const full = {
      id: "t1",
      title: "Ship",
      bucket_id: "p1",
      status: "todo",
      status_category: "todo",
      drifted: false,
      blocked: false,
      assignee_id: null,
      assignee: null,
    };
    expect(schema.safeParse([summary, full]).success).toBe(true);
    // A summary row's status is a category, never something else.
    expect(schema.safeParse([{ ...summary, status: "whatever" }]).success).toBe(false);
  });

  it("the answer check bites: a wrong shape or a structuredContent unlike the text fails", () => {
    const queue = { queue: [] };
    expect(() => checkStructuredAnswer("tasks_queue", queue, queue)).not.toThrow();
    expect(() => checkStructuredAnswer("tasks_queue", { queue: [{ id: 1 }] }, { queue: [{ id: 1 }] })).toThrow(
      "doesn't match its output schema",
    );
    expect(() => checkStructuredAnswer("tasks_queue", queue, { queue: [], extra: 1 })).toThrow("differs");
    expect(() => checkStructuredAnswer("tasks_list", [], undefined)).toThrow("differs");
    expect(() => checkStructuredAnswer("tasks_list", [], { result: [] })).not.toThrow();
    expect(() => checkStructuredAnswer("notes_list", [], { result: [] })).toThrow("no output schema");
  });
});
