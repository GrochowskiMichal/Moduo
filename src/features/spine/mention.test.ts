import { describe, expect, it } from "vitest";
import type { EntityRef } from "@/lib/entity-links";
import {
  buildMentionCandidates,
  originForTrigger,
  relationKindForTrigger,
  resolveMention,
  type MentionCreateCandidate,
  type MentionEntityCandidate,
  type MentionPersonCandidate,
} from "./mention";

const acme: EntityRef = { type: "contact", id: "acme" };
const entity: MentionEntityCandidate = {
  kind: "entity",
  ref: acme,
  label: "Acme Corp",
  icon: "contact",
};
const person: MentionPersonCandidate = {
  kind: "person",
  memberId: "u-mike",
  label: "Mike",
  icon: null,
};
const create: MentionCreateCandidate = {
  kind: "create",
  entityType: "task",
  label: "Ship landing page",
};

describe("trigger → kind / origin", () => {
  it("maps @ to mentions/mention and /ref to references/ref", () => {
    expect(relationKindForTrigger("mention")).toBe("mentions");
    expect(originForTrigger("mention")).toBe("mention");
    expect(relationKindForTrigger("ref")).toBe("references");
    expect(originForTrigger("ref")).toBe("ref");
  });
});

describe("resolveMention — @ vs /ref vs person branch", () => {
  it("@entity → a mentions link stamped origin=mention", () => {
    const r = resolveMention({ trigger: "mention", candidate: entity });
    expect(r).toEqual({
      action: "link",
      target: acme,
      relationKind: "mentions",
      origin: "mention",
      label: "Acme Corp",
      icon: "contact",
    });
  });

  it("/ref entity → a references link stamped origin=ref", () => {
    const r = resolveMention({ trigger: "ref", candidate: entity });
    expect(r.action).toBe("link");
    if (r.action !== "link") throw new Error("expected link");
    expect(r.relationKind).toBe("references");
    expect(r.origin).toBe("ref");
    expect(r.target).toEqual(acme);
  });

  it("@person → a person notification (no entity link)", () => {
    const r = resolveMention({ trigger: "mention", candidate: person });
    expect(r).toEqual({ action: "notify-person", memberId: "u-mike", label: "Mike" });
  });

  it("no match → create-and-link carrying the trigger's kind/origin", () => {
    const r = resolveMention({ trigger: "ref", candidate: create });
    expect(r).toEqual({
      action: "create-and-link",
      entityType: "task",
      label: "Ship landing page",
      relationKind: "references",
      origin: "ref",
    });
  });
});

describe("buildMentionCandidates", () => {
  const entities = [
    { type: "contact", id: "acme", label: "Acme Corp", icon: "contact" },
    { type: "task", id: "t1", label: "Ship Q3", icon: "task" },
  ];
  const people = [{ memberId: "u-mike", label: "Mike" }];

  it("@ includes people after entities", () => {
    const out = buildMentionCandidates({
      trigger: "mention",
      query: "m",
      entities,
      people,
    });
    expect(out.map((c) => c.kind)).toEqual(["entity", "entity", "person"]);
  });

  it("/ref excludes people and offers create on no exact match", () => {
    const out = buildMentionCandidates({
      trigger: "ref",
      query: "Ship landing page",
      entities,
      people,
      createType: "task",
      canCreate: true,
    });
    expect(out.some((c) => c.kind === "person")).toBe(false);
    const created = out.find((c) => c.kind === "create");
    expect(created).toEqual({
      kind: "create",
      entityType: "task",
      label: "Ship landing page",
    });
  });

  it("suppresses create when an exact label match already exists", () => {
    const out = buildMentionCandidates({
      trigger: "ref",
      query: "  ship q3 ",
      entities,
      createType: "task",
      canCreate: true,
    });
    expect(out.some((c) => c.kind === "create")).toBe(false);
  });

  it("offers no create without a wired creator or for an empty query", () => {
    expect(
      buildMentionCandidates({
        trigger: "ref",
        query: "new thing",
        entities,
        createType: "task",
        canCreate: false,
      }).some((c) => c.kind === "create"),
    ).toBe(false);
    expect(
      buildMentionCandidates({
        trigger: "ref",
        query: "   ",
        entities,
        createType: "task",
        canCreate: true,
      }).some((c) => c.kind === "create"),
    ).toBe(false);
  });
});
