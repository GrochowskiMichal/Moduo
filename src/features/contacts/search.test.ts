// FX-1 — the /contacts search-param validator: malformed params are dropped,
// selection only counts as a type+id pair, and the palette action survives.

import { describe, expect, it } from "vitest";
import { validateContactsSearch } from "./search";

describe("validateContactsSearch", () => {
  it("keeps a well-formed selection pair", () => {
    expect(validateContactsSearch({ type: "contact", id: "c1" })).toEqual({
      type: "contact",
      id: "c1",
    });
    expect(validateContactsSearch({ type: "company", id: "co1" })).toEqual({
      type: "company",
      id: "co1",
    });
  });

  it("drops a bare id, a bare type, and unknown types", () => {
    expect(validateContactsSearch({ id: "c1" })).toEqual({});
    expect(validateContactsSearch({ type: "contact" })).toEqual({});
    expect(validateContactsSearch({ type: "task", id: "t1" })).toEqual({});
    expect(validateContactsSearch({ type: "contact", id: "" })).toEqual({});
  });

  it("keeps a valid action and drops anything else", () => {
    expect(validateContactsSearch({ action: "new" })).toEqual({ action: "new" });
    expect(validateContactsSearch({ action: "import" })).toEqual({ action: "import" });
    expect(validateContactsSearch({ action: "delete" })).toEqual({});
  });

  it("passes selection and action through together", () => {
    expect(validateContactsSearch({ type: "contact", id: "c1", action: "new", junk: "x" })).toEqual(
      {
        type: "contact",
        id: "c1",
        action: "new",
      },
    );
  });
});
