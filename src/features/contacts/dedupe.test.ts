// Contacts module — dedupe heuristics tests.

import { describe, expect, it } from "vitest";
import { findDuplicateGroups, probeDuplicate } from "./dedupe";
import type { Contact, ContactChannel } from "./model";

/** Minimal Contact factory — only the dedupe-relevant fields matter. */
function contact(overrides: Partial<Contact> & Pick<Contact, "id">): Contact {
  return {
    workspaceId: "ws",
    ownerId: "owner",
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
    ...overrides,
  };
}

const channel = (value: string, label = "work"): ContactChannel => ({ label, value });

describe("findDuplicateGroups", () => {
  it("returns nothing for an empty list", () => {
    expect(findDuplicateGroups([])).toEqual([]);
  });

  it("groups two contacts sharing an email (reason: email)", () => {
    const groups = findDuplicateGroups([
      contact({ id: "a", name: "Ada", email: "ada@example.com" }),
      contact({ id: "b", name: "Ada L.", email: "ada@example.com" }),
    ]);
    expect(groups).toEqual([{ reason: "email", key: "ada@example.com", contactIds: ["a", "b"] }]);
  });

  it("groups two contacts sharing only a name (reason: name)", () => {
    const groups = findDuplicateGroups([
      contact({ id: "a", name: "John Smith", email: "john@a.com" }),
      contact({ id: "b", name: "John Smith", email: "john@b.com" }),
    ]);
    expect(groups).toEqual([{ reason: "name", key: "john smith", contactIds: ["a", "b"] }]);
  });

  it("does not group a contact with a unique email", () => {
    const groups = findDuplicateGroups([
      contact({ id: "a", name: "Solo", email: "solo@example.com" }),
      contact({ id: "b", name: "Other", email: "other@example.com" }),
    ]);
    expect(groups).toEqual([]);
  });

  it("matches emails case-insensitively and with surrounding whitespace", () => {
    const groups = findDuplicateGroups([
      contact({ id: "a", name: "Ada", email: "ADA@Example.com" }),
      contact({ id: "b", name: "Ada", email: "  ada@example.com  " }),
    ]);
    expect(groups).toEqual([{ reason: "email", key: "ada@example.com", contactIds: ["a", "b"] }]);
  });

  it("matches names case-insensitively and collapses whitespace", () => {
    const groups = findDuplicateGroups([
      contact({ id: "a", name: "  John   Smith " }),
      contact({ id: "b", name: "john smith" }),
    ]);
    expect(groups).toEqual([{ reason: "name", key: "john smith", contactIds: ["a", "b"] }]);
  });

  it("detects emails carried in the emails[] channel array (not just the scalar)", () => {
    const groups = findDuplicateGroups([
      contact({ id: "a", name: "Ada", emails: [channel("ada@example.com")] }),
      contact({ id: "b", name: "Other", email: "ada@example.com" }),
    ]);
    expect(groups).toEqual([{ reason: "email", key: "ada@example.com", contactIds: ["a", "b"] }]);
  });

  it("transitively unions contacts linked through overlapping emails", () => {
    // a~b share x@e.com; b~c share y@e.com — all three are one identity.
    const groups = findDuplicateGroups([
      contact({ id: "a", name: "A", email: "x@e.com" }),
      contact({ id: "b", name: "B", email: "x@e.com", emails: [channel("y@e.com")] }),
      contact({ id: "c", name: "C", email: "y@e.com" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.reason).toBe("email");
    expect(groups[0]!.contactIds.sort()).toEqual(["a", "b", "c"]);
    expect(groups[0]!.key).toBe("x@e.com"); // smallest email is the key
  });

  it("prefers email reason: an email-grouped contact is not also name-grouped", () => {
    // a & b share an email AND a name; c shares only the name with them.
    const groups = findDuplicateGroups([
      contact({ id: "a", name: "Jane Doe", email: "jane@e.com" }),
      contact({ id: "b", name: "Jane Doe", email: "jane@e.com" }),
      contact({ id: "c", name: "Jane Doe", email: "jane.other@e.com" }),
    ]);
    const emailGroup = groups.find((g) => g.reason === "email");
    const nameGroup = groups.find((g) => g.reason === "name");
    expect(emailGroup).toEqual({ reason: "email", key: "jane@e.com", contactIds: ["a", "b"] });
    // c never shared an email with anyone, so it's a singleton on the name pass —
    // and a & b are excluded from the name pass entirely. No name group survives.
    expect(nameGroup).toBeUndefined();
  });

  it("name-groups only contacts the email pass left untouched", () => {
    // a & b share an email (email group). c & d share a name, no email overlap.
    const groups = findDuplicateGroups([
      contact({ id: "a", name: "Pat Kim", email: "pat@e.com" }),
      contact({ id: "b", name: "Pat Kim", email: "pat@e.com" }),
      contact({ id: "c", name: "Sam Lee" }),
      contact({ id: "d", name: "Sam Lee" }),
    ]);
    // Sorted by key: "pat@e.com" < "sam lee" ("p" < "s"), so the email group leads.
    expect(groups).toEqual([
      { reason: "email", key: "pat@e.com", contactIds: ["a", "b"] },
      { reason: "name", key: "sam lee", contactIds: ["c", "d"] },
    ]);
  });

  it("emits groups in deterministic key order", () => {
    const groups = findDuplicateGroups([
      contact({ id: "a", name: "Z", email: "zeta@e.com" }),
      contact({ id: "b", name: "Z", email: "zeta@e.com" }),
      contact({ id: "c", name: "A", email: "alpha@e.com" }),
      contact({ id: "d", name: "A", email: "alpha@e.com" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["alpha@e.com", "zeta@e.com"]);
  });

  it("ignores blank emails and blank names", () => {
    const groups = findDuplicateGroups([
      contact({ id: "a", name: "", email: "" }),
      contact({ id: "b", name: "  ", email: null }),
      contact({ id: "c", name: "", emails: [channel("")] }),
    ]);
    expect(groups).toEqual([]);
  });

  it("does not group distinct people who merely share no signal", () => {
    const groups = findDuplicateGroups([
      contact({ id: "a", name: "Ann", email: "ann@e.com" }),
      contact({ id: "b", name: "Bob", email: "bob@e.com" }),
      contact({ id: "c", name: "Cy", email: "cy@e.com" }),
    ]);
    expect(groups).toEqual([]);
  });
});

describe("probeDuplicate — modal dup probe (FX-6 AC9)", () => {
  const existing = [
    contact({ id: "jane", name: "Jane Cooper", email: "jane@acme.com" }),
    contact({ id: "bob", name: "Bob Ross", emails: [channel("bob@paint.com")] }),
  ];

  it("flags the contact whose email matches exactly (case-insensitive)", () => {
    expect(probeDuplicate({ email: "JANE@acme.com" }, existing)?.id).toBe("jane");
    // Channel-array emails are matched too, not just the scalar.
    expect(probeDuplicate({ email: "bob@paint.com" }, existing)?.id).toBe("bob");
  });

  it("flags a near-identical name when there is no email hit", () => {
    expect(probeDuplicate({ name: "  jane   cooper " }, existing)?.id).toBe("jane");
  });

  it("prefers an email match over a name match", () => {
    expect(probeDuplicate({ email: "jane@acme.com", name: "Bob Ross" }, existing)?.id).toBe("jane");
  });

  it("returns null for a distinct person and for blank input", () => {
    expect(probeDuplicate({ email: "new@x.com", name: "New Person" }, existing)).toBeNull();
    expect(probeDuplicate({ email: "", name: "" }, existing)).toBeNull();
  });
});
