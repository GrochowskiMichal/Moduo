// CO-3 / AC6 proof: the CSV importer's pure core — parse, column-map guess,
// dedupe (email FIRST, then name+company, against existing rows AND within the
// file), malformed-row skip, and payload shaping. Server round-trip is manual.

import { describe, expect, it } from "@rstest/core";
import {
  buildImportRows,
  guessColumnMapping,
  parseCsv,
  planImport,
  toImportPayload,
} from "./import";
import type { Company, Contact } from "./model";

function contact(over: Partial<Contact>): Contact {
  return {
    id: "c0",
    workspaceId: "w",
    ownerId: "u",
    name: "",
    email: null,
    emails: [],
    phone: null,
    phones: [],
    addresses: [],
    urls: [],
    dates: [],
    title: null,
    companyId: null,
    status: "",
    custom: {},
    isFavorite: false,
    notesInline: "",
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    ...over,
  };
}
function company(over: Partial<Company>): Company {
  return {
    id: "co0",
    workspaceId: "w",
    ownerId: "u",
    name: "",
    domains: [],
    website: null,
    custom: {},
    notesInline: "",
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    ...over,
  };
}

describe("parseCsv", () => {
  it("parses headers + rows, trimming the header and dropping blank lines", () => {
    const { headers, rows } = parseCsv("Name, Email\nDana,dana@acme.com\n\nLee,lee@beta.io\n");
    expect(headers).toEqual(["Name", "Email"]);
    expect(rows).toEqual([
      ["Dana", "dana@acme.com"],
      ["Lee", "lee@beta.io"],
    ]);
  });

  it("handles quoted fields with commas, escaped quotes, and CRLF", () => {
    const csv = 'name,note\r\n"Lee, Jr.","said ""hi"""\r\n';
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(["name", "note"]);
    expect(rows).toEqual([["Lee, Jr.", 'said "hi"']]);
  });

  it("strips a leading BOM and flushes a final unterminated row", () => {
    const { headers, rows } = parseCsv("﻿name,email\nDana,dana@acme.com");
    expect(headers).toEqual(["name", "email"]);
    expect(rows).toEqual([["Dana", "dana@acme.com"]]);
  });

  it("auto-detects a semicolon delimiter (Excel / European export)", () => {
    const { headers, rows } = parseCsv("Name;Email;Company\nDana Lee;dana@acme.com;Acme\n");
    expect(headers).toEqual(["Name", "Email", "Company"]);
    expect(rows).toEqual([["Dana Lee", "dana@acme.com", "Acme"]]);
  });

  it("auto-detects a tab delimiter", () => {
    const { headers, rows } = parseCsv("Name\tEmail\nDana\tdana@acme.com\n");
    expect(headers).toEqual(["Name", "Email"]);
    expect(rows).toEqual([["Dana", "dana@acme.com"]]);
  });
});

describe("guessColumnMapping", () => {
  it("maps common headers and resolves compound headers by priority", () => {
    expect(
      guessColumnMapping([
        "Full Name",
        "E-mail Address",
        "Company Name",
        "Mobile",
        "Job Title",
        "Status",
        "Notes",
      ]),
    ).toEqual(["name", "email", "company", "phone", "title", "status", "ignore"]);
  });

  it("recognizes first/last name parts distinctly from a full name", () => {
    expect(guessColumnMapping(["First Name", "Last Name"])).toEqual(["firstName", "lastName"]);
  });

  it("falls back to ignore for unrecognized columns", () => {
    expect(guessColumnMapping(["xyz", ""])).toEqual(["ignore", "ignore"]);
  });
});

describe("buildImportRows", () => {
  it("joins first+last when there is no explicit name column, first non-empty per field", () => {
    const headers = ["First", "Last", "Email"];
    const mapping = guessColumnMapping(headers); // firstName, lastName, email
    const rows = buildImportRows(headers, [["Dana", "Lee", "dana@acme.com"]], mapping);
    expect(rows[0]).toMatchObject({ name: "Dana Lee", email: "dana@acme.com" });
  });

  it("prefers an explicit name column over first/last parts", () => {
    const headers = ["Name", "First", "Last"];
    const mapping: ReturnType<typeof guessColumnMapping> = ["name", "firstName", "lastName"];
    const rows = buildImportRows(headers, [["Dana Lee", "Ignore", "Me"]], mapping);
    expect(rows[0].name).toBe("Dana Lee");
  });
});

