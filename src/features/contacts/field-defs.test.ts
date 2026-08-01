// AC11 proof: single-select custom-field option parsing/serialization round-trips,
// and a stored value missing from the def's options is preserved (still renders,
// still selectable — never silently dropped).

import { describe, expect, it } from "vitest";

import { parseFieldOptions, selectOptionsFor, serializeFieldOptions } from "./field-defs";
import type { ContactFieldDef } from "./model";

function def(options: string[]): ContactFieldDef {
  return {
    id: "f1",
    workspaceId: "w",
    key: "region",
    label: "Region",
    type: "select",
    options,
    position: 0,
  };
}

describe("parseFieldOptions", () => {
  it("splits, trims, drops blanks, and dedupes preserving order", () => {
    expect(parseFieldOptions("EMEA, APAC, ,EMEA ,AMER,")).toEqual(["EMEA", "APAC", "AMER"]);
  });

  it("returns [] for empty / whitespace / undefined-ish input", () => {
    expect(parseFieldOptions("")).toEqual([]);
    expect(parseFieldOptions("   ,  , ")).toEqual([]);
  });
});

describe("serializeFieldOptions", () => {
  it("round-trips through parseFieldOptions", () => {
    const options = ["EMEA", "APAC", "AMER"];
    expect(parseFieldOptions(serializeFieldOptions(options))).toEqual(options);
  });
});

describe("selectOptionsFor", () => {
  it("returns the def's options for a value already in the list", () => {
    expect(selectOptionsFor(def(["EMEA", "APAC"]), "EMEA")).toEqual(["EMEA", "APAC"]);
  });

  it("appends a stored value missing from the options (preserved, still selectable)", () => {
    expect(selectOptionsFor(def(["EMEA", "APAC"]), "AMER")).toEqual(["EMEA", "APAC", "AMER"]);
  });

  it("returns the options unchanged for a blank value", () => {
    expect(selectOptionsFor(def(["EMEA", "APAC"]), "")).toEqual(["EMEA", "APAC"]);
  });
});
