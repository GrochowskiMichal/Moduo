import { describe, expect, it } from "@rstest/core";

import { snippetSegments } from "./search-snippet";

const S = "";
const E = "";

describe("snippetSegments (GS-2, the SearchHit snippet markers)", () => {
  it("splits a snippet into plain and marked text", () => {
    expect(snippetSegments(`We tasted a ${S}kumquat${E} at lunch`)).toEqual([
      { text: "We tasted a ", marked: false },
      { text: "kumquat", marked: true },
      { text: " at lunch", marked: false },
    ]);
  });

  it("keeps every mark, including one at either end", () => {
    expect(snippetSegments(`${S}plan${E} and ${S}planning${E}`)).toEqual([
      { text: "plan", marked: true },
      { text: " and ", marked: false },
      { text: "planning", marked: true },
    ]);
  });

  it("reads text without markers as plain, and an empty snippet as nothing", () => {
    expect(snippetSegments("Nothing marked")).toEqual([{ text: "Nothing marked", marked: false }]);
    expect(snippetSegments("")).toEqual([]);
  });

  it("never shows a marker: a stray end is dropped, an unclosed start marks to the end", () => {
    expect(snippetSegments(`a${E}b`)).toEqual([{ text: "ab", marked: false }]);
    expect(snippetSegments(`a ${S}b c`)).toEqual([
      { text: "a ", marked: false },
      { text: "b c", marked: true },
    ]);
    expect(snippetSegments(`${S}${S}x${E}${E}`)).toEqual([{ text: "x", marked: true }]);
  });
});
