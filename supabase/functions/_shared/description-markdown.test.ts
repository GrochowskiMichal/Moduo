// A task's description as Markdown (dogfood call #15, MOD-98 / MOD-120): the
// old HTML descriptions read as Markdown, in the shapes the editor really
// stored, and both forms read as words. The app's own round trip through the
// editor is spine/editor/description-markdown.test.ts.

import { describe, expect, it } from "@rstest/core";

import {
  CONVERT_LIMIT,
  codeRanges,
  dateMarkdown,
  defuseReferences,
  descriptionTokens,
  escapeBlockStarts,
  escapeMarkdownText,
  descriptionPlainText,
  descriptionReferences,
  descriptionToMarkdown,
  guardMarkdownStart,
  htmlToMarkdown,
  isHtmlDescription,
  markdownExcerpt,
  readsAsModuoAddress,
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

  it("decodes entities, and escapes only what Markdown would read as formatting", () => {
    const html = `${P}${span("Q&amp;A &lt;draft&gt; &quot;v2&quot; &#39;ok&#39;&nbsp;&#8212; a*b snake_case")}</p>`;
    expect(htmlToMarkdown(html)).toBe(`Q&A <draft> "v2" 'ok' — a\\*b snake_case`);
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

describe("escapeMarkdownText: only what Markdown would read (call #15's review)", () => {
  it("leaves identifiers, lone stars and tildes, and paths as written", () => {
    expect(escapeMarkdownText("file_name user_id __init__x")).toBe("file_name user_id \\_\\_init\\_\\_x");
    expect(escapeMarkdownText("5 * 3 and a ~ b")).toBe("5 * 3 and a ~ b");
    expect(escapeMarkdownText("C:\\Users\\me")).toBe("C:\\Users\\me");
    expect(escapeMarkdownText("one ` tick", { lonelyBacktick: true })).toBe("one ` tick");
  });

  it("escapes what would start emphasis, strike or code, and the text's own edges", () => {
    expect(escapeMarkdownText("a*b* _x_ ~~y~~ `c`")).toBe("a\\*b\\* \\_x\\_ \\~\\~y\\~\\~ \\`c\\`");
    expect(escapeMarkdownText("_lead and end_")).toBe("\\_lead and end\\_");
    expect(escapeMarkdownText("\\*")).toBe("\\\\\\*");
    expect(escapeMarkdownText("trailing\\")).toBe("trailing\\\\");
  });

  it("block starts in an old HTML paragraph stay words, a list item's too", () => {
    const html =
      `${P}${span("2026. Q4 plan")}</p>${P}${span("- not a list")}<br>${span("&gt; not a quote")}</p>` +
      "<ul><li>- dash inside</li></ul>";
    expect(htmlToMarkdown(html)).toBe(
      "2026\\. Q4 plan\n\n\\- not a list\n\\> not a quote\n\n- \\- dash inside",
    );
    expect(escapeBlockStarts("[ ] box\n1. one\n+ plus")).toBe("\\[ ] box\n1\\. one\n\\+ plus");
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
    // A type named like an object's own key is still just an item.
    expect(referenceMarkdown("constructor", NOTE)).toBe(`[item](moduo://constructor/${NOTE})`);
    expect(htmlToMarkdown(`${P}${span("&constructor; &amp;")}</p>`)).toBe("&constructor; &");
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

  it("cuts Markdown into words and links once, in order, every character kept", () => {
    const md = `a [x](moduo://task/${TASK}) b [Oct 1](moduo://date/2026-10-01)`;
    const tokens = descriptionTokens(md);
    expect(tokens).toEqual([
      { kind: "text", text: "a " },
      { kind: "link", label: "x", type: "task", id: TASK, display: undefined, raw: `[x](moduo://task/${TASK})`, inCode: false },
      { kind: "text", text: " b " },
      { kind: "link", label: "Oct 1", type: "date", id: "2026-10-01", display: undefined, raw: "[Oct 1](moduo://date/2026-10-01)", inCode: false },
    ]);
    // Nested brackets: the inner link is the one read, the rest is words.
    expect(descriptionTokens(`[[x](moduo://task/${TASK})](moduo://task/${NOTE})`).map((t) => t.kind)).toEqual([
      "text",
      "link",
      "text",
    ]);
  });

  it("defuses words that would read as a moduo:// link, in any case, and nothing else", () => {
    expect(defuseReferences(`[x](moduo://task/${TASK})`)).toBe(`[x]&#40;moduo://task/${TASK})`);
    expect(defuseReferences("[x](MODUO:a) [y]( moduo:b) [z](<moduo:c>)")).toBe(
      "[x]&#40;MODUO:a) [y]&#40; moduo:b) [z]&#40;<moduo:c>)",
    );
    expect(defuseReferences("[docs](https://example.com) (moduo://x) moduo:// ]moduo:")).toBe(
      "[docs](https://example.com) (moduo://x) moduo:// ]moduo:",
    );
    // Defused, nothing matches the reference pattern.
    expect(descriptionReferences(defuseReferences(`[x](moduo://task/${TASK})`))).toEqual([]);
  });

  it("reads an address the way a decoding reader does: escapes, character references, <…>, spaces, any case", () => {
    for (const address of [
      "moduo://task/x",
      "moduo\\://task/x",
      "mo\\duo://task/x",
      "moduo&#58;//task/x",
      "moduo&#0000058;//task/x",
      "&#109;oduo://task/x",
      "moduo&#x3A;//task/x",
      "<moduo\\://task/x>",
      "   MoDuO://task/x",
      "moduo&colon;//task/x",
      "moduo&amp;#58;//task/x",
      "moduo&#38;#58;//task/x",
      "moduo&amp;colon;//task/x",
    ]) {
      expect(readsAsModuoAddress(address), address).toBe(true);
      expect(defuseReferences(`[t](${address})`), address).toBe(`[t]&#40;${address})`);
    }
    for (const address of ["https://moduo.app", "modu://x", "moduox://x", "mailto:moduo@x"]) {
      expect(readsAsModuoAddress(address), address).toBe(false);
    }
    expect(defuseReferences(`[t](${" ".repeat(500)}moduo\\://task/x)`)).toContain("]&#40;");
  });

  it("reads an old description's link to a moduo: address as its words, however it's encoded", () => {
    for (const href of [`moduo://task/${TASK}`, `moduo&#38;#58;//task/${TASK}`, `moduo&amp;colon;//task/${TASK}`]) {
      const md = htmlToMarkdown(`${P}${span("see ")}<a href="${href}">the plan</a></p>`);
      expect(md, href).toBe("see the plan");
    }
    expect(htmlToMarkdown(`${P}<a href="https://example.com">docs</a></p>`)).toBe("[docs](https://example.com)");
  });

  it("a quote's paragraphs are one quote's lines; <pre> is a fenced block, as written", () => {
    expect(htmlToMarkdown("<blockquote><p>a</p><p>b</p></blockquote>")).toBe("> a\n> b");
    expect(htmlToMarkdown("<pre><code>const a = 1;\nif (a &lt; 2) { x_y(`t`); }\n</code></pre>")).toBe(
      "```\nconst a = 1;\nif (a < 2) { x_y(`t`); }\n```",
    );
    expect(htmlToMarkdown("<pre>a ``` b</pre>")).toBe("````\na ``` b\n````");
  });

  it("knows which links sit in code (fenced, inline), and finds no references there", () => {
    const md = [
      `See [a](moduo://task/${TASK}) and \`[b](moduo://task/${NOTE})\`.`,
      "```",
      `[c](moduo://note/${NOTE})`,
      "```",
      `\`\`not code [d](moduo://note/${TASK}) \``,
    ].join("\n");
    const links = descriptionTokens(md).flatMap((t) => (t.kind === "link" ? [[t.label, t.inCode]] : []));
    expect(links).toEqual([
      ["a", false],
      ["b", true],
      ["c", true],
      ["d", false],
    ]);
    expect(descriptionReferences(md)).toEqual([
      { type: "task", id: TASK },
      { type: "note", id: TASK },
    ]);
  });

  it("finds code in one pass", () => {
    const text = Array.from({ length: 4_000 }, (_, i) => `${"`".repeat((i % 50) + 1)} x`).join(" ");
    const start = performance.now();
    codeRanges(text);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("defuses a long crafted run in one pass", () => {
    const text = `](${" ".repeat(40)}&#109;`.repeat(20_000);
    const start = performance.now();
    defuseReferences(text);
    expect(performance.now() - start).toBeLessThan(500);
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

describe("a crafted description can't stall a reader (the connector runs this)", () => {
  /** Run `fn` and say how long it took, in ms. */
  function timed(fn: () => unknown): number {
    const start = performance.now();
    fn();
    return performance.now() - start;
  }
  const HTML: Array<[string, string]> = [
    ["a run of <", `<p>${"<".repeat(200_000)}</p>`],
    ["a run of < then one >", `<p>${"<".repeat(200_000)}>`],
    ["tags that never close", `<p>${"<a b=".repeat(60_000)}`],
    ["nesting 100,000 deep", `<p>${"<b><i>".repeat(100_000)}x`],
    ["unclosed quotes in a tag", `<p><span ${'a=" '.repeat(60_000)}>x</span></p>`],
    ["comments that never end", `<p>${"<!--".repeat(60_000)}`],
    ["long whitespace inside words", `<p><b>a${" ".repeat(200_000)}b</b>${"\n ".repeat(50_000)}c</p>`],
    ["a style made of one word", `<p><span style="${"text-decoration".repeat(20_000)}">x</span></p>`],
    ["ampersands", `<p>${"&a".repeat(100_000)}${"&".repeat(100_000)}</p>`],
    ["stars and brackets", `<p>${"*[_`~".repeat(60_000)}</p>`],
    ["a code span of backticks", `<p><code>${"` ".repeat(100_000)}</code></p>`],
    ["a list 10,000 items long", `<ul>${"<li>x</li>".repeat(10_000)}</ul>`],
  ];
  for (const [name, html] of HTML) {
    it(`HTML: ${name}`, () => {
      expect(isHtmlDescription(html)).toBe(true);
      expect(timed(() => htmlToMarkdown(html))).toBeLessThan(1500);
      expect(timed(() => descriptionPlainText(html))).toBeLessThan(1500);
    });
  }
  const MARKDOWN: Array<[string, string]> = [
    ["a run of [", "[".repeat(200_000)],
    ["a run of *", "*".repeat(200_000)],
    ["openers that never close", "**a ".repeat(60_000)],
    ["underscores", "_a ".repeat(60_000)],
    ["links that never close", '[a](x "b'.repeat(40_000)],
    ["pointy links that never close", "[a](<b".repeat(40_000)],
    ["references cut short", `[task](moduo://task/${"a".repeat(30)}`.repeat(20_000)],
    ["spaces", `a${" ".repeat(200_000)}b`],
    ["quote and list markers", "> - [ ] ".repeat(60_000)],
  ];
  for (const [name, md] of MARKDOWN) {
    it(`Markdown: ${name}`, () => {
      expect(timed(() => descriptionPlainText(md))).toBeLessThan(1500);
      expect(timed(() => descriptionReferences(md))).toBeLessThan(1500);
      expect(timed(() => markdownExcerpt(md, 280))).toBeLessThan(50);
    });
  }

  it("converts only the first CONVERT_LIMIT characters; the rest follows as plain words, a stored title dropped", () => {
    const filler = `${P}<b><strong class="font-semibold">Head</strong></b>${span(" words ".repeat(20))}</p>`;
    let html = "";
    while (html.length < CONVERT_LIMIT + 5_000) html += filler;
    html += `${P}<b><strong class="font-semibold">Tail</strong></b>${span(" end ")}<span data-lexical-entity-ref="true" data-entity-type="task" data-entity-id="${TASK}">Acquire Northwind</span></p>`;
    const md = htmlToMarkdown(html);
    expect(md.startsWith("**Head** words")).toBe(true);
    expect(md).toContain("Tail end");
    expect(md).not.toContain("**Tail**");
    expect(md).not.toContain("Northwind");
    expect(md).not.toContain("<");
    // Its reference past the cut is kept, as an address only.
    expect(md).toContain(`[task](moduo://task/${TASK})`);
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
