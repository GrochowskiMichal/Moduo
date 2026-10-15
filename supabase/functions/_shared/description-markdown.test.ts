// A task's description as Markdown (dogfood call #15, MOD-98 / MOD-120): the
// old HTML descriptions read as Markdown, in the shapes the editor really
// stored, and both forms read as words. The app's own round trip through the
// editor is spine/editor/description-markdown.test.ts.

import { describe, expect, it } from "@rstest/core";

import {
  dateMarkdown,
  descriptionPlainText,
  descriptionReferences,
  descriptionToMarkdown,
  guardMarkdownStart,
  htmlToMarkdown,
  isHtmlDescription,
  markdownExcerpt,
  referenceMarkdown,
} from "./description-markdown.ts";

const P = '<p class="mb-2 last:mb-0">';
const span = (text: string) => `<span style="white-space: pre-wrap;">${text}</span>`;
const TASK = "11111111-1111-4111-8111-111111111111";
const NOTE = "22222222-2222-4222-8222-222222222222";

describe("isHtmlDescription", () => {
  it("knows the editor's HTML by its first tag", () => {
    expect(isHtmlDescription(`${P}${span("x")}</p>`)).toBe(true);
    expect(isHtmlDescription("  <ul><li>x</li></ul>")).toBe(true);
    expect(isHtmlDescription("<p>x</p>")).toBe(true);
  });

  it("leaves Markdown and plain text alone, a Markdown autolink too", () => {
    expect(isHtmlDescription("**bold**")).toBe(false);
    expect(isHtmlDescription("<https://moduo.app> is the site")).toBe(false);
    expect(isHtmlDescription("x < y")).toBe(false);
    expect(isHtmlDescription("")).toBe(false);
    expect(isHtmlDescription(null)).toBe(false);
  });
});

describe("htmlToMarkdown: the shapes the editor stored", () => {
  it("reads MOD-98's description as its words", () => {
    // Stored on prod, word for word.
    const stored =
      '<p class="mb-2 last:mb-0"><span style="white-space: pre-wrap;">But they work in the task title, and in the details panel\'s description box. Weird.</span></p>';
    expect(htmlToMarkdown(stored)).toBe(
      "But they work in the task title, and in the details panel's description box. Weird.",
    );
  });

  it("paragraphs are blocks, <br> a line break, an empty paragraph nothing", () => {
    const html = `${P}${span("One")}<br>${span("two")}</p>${P}<br></p>${P}${span("Three")}</p>`;
    expect(htmlToMarkdown(html)).toBe("One\ntwo\n\nThree");
  });

  it("decodes entities, and escapes what Markdown would read as formatting", () => {
    const html = `${P}${span("Q&amp;A &lt;draft&gt; &quot;v2&quot; &#39;ok&#39;&nbsp;&#8212; a*b snake_case")}</p>`;
    expect(htmlToMarkdown(html)).toBe(`Q&A <draft> "v2" 'ok' — a\\*b snake\\_case`);
  });

  it("keeps bold, italic, both, strikethrough and code; underline has no Markdown", () => {
    const html =
      `${P}<b><strong class="font-semibold" style="white-space: pre-wrap;">bold</strong></b>${span(" ")}` +
      `<i><em class="italic" style="white-space: pre-wrap;">it</em></i>${span(" ")}` +
      `<i><b><strong class="font-semibold italic" style="white-space: pre-wrap;">both</strong></b></i>${span(" ")}` +
      `<s><span class="line-through" style="white-space: pre-wrap;">gone</span></s>${span(" ")}` +
      `<u><span class="underline" style="white-space: pre-wrap;">under</span></u>${span(" ")}` +
      `<code spellcheck="false" style="white-space: pre-wrap;"><span>npm i</span></code></p>`;
    expect(htmlToMarkdown(html)).toBe("**bold** *it* ***both*** ~~gone~~ under `npm i`");
  });

  it("puts the spaces around a format outside its markers", () => {
    const html = `${P}${span("a")}<b><strong class="font-semibold"> b </strong></b>${span("c")}</p>`;
    expect(htmlToMarkdown(html)).toBe("a **b** c");
  });

  it("a reference keeps its address and how it shows, never its stored title (RF-1)", () => {
    const html =
      `${P}${span("See ")}<span data-lexical-entity-ref="true" data-entity-type="task" data-entity-id="${TASK}" data-ref-v="2">task</span>` +
      `${span(" and ")}<span data-lexical-entity-ref="true" data-entity-type="note" data-entity-id="${NOTE}" data-display="card">Acquire Northwind</span></p>`;
    const md = htmlToMarkdown(html);
    expect(md).toBe(`See [task](moduo://task/${TASK}) and [note](moduo://note/${NOTE} "card")`);
    expect(md).not.toContain("Northwind");
  });

  it("a reference without an address is dropped, title and all", () => {
    const html = `${P}${span("x ")}<span data-lexical-entity-ref="true" data-entity-type="task">Secret plan</span></p>`;
    expect(htmlToMarkdown(html)).toBe("x");
  });

  it("a date chip keeps its day", () => {
    const html = `${P}${span("Due ")}<time data-moduo-date="2026-10-17" datetime="2026-10-17">Oct 17</time></p>`;
    expect(htmlToMarkdown(html)).toBe("Due [Oct 17](moduo://date/2026-10-17)");
  });

  it("lists: bullets, numbers from their start, nesting, checkboxes", () => {
    const html =
      "<ul><li>One</li><li>Two<ul><li>Two a</li></ul></li></ul>" +
      '<ol start="3"><li value="3">Three</li><li value="4"><p>Four</p></li></ol>' +
      '<ul><li role="checkbox" aria-checked="false">Open</li><li role="checkbox" aria-checked="true">Done</li></ul>';
    expect(htmlToMarkdown(html)).toBe(
      "- One\n- Two\n  - Two a\n\n3. Three\n4. Four\n\n- [ ] Open\n- [x] Done",
    );
  });

  it("links keep their address; quotes their marker", () => {
    const html =
      `${P}<a href="https://example.com/a_(b)">the docs</a>${span(" and ")}<a href="https://x.y/a b">spaced</a></p>` +
      `<blockquote>${span("Said so")}</blockquote>`;
    expect(htmlToMarkdown(html)).toBe(
      "[the docs](https://example.com/a_\\(b\\)) and [spaced](<https://x.y/a b>)\n\n> Said so",
    );
  });

  it("drops scripts and unknown attributes, keeps the words of unknown tags", () => {
    const html = `${P}<script>alert(1)</script><font color="red">red words</font></p>`;
    expect(htmlToMarkdown(html)).toBe("red words");
  });

  it("words that would read as HTML again keep their first < escaped", () => {
    expect(htmlToMarkdown(`${P}${span("&lt;span&gt; wraps wrong")}</p>`)).toBe("\\<span> wraps wrong");
    expect(guardMarkdownStart("<b> is bold")).toBe("\\<b> is bold");
    expect(guardMarkdownStart("fine <b>")).toBe("fine <b>");
  });
});

