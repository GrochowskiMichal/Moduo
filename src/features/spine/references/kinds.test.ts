// A reference's kind from its stored type (RF-1). Types come from stored or
// typed text (a description's `moduo://type/id` link since call #15), so a
// name that is also an object's own key must read as an unknown item, never
// reach Object.prototype.

import { describe, expect, it } from "@rstest/core";

import { FALLBACK_ENTITY_ICON, resolveEntityIcon } from "../icon-map";
import { deletedLabel, openInLabel, referenceKey, referenceKind, referenceNoun } from "./kinds";

describe("referenceKind", () => {
  it("knows the registry's types and their second names", () => {
    expect(referenceKind("task")).toBe("task");
    expect(referenceKind("email_thread")).toBe("email");
    expect(referenceKind("bucket")).toBe("project");
    expect(referenceKind("widget")).toBe("other");
  });

  it("reads names on Object.prototype as unknown items, without a crash", () => {
    for (const type of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      const kind = referenceKind(type);
      expect(kind).toBe("other");
      expect(referenceNoun(kind)).toBe("item");
      expect(deletedLabel(kind)).toBe("Deleted item");
      expect(openInLabel(kind)).toBeNull();
      expect(referenceKey({ type, id: "x" })).toBe(`${type}:x`);
      // The glyph a reference draws for its type is the fallback, not Object.
      expect(resolveEntityIcon(type)).toBe(FALLBACK_ENTITY_ICON);
      expect(resolveEntityIcon("task", type)).toBe(resolveEntityIcon("task"));
    }
  });
});
