import { describe, expect, it } from "@rstest/core";

import { parseOrError } from "./errors.ts";
import { parseJsonBody, createCheckoutSessionBodySchema, issueFounderCouponBodySchema } from "./http-bodies.ts";
import { listingJsonSchema, parseToolArgs, TOOL_ARG_SCHEMAS } from "./mcp-tool-args.ts";
import { RELATION_KINDS, TASK_STATUSES } from "./vocabularies.ts";
import { mapKnownRows, requireRow, taskRowSchema } from "./rows.ts";

const validTask = {
  id: "t1",
  workspace_id: "w1",
  bucket_id: "b1",
  title: "Ship contracts",
  status: "todo",
  created_at: "2026-08-17T10:00:00Z",
  updated_at: "2026-08-17T10:00:00Z",
};

describe("runtime row boundary", () => {
  it("maps a valid task row identically", () => {
    const parsed = parseOrError(taskRowSchema, validTask);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.title).toBe("Ship contracts");
      expect(parsed.data.status).toBe("todo");
    }
  });

  it("rejects an unknown task status so it cannot reach the model", () => {
    expect(parseOrError(taskRowSchema, { ...validTask, status: "nope" }).success).toBe(false);
    expect(() => requireRow(taskRowSchema, { ...validTask, status: "nope" }, "task")).toThrow(
      /Malformed task/,
    );
  });

  it("drops malformed rows from list reads", () => {
    const mapped = mapKnownRows([validTask, { id: "bad" }, null], (row) =>
      requireRow(taskRowSchema, row, "task"),
    );
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.id).toBe("t1");
  });
});

describe("edge function bodies", () => {
  it("accepts a valid founder coupon email", () => {
    const parsed = parseJsonBody(issueFounderCouponBodySchema, {
      email: "founder@example.com",
      sendEmail: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a missing email before Stripe is touched", () => {
    const parsed = parseJsonBody(issueFounderCouponBodySchema, { sendEmail: true });
    expect(parsed.success).toBe(false);
  });

  it("rejects a malformed checkout body before Stripe is touched", () => {
    const parsed = parseJsonBody(createCheckoutSessionBodySchema, { plan: 1 });
    expect(parsed.success).toBe(false);
  });
});

describe("MCP tool args", () => {
  it("accepts a valid tasks_set_status payload", () => {
    const parsed = parseToolArgs("tasks_set_status", { task_id: "abc", status: "done" });
    expect(parsed.success).toBe(true);
  });

  it("rejects an invalid status and an oversized missing uuid-like id", () => {
    expect(parseToolArgs("tasks_set_status", { task_id: "abc", status: "nope" }).success).toBe(
      false,
    );
    expect(parseToolArgs("tasks_get", {}).success).toBe(false);
  });

  it("lets contacts_link start only at a contact or a company", () => {
    const link = { contact_id: "c1", target_type: "note", target_id: "n1" };
    expect(parseToolArgs("contacts_link", { ...link, contact_type: "company" }).success).toBe(true);
    expect(parseToolArgs("contacts_link", { ...link, contact_type: "task" }).success).toBe(false);
    const listed = listingJsonSchema("contacts_link");
    const type = (listed.properties as Record<string, { enum?: string[] }>).contact_type;
    expect(type?.enum).toEqual(["contact", "company"]);
  });

  it("rejects a non-canonical date on tasks_today", () => {
    const parsed = parseToolArgs("tasks_today", { date: "17/08/2026" });
    expect(parsed.success).toBe(false);
  });

  it("tasks_assign takes a member id, \"me\" or null (unassign), and needs it said (TV-D1)", () => {
    expect(parseToolArgs("tasks_assign", { task_id: "t1", assignee_id: "u2" }).success).toBe(true);
    expect(parseToolArgs("tasks_assign", { task_id: "t1", assignee_id: "me" }).success).toBe(true);
    const unassign = parseToolArgs("tasks_assign", { task_id: "t1", assignee_id: null });
    expect(unassign.success).toBe(true);
    if (unassign.success) expect(unassign.data.assignee_id).toBeNull();
    // Leaving it out must not read as "unassign".
    expect(parseToolArgs("tasks_assign", { task_id: "t1" }).success).toBe(false);
    expect(parseToolArgs("tasks_assign", { task_id: "t1", assignee_id: "" }).success).toBe(false);
    expect(parseToolArgs("tasks_list_assignees", {}).success).toBe(true);
  });

  it("rejects an unknown tool instead of forwarding raw args", () => {
    expect(parseToolArgs("not_a_real_tool", { task_id: "x" }).success).toBe(false);
  });

  it("rejects an oversized MCP limit", () => {
    expect(parseToolArgs("tasks_list", { limit: 500 }).success).toBe(false);
  });

  it("catalogs every tasks_list status including the open alias from TASK_STATUSES", () => {
    expect(parseToolArgs("tasks_list", { status: "open" }).success).toBe(true);
    expect(parseToolArgs("tasks_list", { status: "todo" }).success).toBe(true);
  });

  it("exports a parser for every registered tool name in the catalog", () => {
    expect(Object.keys(TOOL_ARG_SCHEMAS).length).toBeGreaterThan(40);
  });

  it("lists tasks_list.status as a flat enum including the open alias", () => {
    const listed = listingJsonSchema("tasks_list", {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status." },
      },
    });
    const status = (listed.properties as Record<string, { enum?: string[]; description?: string }>)
      .status;
    expect(status?.enum).toEqual(["open", ...TASK_STATUSES]);
    expect(status?.description).toBe("Filter by status.");
  });

  it("lists links_set_kind.relation_kind from RELATION_KINDS", () => {
    const listed = listingJsonSchema("links_set_kind");
    const kind = (listed.properties as Record<string, { enum?: string[] }>).relation_kind;
    expect(kind?.enum).toEqual([...RELATION_KINDS]);
  });

  it("keeps handler-consumed optional fields instead of stripping them", () => {
    const link = parseToolArgs("contacts_link", {
      contact_type: "contact",
      contact_id: "c1",
      target_type: "task",
      target_id: "t1",
      relation_kind: "works-at",
    });
    expect(link.success).toBe(true);
    if (link.success) expect(link.data.relation_kind).toBe("works-at");

    const note = parseToolArgs("notes_update", {
      note_id: "n1",
      markdown: "# hi",
      title: "Renamed",
    });
    expect(note.success).toBe(true);
    if (note.success) expect(note.data.title).toBe("Renamed");

    const event = parseToolArgs("calendar_create_event", {
      title: "Standup",
      starts_at: "2026-08-30T09:00:00Z",
      ends_at: "2026-08-30T09:15:00Z",
      rrule: "FREQ=WEEKLY",
    });
    expect(event.success).toBe(true);
    if (event.success) expect(event.data.rrule).toBe("FREQ=WEEKLY");

    const listed = listingJsonSchema("contacts_link");
    const kind = (listed.properties as Record<string, { enum?: string[] }>).relation_kind;
    expect(kind?.enum).toEqual([...RELATION_KINDS]);
  });
});