describe("planImport — dedupe email first, then name+company", () => {
  it("merges on an existing email match (reason email)", () => {
    const existing = [
      contact({
        id: "c1",
        name: "Old Name",
        email: "dana@acme.com",
        emails: [{ label: "other", value: "dana@acme.com", primary: true }],
      }),
    ];
    const rows = buildImportRows(
      ["name", "email"],
      [["Dana Lee", "DANA@acme.com"]],
      ["name", "email"],
    );
    const plan = planImport(rows, existing, []);
    expect(plan.entries[0]).toMatchObject({
      action: "merge",
      matchedContactId: "c1",
      reason: "email",
    });
  });

  it("merges on name+company when there is no email match", () => {
    const existing = [contact({ id: "c2", name: "Dana Lee", companyId: "co1" })];
    const companies = [company({ id: "co1", name: "Acme" })];
    const rows = buildImportRows(["name", "company"], [["dana lee", "ACME"]], ["name", "company"]);
    const plan = planImport(rows, existing, companies);
    expect(plan.entries[0]).toMatchObject({
      action: "merge",
      matchedContactId: "c2",
      reason: "name+company",
    });
  });

  it("flags a second row matching the same existing contact as a duplicate, not a second merge", () => {
    const existing = [
      contact({
        id: "c1",
        name: "Dana",
        email: "dana@acme.com",
        emails: [{ label: "other", value: "dana@acme.com", primary: true }],
      }),
    ];
    const rows = buildImportRows(
      ["name", "email"],
      [
        ["Dana One", "dana@acme.com"],
        ["Dana Two", "dana@acme.com"],
      ],
      ["name", "email"],
    );
    const plan = planImport(rows, existing, []);
    expect(plan.entries[0]).toMatchObject({ action: "merge", matchedContactId: "c1" });
    expect(plan.entries[1]).toMatchObject({ action: "duplicate" });
    // Only ONE merge reaches the op — never a double-write into the same contact.
    expect(toImportPayload(plan)).toEqual([
      {
        op: "merge",
        contactId: "c1",
        name: "Dana One",
        email: "dana@acme.com",
        phone: null,
        title: null,
        company: null,
        status: null,
      },
    ]);
  });

  it("flags a within-file duplicate (skipped, not a second create)", () => {
    const rows = buildImportRows(
      ["name", "email"],
      [
        ["Dana", "dana@acme.com"],
        ["Dana Again", "dana@acme.com"],
      ],
      ["name", "email"],
    );
    const plan = planImport(rows, [], []);
    expect(plan.entries[0].action).toBe("create");
    expect(plan.entries[1]).toMatchObject({ action: "duplicate", reason: "email" });
  });

  it("previews a name-less row as an error and skips it", () => {
    const rows = buildImportRows(["name", "email"], [["", "ghost@acme.com"]], ["name", "email"]);
    const plan = planImport(rows, [], []);
    expect(plan.entries[0]).toMatchObject({ action: "error", error: "Missing name" });
  });

  it("creates a genuinely new contact and tallies the summary", () => {
    const rows = buildImportRows(
      ["name", "email"],
      [
        ["New Person", "new@x.io"],
        ["", "noname@x.io"],
      ],
      ["name", "email"],
    );
    const plan = planImport(rows, [], []);
    expect(plan.summary).toEqual({ create: 1, merge: 0, duplicate: 0, error: 1, total: 2 });
  });
});

describe("toImportPayload", () => {
  it("emits create + merge rows only, dropping duplicates and errors, normalizing status", () => {
    const existing = [
      contact({
        id: "c1",
        email: "dana@acme.com",
        emails: [{ label: "other", value: "dana@acme.com", primary: true }],
      }),
    ];
    const rows = buildImportRows(
      ["name", "email", "status"],
      [
        ["Dana", "dana@acme.com", "Active"], // → merge into c1
        ["Fresh", "fresh@x.io", "Lead"], // → create
        ["Dupe", "fresh@x.io", ""], // → duplicate (skip)
        ["", "x@x.io", ""], // → error (skip)
      ],
      ["name", "email", "status"],
    );
    const plan = planImport(rows, existing, []);
    const payload = toImportPayload(plan);
    expect(payload).toEqual([
      {
        op: "merge",
        contactId: "c1",
        name: "Dana",
        email: "dana@acme.com",
        phone: null,
        title: null,
        company: null,
        status: null,
      },
      {
        op: "create",
        name: "Fresh",
        email: "fresh@x.io",
        phone: null,
        title: null,
        company: null,
        status: "lead",
      },
    ]);
  });
});
