import { describe, expect, it } from "@rstest/core";

import { groupByLetter, type LetterGroup } from "./letter-index";
import type { Contact } from "./model";

// Tiny helpers — we only exercise `name`, so most tests use bare { name } objects
// (the function is generic over T and only reads via nameOf).
type Named = { name: string };
const byName = (n: Named) => n.name;
const names = (g: LetterGroup<Named>) => g.items.map((i) => i.name);
const letters = (groups: LetterGroup<Named>[]) => groups.map((g) => g.letter);

describe("groupByLetter", () => {
  it("returns [] for empty input", () => {
    expect(groupByLetter<Named>([], byName)).toEqual([]);
  });

  it("buckets mixed names under their uppercased leading letter", () => {
    const groups = groupByLetter([{ name: "Alice" }, { name: "bob" }, { name: "Carol" }], byName);
    expect(letters(groups)).toEqual(["A", "B", "C"]);
    expect(names(groups[0])).toEqual(["Alice"]);
    expect(names(groups[1])).toEqual(["bob"]);
    expect(names(groups[2])).toEqual(["Carol"]);
  });

  it("uppercases lowercase leading letters into the same bucket", () => {
    const groups = groupByLetter([{ name: "anna" }, { name: "Abe" }], byName);
    expect(letters(groups)).toEqual(["A"]);
    // Case-insensitive sort: 'Abe' < 'anna'.
    expect(names(groups[0])).toEqual(["Abe", "anna"]);
  });

  it("sorts groups A→Z", () => {
    const groups = groupByLetter([{ name: "Zed" }, { name: "Mona" }, { name: "Ada" }], byName);
    expect(letters(groups)).toEqual(["A", "M", "Z"]);
  });

  it("places the '#' bucket last", () => {
    const groups = groupByLetter([{ name: "9 Lives" }, { name: "Bea" }, { name: "Amy" }], byName);
    expect(letters(groups)).toEqual(["A", "B", "#"]);
    expect(names(groups[2])).toEqual(["9 Lives"]);
  });

  it("collapses digits, symbols, accented, and non-Latin leads into '#'", () => {
    const groups = groupByLetter(
      [
        { name: "123 Co" }, // digit
        { name: "@handle" }, // symbol
        { name: "Éclair" }, // accented Latin
        { name: "■ Block" }, // symbol glyph
        { name: "東京" }, // CJK
      ],
      byName,
    );
    expect(letters(groups)).toEqual(["#"]);
    expect(groups[0].items).toHaveLength(5);
  });

  it("buckets the empty-string name under '#'", () => {
    const groups = groupByLetter([{ name: "" }, { name: "Sam" }], byName);
    expect(letters(groups)).toEqual(["S", "#"]);
    expect(names(groups[1])).toEqual([""]);
  });

  it("sorts items within a group case-insensitively", () => {
    const groups = groupByLetter(
      [{ name: "art" }, { name: "Apple" }, { name: "ANT" }, { name: "axe" }],
      byName,
    );
    expect(letters(groups)).toEqual(["A"]);
    // base sensitivity → 'ANT' < 'Apple' < 'art' < 'axe'.
    expect(names(groups[0])).toEqual(["ANT", "Apple", "art", "axe"]);
  });

  it("omits empty groups (only buckets that received an item appear)", () => {
    const groups = groupByLetter([{ name: "Bob" }], byName);
    expect(letters(groups)).toEqual(["B"]);
    expect(groups).toHaveLength(1);
  });

  it("mixes letters and '#' across a realistic spread", () => {
    const groups = groupByLetter(
      [
        { name: "_internal" },
        { name: "Charlie" },
        { name: "alice" },
        { name: "42" },
        { name: "Bravo" },
        { name: "Álvaro" }, // accented → '#'
      ],
      byName,
    );
    expect(letters(groups)).toEqual(["A", "B", "C", "#"]);
    expect(names(groups[0])).toEqual(["alice"]);
    expect(names(groups[1])).toEqual(["Bravo"]);
    expect(names(groups[2])).toEqual(["Charlie"]);
    // '#' bucket holds the symbol, digit, and accented leads, name-sorted.
    expect(groups[3].items).toHaveLength(3);
  });

  it("works with the Contact model via a name selector", () => {
    const contact = (name: string): Pick<Contact, "name"> => ({ name });
    const groups = groupByLetter([contact("Dana"), contact("dave"), contact("123")], (c) => c.name);
    expect(groups.map((g) => g.letter)).toEqual(["D", "#"]);
    expect(groups[0].items.map((c) => c.name)).toEqual(["Dana", "dave"]);
  });
});
