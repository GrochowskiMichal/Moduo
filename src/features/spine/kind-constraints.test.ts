// AC8 proof: the endpoint-pair relation-kind matrix. Person↔person must exclude
// attachment / paid-by / works-at; contact↔company must include works-at; money↔
// party must include paid-by. Symmetric and canonically ordered.

import { describe, expect, it } from "vitest";

import { allowedKinds, coerceKindForPair, isKindAllowed } from "./kind-constraints";
import { RELATION_KINDS } from "../../lib/entity-links";

describe("allowedKinds", () => {
  it("always offers references + mentions for any pair", () => {
    for (const kinds of [allowedKinds("contact", "contact"), allowedKinds("task", "note"), allowedKinds("email", "company")]) {
      expect(kinds).toContain("references");
      expect(kinds).toContain("mentions");
    }
  });

  it("excludes attachment / paid-by / works-at between two people (the Attachment bug)", () => {
    const kinds = allowedKinds("contact", "contact");
    expect(kinds).not.toContain("attachment");
    expect(kinds).not.toContain("paid-by");
    expect(kinds).not.toContain("works-at");
    expect(kinds).not.toContain("blocks");
    // Only the generic kinds are sensible person↔person.
    expect(kinds).toEqual(["references", "mentions"]);
  });

  it("includes works-at only for contact↔company", () => {
    expect(allowedKinds("contact", "company")).toContain("works-at");
    expect(allowedKinds("company", "contact")).toContain("works-at"); // symmetric
    expect(allowedKinds("contact", "contact")).not.toContain("works-at");
    expect(allowedKinds("company", "company")).not.toContain("works-at");
  });

  it("includes paid-by only when one end is money and the other a party", () => {
    expect(allowedKinds("invoice", "contact")).toContain("paid-by");
    expect(allowedKinds("company", "payment")).toContain("paid-by");
    expect(allowedKinds("payment", "task")).not.toContain("paid-by");
    expect(allowedKinds("contact", "contact")).not.toContain("paid-by");
  });

  it("includes attachment only when one end is attachable, never person↔person", () => {
    expect(allowedKinds("file", "task")).toContain("attachment");
    expect(allowedKinds("email", "contact")).toContain("attachment");
    expect(allowedKinds("contact", "contact")).not.toContain("attachment");
    expect(allowedKinds("note", "task")).not.toContain("attachment");
  });

  it("includes blocks only between work items", () => {
    expect(allowedKinds("task", "project")).toContain("blocks");
    expect(allowedKinds("task", "task")).toContain("blocks");
    expect(allowedKinds("task", "contact")).not.toContain("blocks");
  });

  it("includes follow-up when a work item is involved (contact↔task)", () => {
    expect(allowedKinds("contact", "task")).toContain("follow-up");
    expect(allowedKinds("contact", "contact")).not.toContain("follow-up");
  });

  it("note↔task allows spawned-from + references (task lines, NO-5 AC3) — nonsense kinds stay out", () => {
    const kinds = allowedKinds("note", "task");
    expect(kinds).toContain("spawned-from"); // minted from the note
    expect(kinds).toContain("references"); // linked-existing
    expect(kinds).not.toContain("attachment");
    expect(kinds).not.toContain("works-at");
    expect(kinds).not.toContain("paid-by");
    expect(kinds).not.toContain("blocks"); // a note never blocks work
    expect(allowedKinds("task", "note")).toEqual(kinds); // symmetric
  });

  it("is symmetric in its arguments", () => {
    for (const [a, b] of [["contact", "company"], ["email", "task"], ["payment", "contact"]] as const) {
      expect(allowedKinds(a, b)).toEqual(allowedKinds(b, a));
    }
  });

  it("returns kinds in canonical RELATION_KINDS order", () => {
    const kinds = allowedKinds("contact", "task");
    const canonicalOrder = RELATION_KINDS.filter((k) => kinds.includes(k));
    expect(kinds).toEqual(canonicalOrder);
  });
});

describe("coerceKindForPair", () => {
  it("keeps an allowed kind", () => {
    expect(coerceKindForPair("works-at", "contact", "company")).toBe("works-at");
  });

  it("downgrades a disallowed kind to references", () => {
    expect(coerceKindForPair("attachment", "contact", "contact")).toBe("references");
    expect(coerceKindForPair("paid-by", "contact", "contact")).toBe("references");
  });
});

describe("isKindAllowed", () => {
  it("mirrors allowedKinds membership", () => {
    expect(isKindAllowed("works-at", "contact", "company")).toBe(true);
    expect(isKindAllowed("attachment", "contact", "contact")).toBe(false);
  });
});
