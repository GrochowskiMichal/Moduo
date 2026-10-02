// FX-3 AC4 — directory query logic: the widened search field set, status/tag
// filters (including the "no status" sentinel), Recent sort ordering, and the
// "title · company" secondary line.

import { describe, expect, it } from "vitest";
import type { TagLink } from "../tasks/model";
import {
  filterCompanies,
  filterPeople,
  matchesCompany,
  matchesPerson,
  personSecondary,
  STATUS_FILTER_NONE,
  sortRecent,
} from "./directory-query";
import type { Company, Contact } from "./model";

function person(over: Partial<Contact>): Contact {
  return {
    id: "c1",
    workspaceId: "w1",
    ownerId: "u1",
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
    id: "co1",
    workspaceId: "w1",
    ownerId: "u1",
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

const JANE = person({
  id: "jane",
  name: "Jane Cooper",
  email: "jane@acme.com",
  phone: "+48 601 222 314",
  title: "Head of Product",
  companyId: "acme",
  status: "active",
});
const BEN = person({ id: "ben", name: "Ben Okafor", status: "" });
const ACME = company({
  id: "acme",
  name: "Acme Corp",
  domains: ["acme.com"],
  website: "https://acme.dev",
});

const NAMES = new Map([["acme", "Acme Corp"]]);

describe("matchesPerson / matchesCompany — the widened search field set", () => {
  it("matches people by title, company name, and phone (not just name/email)", () => {
    expect(matchesPerson(JANE, "head of prod", "Acme Corp")).toBe(true);
    expect(matchesPerson(JANE, "acme corp", "Acme Corp")).toBe(true);
    expect(matchesPerson(JANE, "601 222", "Acme Corp")).toBe(true);
    expect(matchesPerson(JANE, "nomatch", "Acme Corp")).toBe(false);
  });

  it("matches secondary emails/phones from the multi-value lists", () => {
    const withSecondary = person({
      ...JANE,
      emails: [{ label: "personal", value: "jane.cooper@icloud.com" }],
      phones: [{ label: "home", value: "+48 700 000 001" }],
    });
    expect(matchesPerson(withSecondary, "icloud.com", "Acme Corp")).toBe(true);
    expect(matchesPerson(withSecondary, "700 000", "Acme Corp")).toBe(true);
  });

  it("matches companies by domain and website", () => {
    expect(matchesCompany(ACME, "acme.com")).toBe(true);
    expect(matchesCompany(ACME, "acme.dev")).toBe(true);
    expect(matchesCompany(ACME, "northwind")).toBe(false);
  });
});

describe("filterPeople — status + tag filters", () => {
  const base = {
    query: "",
    status: "",
    tagId: "",
    tagLinks: [] as TagLink[],
    companyNameById: NAMES,
  };

  it("filters by status id, and the sentinel matches only no-status contacts", () => {
    expect(filterPeople([JANE, BEN], { ...base, status: "active" }).map((c) => c.id)).toEqual([
      "jane",
    ]);
    expect(
      filterPeople([JANE, BEN], { ...base, status: STATUS_FILTER_NONE }).map((c) => c.id),
    ).toEqual(["ben"]);
  });

  it("filters by tag through contact-type links only", () => {
    const links: TagLink[] = [
      {
        id: "l1",
        workspaceId: "w1",
        tagId: "t1",
        entityType: "contact",
        entityId: "jane",
        createdAt: "",
      },
      {
        id: "l2",
        workspaceId: "w1",
        tagId: "t1",
        entityType: "company",
        entityId: "ben",
        createdAt: "",
      },
    ];
    expect(
      filterPeople([JANE, BEN], { ...base, tagId: "t1", tagLinks: links }).map((c) => c.id),
    ).toEqual(["jane"]);
  });

  it("company-tag filter never leaks into people (and vice versa)", () => {
    const links: TagLink[] = [
      {
        id: "l1",
        workspaceId: "w1",
        tagId: "t1",
        entityType: "company",
        entityId: "acme",
        createdAt: "",
      },
    ];
    expect(
      filterCompanies([ACME], { query: "", tagId: "t1", tagLinks: links }).map((c) => c.id),
    ).toEqual(["acme"]);
    expect(filterPeople([JANE], { ...base, tagId: "t1", tagLinks: links })).toEqual([]);
  });
});

describe("sortRecent", () => {
  it("orders by updatedAt desc, name-tiebreak, without mutating the input", () => {
    const a = person({ id: "a", name: "Zed", updatedAt: "2026-03-01T00:00:00Z" });
    const b = person({ id: "b", name: "Amy", updatedAt: "2026-05-01T00:00:00Z" });
    const c = person({ id: "c", name: "Bob", updatedAt: "2026-03-01T00:00:00Z" });
    const input = [a, b, c];
    expect(sortRecent(input).map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect(input.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});

describe("personSecondary", () => {
  it("joins title · company, falls back to one of them, then email", () => {
    expect(personSecondary(JANE, "Acme Corp")).toBe("Head of Product · Acme Corp");
    expect(personSecondary(person({ title: "CTO" }), null)).toBe("CTO");
    expect(personSecondary(person({ email: "x@y.z" }), null)).toBe("x@y.z");
    expect(personSecondary(person({}), null)).toBeNull();
  });
});
