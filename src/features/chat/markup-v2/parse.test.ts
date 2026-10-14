import { describe, expect, it } from "@rstest/core";

import { parseInline, parseStored } from "./parse";
import { mentionsOf, toBodyText } from "./text";
import { BOLD, ITALIC, STRIKE } from "./types";

// The construct list (docs/build/chat-v2/CV-0-S4.md §Constructs), one by one:
// what each stored spelling parses to.

const TASK = "0b6f9a8e-3c1d-4e2f-9a7b-1c2d3e4f5a6b";
const ANA = "7cd06b5f-ad8e-4f9a-8be2-8d9eafb0c1d2";
const TEAM = "6bcf5a4e-9c7d-4e8f-9ad1-7c8d9eafb0c1";

describe("inline constructs", () => {
  it("bold, italic, strike, code", () => {
    expect(parseInline("**b** *i* ~~s~~ `c`")).toEqual([
      { t: "text", v: "b", m: BOLD },
      { t: "text", v: " ", m: 0 },
      { t: "text", v: "i", m: ITALIC },
      { t: "text", v: " ", m: 0 },
      { t: "text", v: "s", m: STRIKE },
      { t: "text", v: " ", m: 0 },
      { t: "code", v: "c", m: 0 },
    ]);
  });

  it("nested and intraword emphasis", () => {
    expect(parseInline("***x***")).toEqual([{ t: "text", v: "x", m: BOLD | ITALIC }]);
    expect(parseInline("un*believ*able")).toEqual([
      { t: "text", v: "un", m: 0 },
      { t: "text", v: "believ", m: ITALIC },
      { t: "text", v: "able", m: 0 },
    ]);
  });

  it("asterisks around spaces, unclosed runs and underscores are text", () => {
    expect(parseInline("5 * 3 * 2")).toEqual([{ t: "text", v: "5 * 3 * 2", m: 0 }]);
    expect(parseInline("**open")).toEqual([{ t: "text", v: "**open", m: 0 }]);
    expect(parseInline("_x_ my_var")).toEqual([{ t: "text", v: "_x_ my_var", m: 0 }]);
    expect(parseInline("~a~")).toEqual([{ t: "text", v: "~a~", m: 0 }]);
  });

  it("backslash escapes any ASCII punctuation", () => {
    expect(parseInline("\\*a\\* \\[b] \\\\ \\x")).toEqual([
      { t: "text", v: "*a* [b] \\ \\x", m: 0 },
    ]);
  });

  it("code spans: longer fences, one padding space, nothing parsed inside", () => {
    expect(parseInline("``a`b``")).toEqual([{ t: "code", v: "a`b", m: 0 }]);
    expect(parseInline("`` `x ``")).toEqual([{ t: "code", v: "`x", m: 0 }]);
    expect(parseInline(`\`**x** moduo://task/${TASK}\``)).toEqual([
      { t: "code", v: `**x** moduo://task/${TASK}`, m: 0 },
    ]);
    expect(parseInline("`open")).toEqual([{ t: "text", v: "`open", m: 0 }]);
  });

  it("references: any registry type, exactly a uuid, never a title", () => {
    expect(parseInline(`see moduo://task/${TASK}x`)).toEqual([
      { t: "text", v: "see ", m: 0 },
      { t: "ref", type: "task", id: TASK },
      { t: "text", v: "x", m: 0 },
    ]);
    expect(parseInline(`[Ship it](moduo://task/${TASK})`)).toEqual([
      { t: "ref", type: "task", id: TASK },
    ]);
    expect(parseInline(`moduo://person/${ANA.toUpperCase()}`)).toEqual([
      { t: "ref", type: "person", id: ANA },
    ]);
    expect(parseInline("moduo://task/123")).toEqual([{ t: "text", v: "moduo://task/123", m: 0 }]);
    expect(parseInline(`moduo\\://task/${TASK}`)).toEqual([
      { t: "text", v: `moduo://task/${TASK}`, m: 0 },
    ]);
  });

  it("date chips: a real day only", () => {
    expect(parseInline("moduo://date/2026-10-17")).toEqual([{ t: "date", day: "2026-10-17" }]);
    expect(parseInline("moduo://date/2026-02-30")).toEqual([
      { t: "text", v: "moduo://date/2026-02-30", m: 0 },
    ]);
  });

  it("@channel at a token start as a whole word", () => {
    expect(parseInline("@channel, hi")).toEqual([
      { t: "channel", m: 0 },
      { t: "text", v: ", hi", m: 0 },
    ]);
    expect(parseInline("x@channel @channels")).toEqual([
      { t: "text", v: "x@channel @channels", m: 0 },
    ]);
  });

  it(":custom: emoji, never inside times", () => {
    expect(parseInline("nice :shipit:")).toEqual([
      { t: "text", v: "nice ", m: 0 },
      { t: "emoji", name: "shipit", m: 0 },
    ]);
    expect(parseInline("10:30:45 a:ok:b :+1:")).toEqual([
      { t: "text", v: "10:30:45 a:ok:b :+1:", m: 0 },
    ]);
  });

  it("bare URLs: no trailing punctuation, balanced parentheses", () => {
    expect(parseInline("(see https://en.wikipedia.org/wiki/Mars_(planet)).")).toEqual([
      { t: "text", v: "(see ", m: 0 },
      { t: "url", v: "https://en.wikipedia.org/wiki/Mars_(planet)", m: 0 },
      { t: "text", v: ").", m: 0 },
    ]);
  });

  it("links: http(s) and mailto only, a label of text and code", () => {
    expect(parseInline("[the **docs**](https://moduo.app/a\\(1\\))")).toEqual([
      {
        t: "link",
        href: "https://moduo.app/a(1)",
        c: [
          { t: "text", v: "the ", m: 0 },
          { t: "text", v: "docs", m: BOLD },
        ],
      },
    ]);
    expect(parseInline("[x](javascript:alert(1))")).toEqual([
      { t: "text", v: "[x](javascript:alert(1))", m: 0 },
    ]);
  });

  it("native emoji and Polish are plain text", () => {
    expect(parseInline("👩🏽‍💻 zażółć")).toEqual([{ t: "text", v: "👩🏽‍💻 zażółć", m: 0 }]);
  });
});