describe("descriptionToMarkdown", () => {
  it("converts HTML and passes Markdown and plain text through", () => {
    expect(descriptionToMarkdown(`${P}${span("x")}</p>`)).toBe("x");
    expect(descriptionToMarkdown("**Adding an issue**\n- one")).toBe("**Adding an issue**\n- one");
    expect(descriptionToMarkdown(undefined)).toBe("");
  });
});

describe("the reference syntax", () => {
  it("labels a reference with its kind, and says how it shows only when it isn't a chip", () => {
    expect(referenceMarkdown("task", TASK)).toBe(`[task](moduo://task/${TASK})`);
    expect(referenceMarkdown("task", TASK, "chip")).toBe(`[task](moduo://task/${TASK})`);
    expect(referenceMarkdown("email_thread", NOTE, "link")).toBe(
      `[email](moduo://email_thread/${NOTE} "link")`,
    );
    expect(referenceMarkdown("widget", NOTE, "nonsense")).toBe(`[item](moduo://widget/${NOTE})`);
    expect(dateMarkdown("2026-10-17", "Oct 17")).toBe("[Oct 17](moduo://date/2026-10-17)");
  });

  it("finds the items a description references, each once, dates aside, in either form", () => {
    const md = `[task](moduo://task/${TASK}) [x](moduo://task/${TASK}) [n](moduo://note/${NOTE} "card") [Oct 1](moduo://date/2026-10-01)`;
    expect(descriptionReferences(md)).toEqual([
      { type: "task", id: TASK },
      { type: "note", id: NOTE },
    ]);
    const html = `${P}<span data-lexical-entity-ref="true" data-entity-type="task" data-entity-id="${TASK}" data-ref-v="2">task</span></p>`;
    expect(descriptionReferences(html)).toEqual([{ type: "task", id: TASK }]);
  });
});

describe("descriptionPlainText (search, the Board card's preview)", () => {
  it("reads Markdown as words: no symbols, references left out, a date as its date, a link as its text", () => {
    const md =
      "**Adding an issue**\n- Put it in **Triage**. One *problem* per `task`.\n1. ~~old~~ step\n- [x] done\n> quoted\n" +
      `See [task](moduo://task/${TASK} "card") by [Oct 17](moduo://date/2026-10-17), [the docs](https://x.y). snake_case, a\\*b`;
    const words = descriptionPlainText(md).replace(/\s+/g, " ").trim();
    expect(words).toBe(
      "Adding an issue Put it in Triage. One problem per task. old step done quoted See by Oct 17, the docs. snake_case, a*b",
    );
  });

  it("reads the old HTML the same way, never its markup or a reference's stored title", () => {
    const html = `${P}${span("Fix the ")}<b><strong class="font-semibold">pre</strong></b>${span(" span")}<span data-lexical-entity-ref="true" data-entity-type="task" data-entity-id="${TASK}">Acquire Northwind</span></p>`;
    const words = descriptionPlainText(html);
    expect(words.replace(/\s+/g, " ").trim()).toBe("Fix the pre span");
    expect(words).not.toContain("strong");
    expect(words).not.toContain("Northwind");
  });
});

describe("markdownExcerpt (the connector's 280 characters)", () => {
  it("never ends in half a reference", () => {
    const md = `Notes ${"x".repeat(10)} see [task](moduo://task/${TASK}) after`;
    const cut = md.indexOf("moduo://") + 10;
    expect(markdownExcerpt(md, cut)).toBe(`Notes ${"x".repeat(10)} see`);
    expect(markdownExcerpt(md, md.length)).toBe(md);
    expect(markdownExcerpt("abcdef", 3)).toBe("abc");
  });
});
