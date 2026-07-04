// AC8 proof: a company hub unions its people (denormalized members ∪ works-at
// links) and their work one level up, dropping the intra-company edges.

import { describe, expect, it } from "vitest";

import { buildCompanyRollup, type CompanyRollupInput } from "./company";
import { entityRefKey } from "../spine/rollup";
import type { EntityLink, EntityRecord, EntityRef } from "../../lib/entity-links";
import type { Contact } from "./model";

const COMPANY: EntityRef = { type: "company", id: "co1" };

let seq = 0;
function link(source: EntityRef, target: EntityRef, kind: EntityLink["relationKind"]): EntityLink {
  seq += 1;
  return {
    id: `l${seq}`,
    workspaceId: "w",
    sourceType: source.type,
    sourceId: source.id,
    targetType: target.type,
    targetId: target.id,
    relationKind: kind,
    origin: "manual",
    createdBy: "u1",
    createdAt: "2026-06-20T09:00:00Z",
    deletedAt: null,
  };
}
function rec(ref: EntityRef, label: string): EntityRecord {
  return { workspaceId: "w", type: ref.type, id: ref.id, label, icon: null, deletedAt: null };
}
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
    companyId: "co1",
    status: "active",
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

const dana: EntityRef = { type: "contact", id: "c1" };
const lee: EntityRef = { type: "contact", id: "c2" };
const taskA: EntityRef = { type: "task", id: "t1" };
const noteA: EntityRef = { type: "note", id: "n1" };

function input(over: Partial<CompanyRollupInput> = {}): CompanyRollupInput {
  return {
    company: COMPANY,
    companyLinks: [link(lee, COMPANY, "works-at")], // Lee linked but not denormalized
    members: [contact({ id: "c1", name: "Dana Lee", companyId: "co1" })], // Dana denormalized
    memberLinks: {
      c1: [link(dana, taskA, "follow-up"), link(dana, COMPANY, "works-at")],
      c2: [link(lee, noteA, "references")],
    },
    records: new Map([
      [entityRefKey(taskA), rec(taskA, "Send proposal")],
      [entityRefKey(noteA), rec(noteA, "Account plan")],
      [entityRefKey(lee), rec(lee, "Lee Park")],
    ]),
    ...over,
  };
}

describe("buildCompanyRollup", () => {
  it("unions denormalized members with works-at-linked people", () => {
    const { people } = buildCompanyRollup(input());
    expect(people.map((p) => p.id).sort()).toEqual(["c1", "c2"]);
    // Denormalized member carries its status; a works-at-only person resolves a
    // label from the registry with unknown status.
    expect(people.find((p) => p.id === "c1")).toMatchObject({ name: "Dana Lee", status: "active" });
    expect(people.find((p) => p.id === "c2")).toMatchObject({ name: "Lee Park", status: "" });
  });

  it("rolls up members' work one level higher, excluding intra-company edges", () => {
    const { unionSections } = buildCompanyRollup(input());
    const rows = unionSections.flatMap((s) => s.rows.map((r) => entityRefKey(r.other)));
    // Dana's task + Lee's note surface on the company…
    expect(rows).toContain(entityRefKey(taskA));
    expect(rows).toContain(entityRefKey(noteA));
    // …but the person↔company works-at edges do NOT (those are the People group).
    expect(rows).not.toContain(entityRefKey(dana));
    expect(rows).not.toContain(entityRefKey(lee));
    expect(rows).not.toContain(entityRefKey(COMPANY));
  });

  it("stamps inherited union rows with the member they came from (FX-7 via caption)", () => {
    const { unionSections } = buildCompanyRollup(input());
    const rows = unionSections.flatMap((s) => s.rows);
    const taskRow = rows.find((r) => entityRefKey(r.other) === entityRefKey(taskA));
    const noteRow = rows.find((r) => entityRefKey(r.other) === entityRefKey(noteA));
    // Dana's task + Lee's note are inherited — they carry their member's name…
    expect(taskRow?.via).toBe("Dana Lee");
    expect(noteRow?.via).toBe("Lee Park");
  });

  it("leaves the company's own rows without a via caption", () => {
    // A task linked directly to the company (not via any member) carries no via.
    const directTask: EntityRef = { type: "task", id: "t-direct" };
    const { unionSections } = buildCompanyRollup(
      input({
        companyLinks: [link(COMPANY, directTask, "references")],
        members: [],
        memberLinks: {},
        records: new Map([[entityRefKey(directTask), rec(directTask, "Company kickoff")]]),
      }),
    );
    const row = unionSections.flatMap((s) => s.rows).find((r) => entityRefKey(r.other) === entityRefKey(directTask));
    expect(row?.via ?? null).toBeNull();
  });

  it("dedupes a counterpart shared by two members", () => {
    const shared = input({
      memberLinks: {
        c1: [link(dana, taskA, "references")],
        c2: [link(lee, taskA, "references")],
      },
    });
    const { unionSections } = buildCompanyRollup(shared);
    const taskRows = unionSections.flatMap((s) => s.rows).filter((r) => entityRefKey(r.other) === entityRefKey(taskA));
    expect(taskRows).toHaveLength(1);
  });
});