describe("block constructs", () => {
  it("lines and blank lines", () => {
    expect(parseStored("a\n\nb")).toEqual([
      {
        t: "p",
        c: [{ t: "text", v: "a", m: 0 }, { t: "br" }, { t: "br" }, { t: "text", v: "b", m: 0 }],
      },
    ]);
  });

  it("quote, code block with a language, lists one level, set off by one blank line", () => {
    expect(parseStored("> q\n\n```ts\nx\n```\n\n- a\n- b\n\n3. c")).toEqual([
      { t: "quote", c: [{ t: "text", v: "q", m: 0 }] },
      { t: "pre", v: "x", lang: "ts" },
      {
        t: "list",
        ordered: false,
        start: 1,
        items: [[{ t: "text", v: "a", m: 0 }], [{ t: "text", v: "b", m: 0 }]],
      },
      { t: "list", ordered: true, start: 3, items: [[{ t: "text", v: "c", m: 0 }]] },
    ]);
  });

  it("an item continues on lines indented to its text", () => {
    expect(parseStored("10. a\n    b")).toEqual([
      {
        t: "list",
        ordered: true,
        start: 10,
        items: [[{ t: "text", v: "a", m: 0 }, { t: "br" }, { t: "text", v: "b", m: 0 }]],
      },
    ]);
  });

  it("the empty message is no blocks", () => {
    expect(parseStored("")).toEqual([]);
  });
});

describe("body_text and mentions", () => {
  const tree = parseStored(
    `Hey moduo://person/${ANA} and moduo://team/${TEAM}, **ship** moduo://task/${TASK} by moduo://date/2026-10-20 [docs](https://x.com) @channel :tada:\n\n\`\`\`\ncode\n\`\`\``,
  );

  it("strips syntax and URIs, keeps words", () => {
    expect(toBodyText(tree)).toBe("Hey  and , ship  by  docs @channel :tada:\ncode");
  });

  it("lists people, teams, @channel and items once each", () => {
    expect(mentionsOf(tree)).toEqual({
      people: [ANA],
      teams: [TEAM],
      channel: true,
      refs: [{ type: "task", id: TASK }],
    });
  });
});
