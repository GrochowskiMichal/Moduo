// The spike-4 corpus (docs/build/chat-v2/CV-0-S4.md): editor states built
// straight from Lexical's API (never through the bridge's import, so the round
// trip is checked against an independent construction), each with the stored
// text it must export to. `canonical: true` marks the cases where the editor
// holds something the stored form normalises (the change is the point of the
// case); every other case must come back node for node. Test-only.

import { $createCodeNode } from "@lexical/code";
import { $createAutoLinkNode, $createLinkNode } from "@lexical/link";
import { $createListItemNode, $createListNode } from "@lexical/list";
import { $createQuoteNode } from "@lexical/rich-text";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTabNode,
  $createTextNode,
  type LexicalNode,
} from "lexical";

import { $createDateNode } from "../../spine/references/date-node";
import { $createReferenceNode } from "../../spine/references/reference-node";
import type { ReferenceDisplay } from "../../spine/references/types";

export type Build = () => LexicalNode;
export type EditorCase = {
  name: string;
  doc: Build[];
  stored: string;
  /** The editor holds a shape the stored form normalises (documented per case). */
  canonical?: true;
};

// ── the builder ─────────────────────────────────────────────────────────────

export const B = 1;
export const I = 2;
export const S = 4;
export const U = 8; // underline: not in the stored form
export const C = 16;
export const HL = 128; // highlight: not in the stored form

export const t =
  (v: string, format = 0): Build =>
  () =>
    $createTextNode(v).setFormat(format);
export const tab =
  (format = 0): Build =>
  () =>
    $createTabNode().setFormat(format);
export const br: Build = () => $createLineBreakNode();
export const ref =
  (type: string, id: string, display: ReferenceDisplay = "chip"): Build =>
  () =>
    $createReferenceNode({ entityType: type, entityId: id, display });
export const day =
  (d: string): Build =>
  () =>
    $createDateNode(d);
export const link =
  (url: string, ...children: Build[]): Build =>
  () =>
    $createLinkNode(url).append(...children.map((c) => c()));
export const autolink =
  (url: string): Build =>
  () =>
    $createAutoLinkNode(url).append($createTextNode(url));
export const P =
  (...children: Build[]): Build =>
  () =>
    $createParagraphNode().append(...children.map((c) => c()));
export const Q =
  (...children: Build[]): Build =>
  () =>
    $createQuoteNode().append(...children.map((c) => c()));
export const LI =
  (...children: Build[]): Build =>
  () =>
    $createListItemNode().append(...children.map((c) => c()));
export const UL =
  (...items: Build[][]): Build =>
  () =>
    $createListNode("bullet").append(...items.map((item) => LI(...item)()));
export const OL =
  (start: number, ...items: Build[][]): Build =>
  () =>
    $createListNode("number", start).append(...items.map((item) => LI(...item)()));
/** A list whose first item holds a nested list (two levels, flattened by the stored form). */
export const NESTED =
  (outer: Build[], inner: Build[][]): Build =>
  () =>
    $createListNode("bullet").append(
      LI(...outer)(),
      $createListItemNode().append(
        $createListNode("bullet").append(...inner.map((i) => LI(...i)())),
      ),
    );
export const CODE =
  (lang: string | null, text: string): Build =>
  () => {
    const code = $createCodeNode(lang);
    text.split("\n").forEach((line, i) => {
      if (i > 0) code.append($createLineBreakNode());
      line.split(/(\t)/).forEach((part) => {
        if (part === "\t") code.append($createTabNode());
        else if (part) code.append($createTextNode(part));
      });
    });
    return code;
  };

// ── ids ─────────────────────────────────────────────────────────────────────

export const ID = {
  task: "0b6f9a8e-3c1d-4e2f-9a7b-1c2d3e4f5a6b",
  note: "1c7a0b9f-4d2e-4f3a-8b8c-2d3e4f5a6b7c",
  contact: "2d8b1c0a-5e3f-4a4b-9c9d-3e4f5a6b7c8d",
  event: "3e9c2d1b-6f4a-4b5c-8dae-4f5a6b7c8d9e",
  email: "4fad3e2c-7a5b-4c6d-9ebf-5a6b7c8d9eaf",
  project: "5abe4f3d-8b6c-4d7e-8fc0-6b7c8d9eafb0",
  team: "6bcf5a4e-9c7d-4e8f-9ad1-7c8d9eafb0c1",
  person: "7cd06b5f-ad8e-4f9a-8be2-8d9eafb0c1d2",
  person2: "8de17c6a-be9f-4a0b-9cf3-9eafb0c1d2e3",
  channel: "9ef28d7b-cfa0-4b1c-8d04-afb0c1d2e3f4",
  message: "aff39e8c-d0b1-4c2d-9e15-b0c1d2e3f4a5",
  tag: "b0a4af9d-e1c2-4d3e-8f26-c1d2e3f4a5b6",
};

/** RF-1's stored type for each kind (a project is `bucket`, an email `email_thread`). */
export const REF_TYPES: Array<[string, string]> = [
  ["task", ID.task],
  ["note", ID.note],
  ["contact", ID.contact],
  ["event", ID.event],
  ["email_thread", ID.email],
  ["bucket", ID.project],
  ["team", ID.team],
  ["person", ID.person],
  ["chat_channel", ID.channel],
  ["chat_message", ID.message],
];

/** Kinds RF-1 can show as a card when alone on a line (kinds.ts canShowAsCard). */
export const CARD_TYPES = new Set(["task", "note", "contact", "event", "email_thread", "bucket"]);

const uri = (type: string, id: string) => `moduo://${type}/${id}`;

// ── 1. inline constructs × containers (generated) ─────────────────────────────

type Inline = { name: string; nodes: Build[]; line: string; canonical?: true };

const INLINES: Inline[] = [
  { name: "plain", nodes: [t("Hello world")], line: "Hello world" },
  { name: "bold", nodes: [t("Ship "), t("it", B), t(" today")], line: "Ship **it** today" },
  { name: "italic", nodes: [t("so "), t("very", I), t(" nice")], line: "so *very* nice" },
  {
    name: "strike",
    nodes: [t("not "), t("this", S), t(" but that")],
    line: "not ~~this~~ but that",
  },
  { name: "inline code", nodes: [t("run "), t("bun test", C)], line: "run `bun test`" },
  { name: "bold italic", nodes: [t("very", B | I)], line: "***very***" },
  { name: "bold strike", nodes: [t("old", B | S), t(" new")], line: "~~**old**~~ new" },
  { name: "all three", nodes: [t("loud", B | I | S)], line: "~~***loud***~~" },
  { name: "bold code", nodes: [t("npm i", B | C)], line: "**`npm i`**" },
  { name: "intraword italic", nodes: [t("un"), t("believ", I), t("able")], line: "un*believ*able" },
  { name: "bold then italic", nodes: [t("a", B), t("b", I)], line: "**a***b*" },
  {
    // Bold and italic overlap, so italic closes and reopens before " c": the
    // space can't open it and loses italic (invisible).
    name: "overlapping marks",
    nodes: [t("a ", B), t("b", B | I), t(" c", I)],
    line: "**a *b*** *c*",
    canonical: true,
  },
  { name: "literal asterisks", nodes: [t("2*3*4 = 24")], line: "2\\*3\\*4 = 24" },
  { name: "literal backticks", nodes: [t("type `x` here")], line: "type \\`x\\` here" },
  {
    name: "polish",
    nodes: [t("Zażółć "), t("gęślą", B), t(" jaźń")],
    line: "Zażółć **gęślą** jaźń",
  },
];

const CONTAINERS: Array<{ name: string; wrap: (n: Build[]) => Build; prefix: string }> = [
  { name: "paragraph", wrap: (n) => P(...n), prefix: "" },
  { name: "quote", wrap: (n) => Q(...n), prefix: "> " },
  { name: "bullet item", wrap: (n) => UL(n), prefix: "- " },
  { name: "numbered item", wrap: (n) => OL(1, n), prefix: "1. " },
];

const generated: EditorCase[] = CONTAINERS.flatMap((container) =>
  INLINES.map((inline) => ({
    name: `${inline.name} in a ${container.name}`,
    doc: [container.wrap(inline.nodes)],
    stored: container.prefix + inline.line,
    ...(inline.canonical ? { canonical: true as const } : {}),
  })),
);

// ── 2. references, for every kind, where they sit (generated) ─────────────────

const references: EditorCase[] = REF_TYPES.flatMap(([type, id]): EditorCase[] => [
  {
    name: `${type} reference in running text`,
    doc: [P(t("see "), ref(type, id), t(" now"))],
    stored: `see ${uri(type, id)} now`,
  },
  {
    name: `${type} reference alone on its line`,
    doc: [P(t("Look:"), br, ref(type, id, CARD_TYPES.has(type) ? "card" : "chip"))],
    stored: `Look:\n${uri(type, id)}`,
  },
  {
    name: `${type} reference in a list item`,
    doc: [UL([ref(type, id)], [t("next")])],
    stored: `- ${uri(type, id)}\n- next`,
  },
]);

// ── 3. hand-made cases ────────────────────────────────────────────────────────

const hand: EditorCase[] = [
  // code spans
  { name: "code with one backtick", doc: [P(t("a`b", C))], stored: "``a`b``" },
  { name: "code with two backticks", doc: [P(t("x``y", C))], stored: "```x``y```" },
  { name: "code starting with a backtick", doc: [P(t("`x", C))], stored: "`` `x ``" },
  { name: "code with outer spaces", doc: [P(t(" a ", C))], stored: "`  a  `" },
  { name: "code of spaces only", doc: [P(t("  ", C))], stored: "`  `" },
  {
    name: "code holding Markdown",
    doc: [P(t("**not bold** [x](y)", C))],
    stored: "`**not bold** [x](y)`",
  },
  {
    name: "code holding a Moduo URI",
    doc: [P(t(uri("task", ID.task), C))],
    stored: `\`${uri("task", ID.task)}\``,
  },
  {
    name: "code next to code with another mark",
    doc: [P(t("a", C), t("b", C | B))],
    stored: "`a`**`b`**",
  },
  { name: "code then a literal backtick", doc: [P(t("a", C), t("`"))], stored: "`a`\\`" },
  // code blocks
  {
    name: "code block",
    doc: [CODE(null, "const a = 1;\nconst b = 2;")],
    stored: "```\nconst a = 1;\nconst b = 2;\n```",
  },
  {
    name: "code block with a language",
    doc: [CODE("ts", "let x: number = 1")],
    stored: "```ts\nlet x: number = 1\n```",
  },
  {
    name: "code block holding a fence",
    doc: [CODE("md", "```js\nx\n```")],
    stored: "````md\n```js\nx\n```\n````",
  },
  {
    name: "code block with blank lines and trailing spaces",
    doc: [CODE(null, "a  \n\n  b")],
    stored: "```\na  \n\n  b\n```",
  },
  {
    name: "code block with tabs",
    doc: [CODE("go", "func x() {\n\treturn\n}")],
    stored: "```go\nfunc x() {\n\treturn\n}\n```",
  },
  {
    name: "code block holding Markdown and URIs",
    doc: [CODE(null, `**x** ${uri("task", ID.task)} @channel`)],
    stored: `\`\`\`\n**x** ${uri("task", ID.task)} @channel\n\`\`\``,
  },
  {
    name: "text, code block, text",
    doc: [P(t("Before")), CODE("sh", "ls -la"), P(t("After"))],
    stored: "Before\n\n```sh\nls -la\n```\n\nAfter",
  },
  { name: "empty code block", doc: [CODE(null, "")], stored: "```\n```" },
  {
    name: "code block language c++",
    doc: [CODE("c++", "int main() {}")],
    stored: "```c++\nint main() {}\n```",
  },
  // references beyond kinds
  {
    name: "two references side by side",
    doc: [P(ref("task", ID.task), t(" "), ref("note", ID.note))],
    stored: `${uri("task", ID.task)} ${uri("note", ID.note)}`,
  },
  {
    name: "reference glued to text",
    doc: [P(t("x"), ref("task", ID.task), t("y"))],
    stored: `x${uri("task", ID.task)}y`,
  },
  {
    name: "reference glued to hex-looking text",
    doc: [P(ref("task", ID.task), t("-1a"))],
    stored: `${uri("task", ID.task)}-1a`,
  },
  {
    name: "reference inside bold text",
    doc: [P(t("see ", B), ref("task", ID.task), t(" now", B))],
    stored: `**see** ${uri("task", ID.task)} **now**`,
    canonical: true,
  },
  {
    name: "reference in a quote",
    doc: [Q(t("from "), ref("chat_message", ID.message))],
    stored: `> from ${uri("chat_message", ID.message)}`,
  },
  {
    name: "card then text on the next line",
    doc: [P(ref("task", ID.task, "card"), br, t("Thoughts?"))],
    stored: `${uri("task", ID.task)}\nThoughts?`,
  },
  {
    name: "a card shown as a chip comes back a card",
    doc: [P(ref("task", ID.task, "chip"))],
    stored: uri("task", ID.task),
    canonical: true,
  },
  {
    name: "a chip shown as a card in text comes back a chip",
    doc: [P(t("see "), ref("note", ID.note, "card"))],
    stored: `see ${uri("note", ID.note)}`,
    canonical: true,
  },
  {
    name: "tag reference reads as a link",
    doc: [P(t("filed under "), ref("tag", ID.tag, "link"))],
    stored: `filed under ${uri("tag", ID.tag)}`,
  },
  {
    name: "literal Moduo URI typed as text",
    doc: [P(t(`see ${uri("task", ID.task)}`))],
    stored: `see moduo\\://task/${ID.task}`,
  },
  {
    name: "person mentions",
    doc: [P(t("hey "), ref("person", ID.person), t(" and "), ref("person", ID.person2), t("!"))],
    stored: `hey ${uri("person", ID.person)} and ${uri("person", ID.person2)}!`,
  },
  {
    name: "team mention",
    doc: [P(ref("team", ID.team), t(" please review"))],
    stored: `${uri("team", ID.team)} please review`,
  },
  // @channel
  {
    name: "@channel at the start",
    doc: [P(t("@channel standup moved"))],
    stored: "@channel standup moved",
  },
  {
    name: "@channel mid-sentence",
    doc: [P(t("hi @channel, lunch?"))],
    stored: "hi @channel, lunch?",
  },
  { name: "@channels is a word", doc: [P(t("all @channels"))], stored: "all @channels" },
  { name: "email-like @channel", doc: [P(t("x@channel.com"))], stored: "x@channel.com" },
  { name: "bold @channel", doc: [P(t("@channel", B), t(" now"))], stored: "**@channel** now" },
  {
    name: "@channel in a quote and a list",
    doc: [Q(t("@channel")), UL([t("@channel ping")])],
    stored: "> @channel\n\n- @channel ping",
  },
  { name: "@channel in code stays code", doc: [P(t("@channel", C))], stored: "`@channel`" },
  // date chips
  {
    name: "date chip in text",
    doc: [P(t("due "), day("2026-10-17"))],
    stored: "due moduo://date/2026-10-17",
  },
  { name: "date chip alone", doc: [P(day("2026-12-31"))], stored: "moduo://date/2026-12-31" },
  {
    name: "date chip glued to digits",
    doc: [P(day("2026-10-17"), t("12"))],
    stored: "moduo://date/2026-10-1712",
  },
  {
    name: "two date chips",
    doc: [P(day("2026-10-17"), t("–"), day("2026-10-19"))],
    stored: "moduo://date/2026-10-17–moduo://date/2026-10-19",
  },
  {
    name: "date chip in a list",
    doc: [OL(1, [t("ship "), day("2027-01-04")])],
    stored: "1. ship moduo://date/2027-01-04",
  },
  // custom emoji and native emoji
  { name: "custom emoji", doc: [P(t("nice :shipit:"))], stored: "nice :shipit:" },
  {
    name: "custom emoji with + and -",
    doc: [P(t(":party-parrot: :+1x:"))],
    stored: ":party-parrot: :+1x:",
  },
  { name: "times stay text", doc: [P(t("at 10:30:45 sharp"))], stored: "at 10:30:45 sharp" },
  { name: "custom emoji glued to letters", doc: [P(t("a:ok:b"))], stored: "a:ok:b" },
  { name: "bold custom emoji", doc: [P(t(":tada:", B))], stored: "**:tada:**" },
  { name: "native emoji", doc: [P(t("👍 ✅ 👀"))], stored: "👍 ✅ 👀" },
  { name: "emoji sequences", doc: [P(t("👩🏽‍💻 🇵🇱 ❤️‍🔥 1️⃣"))], stored: "👩🏽‍💻 🇵🇱 ❤️‍🔥 1️⃣" },
  { name: "emoji in bold", doc: [P(t("🎉 done", B))], stored: "**🎉 done**" },
  // Polish
  {
    name: "polish with marks inside words",
    doc: [P(t("zaż"), t("ółć", I), t(" gęś"), t("lą", B))],
    stored: "zaż*ółć* gęś**lą**",
  },
  { name: "polish capitals", doc: [P(t("ŻÓŁW ĄĘ Ś Ć Ń Ź"))], stored: "ŻÓŁW ĄĘ Ś Ć Ń Ź" },
  {
    name: "polish in a link label",
    doc: [P(link("https://pl.wikipedia.org/wiki/Żółw", t("żółw")))],
    stored: "[żółw](https://pl.wikipedia.org/wiki/Żółw)",
  },
  {
    name: "polish list",
    doc: [UL([t("jabłka")], [t("gruszki", B)], [t("śliwki")])],
    stored: "- jabłka\n- **gruszki**\n- śliwki",
  },
  // URLs and links
  {
    name: "bare URL",
    doc: [P(t("see https://moduo.app/docs"))],
    stored: "see https://moduo.app/docs",
  },
  {
    name: "URL with trailing period",
    doc: [P(t("Go to https://moduo.app."))],
    stored: "Go to https://moduo.app.",
  },
  {
    name: "URL with parentheses",
    doc: [P(t("(https://en.wikipedia.org/wiki/Mars_(planet))"))],
    stored: "(https://en.wikipedia.org/wiki/Mars_(planet))",
  },
  {
    name: "URL with brackets and query",
    doc: [P(t("https://x.com/a?b[0]=1&c=[2]"))],
    stored: "https://x.com/a?b\\[0]=1&c=\\[2]",
  },
  {
    name: "URL with underscores and tilde",
    doc: [P(t("https://x.com/~me/my_file_v2"))],
    stored: "https://x.com/~me/my_file_v2",
  },
  {
    name: "URL with an asterisk",
    doc: [P(t("https://x.com/*/all"))],
    stored: "https://x.com/\\*/all",
  },
  { name: "bold URL", doc: [P(t("https://moduo.app", B))], stored: "**https://moduo.app**" },
  {
    name: "link with a label",
    doc: [P(t("read "), link("https://moduo.app/docs", t("the docs")))],
    stored: "read [the docs](https://moduo.app/docs)",
  },
  {
    name: "link with a bold label",
    doc: [P(link("https://moduo.app", t("Moduo", B)))],
    stored: "[**Moduo**](https://moduo.app)",
  },
  {
    name: "link whose URL has parentheses",
    doc: [P(link("https://x.com/a_(b)", t("wiki")))],
    stored: "[wiki](https://x.com/a_\\(b\\))",
  },
  {
    name: "link whose URL has a space is no link",
    doc: [P(link("https://x.com/a b", t("odd")))],
    stored: "odd",
    canonical: true,
  },
  {
    name: "link whose URL has encoded spaces",
    doc: [P(link("https://x.com/a%20b", t("ok")))],
    stored: "[ok](https://x.com/a%20b)",
  },
  {
    name: "link whose label has brackets",
    doc: [P(link("https://x.com", t("[draft] v2")))],
    stored: "[\\[draft\\] v2](https://x.com)",
  },
  {
    name: "link label holding code",
    doc: [P(link("https://x.com", t("run "), t("make", C)))],
    stored: "[run `make`](https://x.com)",
  },
  {
    name: "link whose text is its URL",
    doc: [P(link("https://moduo.app", t("https://moduo.app")))],
    stored: "[https://moduo.app](https://moduo.app)",
  },
  {
    name: "mailto link",
    doc: [P(link("mailto:hi@moduo.app", t("write us")))],
    stored: "[write us](mailto:hi@moduo.app)",
  },
  {
    name: "unsafe link keeps its text only",
    doc: [P(link("javascript:alert(1)", t("click")))],
    stored: "click",
    canonical: true,
  },
  {
    name: "auto-link node is text",
    doc: [P(t("see "), autolink("https://moduo.app"))],
    stored: "see https://moduo.app",
    canonical: true,
  },
  {
    name: "link inside bold text",
    doc: [P(t("see ", B), link("https://x.com", t("this", B)), t(" now", B))],
    stored: "**see** [**this**](https://x.com) **now**",
    canonical: true,
  },
  // literal syntax, escaped
  { name: "literal dash list", doc: [P(t("- not a list"))], stored: "\\- not a list" },
  { name: "literal plus list", doc: [P(t("+ also not"))], stored: "\\+ also not" },
  { name: "literal star list", doc: [P(t("* nope"))], stored: "\\* nope" },
  { name: "literal numbered list", doc: [P(t("1. first"))], stored: "1\\. first" },
  { name: "literal year at line start", doc: [P(t("2026. A year"))], stored: "2026\\. A year" },
  { name: "literal numbered with paren", doc: [P(t("3) third"))], stored: "3\\) third" },
  { name: "literal quote", doc: [P(t("> not quoted"))], stored: "\\> not quoted" },
  { name: "literal heading", doc: [P(t("# Title"))], stored: "\\# Title" },
  { name: "hashtag at line start", doc: [P(t("#design rocks"))], stored: "#design rocks" },
  { name: "literal rule", doc: [P(t("---"))], stored: "\\---" },
  { name: "literal setext", doc: [P(t("Title"), br, t("==="))], stored: "Title\n\\===" },
  { name: "literal fence", doc: [P(t("```js"))], stored: "\\`\\`\\`js" },
  {
    name: "literal link syntax",
    doc: [P(t("[text](https://x.com)"))],
    stored: "\\[text](https://x.com)",
  },
  { name: "literal image syntax", doc: [P(t("![alt](x.png)"))], stored: "!\\[alt](x.png)" },
  {
    name: "literal backslashes",
    doc: [P(t("C:\\Users\\me\\*"))],
    stored: "C:\\\\Users\\\\me\\\\\\*",
  },
  { name: "literal tildes", doc: [P(t("~5 min, ~~maybe~~"))], stored: "~5 min, \\~\\~maybe\\~\\~" },
  { name: "literal HTML", doc: [P(t("<b>bold</b> & <br>"))], stored: "\\<b>bold\\</b> & \\<br>" },
  { name: "comparison signs stay", doc: [P(t("a < b > c"))], stored: "a < b > c" },
  {
    name: "underscores stay",
    doc: [P(t("my_var and _x_ and __init__"))],
    stored: "my_var and _x_ and __init__",
  },
  { name: "indented dash", doc: [P(t("x"), br, t("   - deep"))], stored: "x\n   \\- deep" },
  {
    name: "indented first line loses its indent",
    doc: [P(t("   - deep"))],
    stored: "\\- deep",
    canonical: true,
  },
  {
    name: "dash after a line break",
    doc: [P(t("Plan:"), br, t("- one"), br, t("- two"))],
    stored: "Plan:\n\\- one\n\\- two",
  },
  { name: "escaped marker inside a list item", doc: [UL([t("- inner")])], stored: "- \\- inner" },
  { name: "escaped marker inside a quote", doc: [Q(t("> inner"))], stored: "> \\> inner" },
  // lists
  {
    name: "bullet list",
    doc: [UL([t("one")], [t("two")], [t("three")])],
    stored: "- one\n- two\n- three",
  },
  { name: "numbered list", doc: [OL(1, [t("a")], [t("b")])], stored: "1. a\n2. b" },
  { name: "numbered list from 3", doc: [OL(3, [t("c")], [t("d")])], stored: "3. c\n4. d" },
  {
    name: "numbered list past 9",
    doc: [OL(9, [t("i")], [t("j")], [t("k")])],
    stored: "9. i\n10. j\n11. k",
  },
  {
    name: "list item with a line break",
    doc: [UL([t("first"), br, t("continued")], [t("second")])],
    stored: "- first\n  continued\n- second",
  },
  {
    name: "numbered item with a line break past 9",
    doc: [OL(10, [t("x"), br, t("y")])],
    stored: "10. x\n    y",
  },
  {
    name: "list item with a blank line",
    doc: [UL([t("a"), br, br, t("b")])],
    stored: "- a\n  \n  b",
  },
  { name: "empty list item", doc: [UL([t("a")], [], [t("c")])], stored: "- a\n-\n- c" },
  { name: "list item starting with spaces", doc: [UL([t("  indented")])], stored: "-   indented" },
  {
    name: "paragraph then list",
    doc: [P(t("Plan:")), UL([t("a")], [t("b")])],
    stored: "Plan:\n\n- a\n- b",
  },
  { name: "list then paragraph", doc: [UL([t("a")]), P(t("done"))], stored: "- a\n\ndone" },
  { name: "list then indented paragraph", doc: [UL([t("a")]), P(t("  b"))], stored: "- a\n\n  b" },
  { name: "bullet then numbered", doc: [UL([t("a")]), OL(1, [t("b")])], stored: "- a\n\n1. b" },
  // Lexical's list transform already merges these in the editor.
  { name: "two bullet lists merge", doc: [UL([t("a")]), UL([t("b")])], stored: "- a\n- b" },
  {
    name: "nested list flattens",
    doc: [NESTED([t("top")], [[t("sub 1")], [t("sub 2")]])],
    stored: "- top\n- sub 1\n- sub 2",
    canonical: true,
  },
  {
    name: "list items with marks and code",
    doc: [UL([t("run ", B), t("make", B | C)], [t("then", I), t(" ship")])],
    stored: "- **run `make`**\n- *then* ship",
  },
  // quotes
  { name: "multi-line quote", doc: [Q(t("one"), br, t("two"))], stored: "> one\n> two" },
  { name: "quote with a blank line", doc: [Q(t("a"), br, br, t("b"))], stored: "> a\n>\n> b" },
  {
    name: "quote then reply",
    doc: [Q(t("Empty states should explain.")), P(t("Agreed."))],
    stored: "> Empty states should explain.\n\nAgreed.",
  },
  { name: "two quotes", doc: [Q(t("a")), Q(t("b"))], stored: "> a\n\n> b" },
  {
    name: "quote with marks",
    doc: [Q(t("not ", B), t("this", B | I))],
    stored: "> **not *this***",
  },
  { name: "quote starting with spaces", doc: [Q(t("  x"))], stored: ">   x" },
  // paragraphs and whitespace
  { name: "line breaks", doc: [P(t("a"), br, t("b"), br, t("c"))], stored: "a\nb\nc" },
  { name: "blank lines kept", doc: [P(t("a"), br, br, br, t("b"))], stored: "a\n\n\nb" },
  { name: "paragraph, blank line, block", doc: [P(t("a"), br), Q(t("q"))], stored: "a\n\n\n> q" },
  {
    name: "blank paragraph between blocks",
    doc: [Q(t("q")), P(), UL([t("x")])],
    stored: "> q\n\n\n\n- x",
  },
  { name: "spaces inside a line", doc: [P(t("a    b"))], stored: "a    b" },
  { name: "trailing spaces before a break", doc: [P(t("a  "), br, t("b"))], stored: "a  \nb" },
  { name: "leading spaces on a later line", doc: [P(t("a"), br, t("    b"))], stored: "a\n    b" },
  { name: "tabs in text", doc: [P(t("a"), tab(), t("b"))], stored: "a\tb" },
  { name: "non-breaking spaces kept", doc: [P(t("10\u00a0km"))], stored: "10\u00a0km" },
  { name: "message edges trimmed", doc: [P(t("  hi  "))], stored: "hi", canonical: true },
  {
    name: "blank lines at the edges trimmed",
    doc: [P(br, br, t("hi"), br, br)],
    stored: "hi",
    canonical: true,
  },
  { name: "empty message", doc: [P()], stored: "" },
  { name: "whitespace-only message", doc: [P(t("   "), br, t("\t"))], stored: "", canonical: true },
  {
    name: "bold edge spaces move out",
    doc: [P(t("a "), t(" b ", B), t(" c"))],
    stored: "a  **b**  c",
    canonical: true,
  },
  { name: "strike over a space between words", doc: [P(t("old text", S))], stored: "~~old text~~" },
  {
    name: "two paragraphs become lines",
    doc: [P(t("a")), P(t("b"))],
    stored: "a\nb",
    canonical: true,
  },
  {
    name: "underline and highlight drop",
    doc: [P(t("u", U), t(" "), t("h", HL | B))],
    stored: "u **h**",
    canonical: true,
  },
  // nested and adjacent formatting
  {
    name: "italic inside bold",
    doc: [P(t("a ", B), t("b", B | I), t(" c", B))],
    stored: "**a *b* c**",
  },
  {
    name: "bold inside italic",
    doc: [P(t("a ", I), t("b", B | I), t(" c", I))],
    stored: "*a **b** c*",
  },
  {
    name: "strike inside bold inside italic",
    doc: [P(t("x ", I), t("y ", B | I), t("z", B | I | S))],
    stored: "*x **y ~~z~~***",
  },
  {
    name: "marks change mid-word",
    doc: [P(t("a", B), t("b", I), t("c", S), t("d"))],
    stored: "**a***b*~~c~~d",
  },
  { name: "bold glued to punctuation", doc: [P(t("a"), t("(b)", B), t("c"))], stored: "a**(b)**c" },
  {
    name: "italic around a code span",
    doc: [P(t("use ", I), t("x", I | C), t(" here", I))],
    stored: "*use `x` here*",
  },
  {
    name: "bold ending in a code span",
    doc: [P(t("run ", B), t("ls", B | C))],
    stored: "**run `ls`**",
  },
  {
    name: "strike and bold overlap",
    doc: [P(t("a", S), t("b", S | B), t("c", B))],
    stored: "~~a**b**~~**c**",
  },
  { name: "emphasis next to escapes", doc: [P(t("*", B), t("x"))], stored: "**\\***x" },
  { name: "bold literal asterisks", doc: [P(t("2*3", B))], stored: "**2\\*3**" },
  {
    name: "mixed everything",
    doc: [
      P(
        t("Hey "),
        ref("person", ID.person),
        t(", "),
        t("please", B),
        t(" check "),
        ref("task", ID.task),
        t(" by "),
        day("2026-10-20"),
        t(" "),
        t(":eyes:"),
        t(" → "),
        link("https://moduo.app/x", t("spec")),
      ),
    ],
    stored: `Hey ${uri("person", ID.person)}, **please** check ${uri("task", ID.task)} by moduo://date/2026-10-20 :eyes: → [spec](https://moduo.app/x)`,
  },
];

export const EDITOR_CASES: EditorCase[] = [...generated, ...references, ...hand];

// ── 4. paste: HTML through the clean paste (Slack, Google Docs, the web) ───────

export type PasteCase = { name: string; html: string; stored: string };

const GDOCS = (body: string) =>
  `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b3c4d-7fff-1234-5678-abcdef012345">${body}</b><br class="Apple-interchange-newline">`;
const GSPAN = (text: string, style = "") =>
  `<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;${style}">${text}</span>`;
const GP = (inner: string) =>
  `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">${inner}</p>`;
const SLACK_SECTION = (inner: string) => `<div class="p-rich_text_section">${inner}</div>`;

export const PASTE_CASES: PasteCase[] = [
  {
    name: "Google Docs: bold and italic spans drop their style",
    html: GDOCS(
      GP(
        `${GSPAN("Launch ")}${GSPAN("checklist", "font-weight:700;")}${GSPAN(" for ")}${GSPAN("Q4", "font-style:italic;")}`,
      ),
    ),
    stored: "Launch checklist for Q4",
  },
  {
    name: "Google Docs: paragraphs become lines, empty one a blank line",
    html: GDOCS(`${GP(GSPAN("First"))}<br>${GP(GSPAN("Second"))}`),
    stored: "First\n\nSecond",
  },
  {
    name: "Google Docs: a bulleted list",
    html: GDOCS(
      `${GP(GSPAN("Todo:"))}<ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;" aria-level="1">${GP(GSPAN("design"))}</li><li dir="ltr" style="list-style-type:disc;" aria-level="1">${GP(GSPAN("build", "font-weight:700;"))}</li></ul>`,
    ),
    stored: "Todo:\n\n- design\n- build",
  },
  {
    name: "Google Docs: a numbered list with a nested level",
    html: GDOCS(
      `<ol style="margin-top:0;"><li dir="ltr" aria-level="1">${GP(GSPAN("one"))}<ol><li aria-level="2">${GP(GSPAN("one point one"))}</li></ol></li><li dir="ltr" aria-level="1">${GP(GSPAN("two"))}</li></ol>`,
    ),
    stored: "1. one\n2. one point one\n3. two",
  },
  {
    name: "Google Docs: a link and Polish text",
    html: GDOCS(
      GP(
        `${GSPAN("Zobacz ")}<a href="https://moduo.app/docs" style="text-decoration:none;">${GSPAN("dokumentację", "color:#1155cc;text-decoration:underline;")}</a>${GSPAN(" — zażółć gęślą jaźń")}`,
      ),
    ),
    stored: "Zobacz [dokumentację](https://moduo.app/docs) — zażółć gęślą jaźń",
  },
  {
    name: "Google Docs: a heading becomes a line",
    html: GDOCS(
      `<h2 dir="ltr" style="line-height:1.38;margin-top:18pt;">${GSPAN("Goals", "font-size:16pt;")}</h2>${GP(GSPAN("Ship it."))}`,
    ),
    stored: "Goals\nShip it.",
  },
  {
    name: "Google Docs: a table",
    html: GDOCS(
      `<div dir="ltr" align="left"><table style="border:none;"><colgroup><col width="100"></colgroup><tbody><tr><td>${GP(GSPAN("Name"))}</td><td>${GP(GSPAN("Status"))}</td></tr><tr><td>${GP(GSPAN("Logo"))}</td><td>${GP(GSPAN("Done"))}</td></tr></tbody></table></div>`,
    ),
    stored: "Name\tStatus\nLogo\tDone",
  },
  {
    name: "Slack: a message with bold, code and a mention",
    html: `<meta charset="utf-8">${SLACK_SECTION(`<span data-stringify-type="mention" class="c-member_slug">@Ana</span> please run <code data-stringify-type="code" class="c-mrkdwn__code">bun test</code> <b data-stringify-type="bold">before</b> merging`)}`,
    stored: "@Ana please run bun test before merging",
  },
  {
    name: "Slack: line breaks and an emoji image",
    html: `<meta charset="utf-8">${SLACK_SECTION(`Morning<br>all <img src="https://a.slack-edge.com/x/wave.png" aria-label="wave emoji" alt=":wave:" data-stringify-type="emoji" data-stringify-emoji=":wave:"> and 🎉`)}`,
    stored: "Morning\nall :wave: and 🎉",
  },
  {
    name: "Slack: a code block",
    html: `<meta charset="utf-8"><pre class="c-mrkdwn__pre" data-stringify-type="pre"><div class="p-rich_text_block--no-overflow">spacing: 12px<br>radius: 8px</div></pre>`,
    stored: "```\nspacing: 12px\nradius: 8px\n```",
  },
  {
    name: "Slack: a quote",
    html: `<meta charset="utf-8"><blockquote type="cite" class="c-mrkdwn__quote" data-stringify-type="quote">Empty states should explain, <i data-stringify-type="italic">not</i> decorate.</blockquote>`,
    stored: "> Empty states should explain, not decorate.",
  },
  {
    name: "Slack: a bulleted rich-text list",
    html: `<meta charset="utf-8"><ul data-stringify-type="unordered-list" data-list-tree="true" class="p-rich_text_list p-rich_text_list__bullet" data-indent="0" data-border="0"><li data-stringify-indent="0" data-stringify-border="0">first</li><li data-stringify-indent="0" data-stringify-border="0">second <a target="_blank" class="c-link" href="https://moduo.app" rel="noopener noreferrer">https://moduo.app</a></li></ul>`,
    stored: "- first\n- second https://moduo.app",
  },
  {
    name: "Slack: a link with its own text",
    html: `<meta charset="utf-8">${SLACK_SECTION(`See <a target="_blank" class="c-link" data-stringify-link="https://en.wikipedia.org/wiki/Mars_(planet)" href="https://en.wikipedia.org/wiki/Mars_(planet)" rel="noopener noreferrer">the Mars page</a>.`)}`,
    stored: "See [the Mars page](https://en.wikipedia.org/wiki/Mars_\\(planet\\)).",
  },
  {
    name: "web: Markdown-looking text stays literal",
    html: `<p>**not bold** and - not a list</p><p>1. not numbered</p>`,
    stored: "\\*\\*not bold\\*\\* and - not a list\n1\\. not numbered",
  },
  {
    name: "web: unsafe and relative links keep their text",
    html: `<p><a href="javascript:alert(1)">click</a> <a href="/settings">settings</a> <a href="mailto:hi@moduo.app">hi@moduo.app</a></p>`,
    stored: "click settings hi@moduo.app",
  },
  {
    name: "web: whitespace collapses, non-breaking spaces stay as spaces",
    html: `<div>  lots   of\n   space&nbsp;&nbsp;here  </div><div>\u200bzero width</div>`,
    stored: "lots of space  here\nzero width",
  },
  {
    name: "web: styles, scripts and images drop",
    html: `<style>p{color:red}</style><script>alert(1)</script><p><span style="color:red;font-family:Comic Sans">red</span> <img src="cat.png" alt="a cat"> <u>under</u> <mark>hi</mark></p>`,
    stored: "red under hi",
  },
];

// ── 5. stored text written elsewhere (v1 leftovers, agents): read leniently ────

export type StoredCase = { name: string; input: string; canonical: string };

export const STORED_CASES: StoredCase[] = [
  { name: "star bullets", input: "* a\n* b", canonical: "- a\n- b" },
  { name: "plus bullets", input: "+ a", canonical: "- a" },
  { name: "paren numbers", input: "1) a\n2) b", canonical: "1. a\n2. b" },
  { name: "list right after a line", input: "Plan:\n- a\n- b", canonical: "Plan:\n\n- a\n- b" },
  {
    name: "numbered list from 2 can't cut a paragraph",
    input: "We have\n2. problems",
    canonical: "We have\n2\\. problems",
  },
  { name: "quote without a space", input: ">quoted", canonical: "> quoted" },
  { name: "quote then reply without a blank line", input: "> q\nreply", canonical: "> q\n\nreply" },
  {
    name: "titled Moduo link drops the title",
    input: `[Ship it](moduo://task/${ID.task})`,
    canonical: `moduo://task/${ID.task}`,
  },
  {
    name: "upper-case id",
    input: `moduo://task/${ID.task.toUpperCase()}`,
    canonical: `moduo://task/${ID.task}`,
  },
  { name: "underscore italic means nothing", input: "_x_ and __y__", canonical: "_x_ and __y__" },
  { name: "spaced asterisks stay text", input: "5 * 3 * 2", canonical: "5 \\* 3 \\* 2" },
  { name: "unclosed bold is text", input: "**open", canonical: "\\*\\*open" },
  { name: "bold spanning lines", input: "**a\nb**", canonical: "**a**\n**b**" },
  {
    name: "angle autolink is text around a URL",
    input: "<https://x.com>",
    canonical: "\\<https://x.com>",
  },
  { name: "unclosed fence runs to the end", input: "```\ncode", canonical: "```\ncode\n```" },
  {
    name: "fence info string with extras",
    input: "``` js title\nx\n```",
    canonical: "```js\nx\n```",
  },
  { name: "tilde fence is text", input: "~~~\nx\n~~~", canonical: "\\~\\~\\~\nx\n\\~\\~\\~" },
  { name: "heading is text", input: "# Title", canonical: "\\# Title" },
  {
    name: "invalid date is text",
    input: "moduo://date/2026-02-30",
    canonical: "moduo\\://date/2026-02-30",
  },
  { name: "short id is text", input: "moduo://task/123", canonical: "moduo\\://task/123" },
  { name: "CRLF line ends", input: "a\r\nb", canonical: "a\nb" },
  {
    name: "link title is not supported",
    input: '[a](https://x.com "t")',
    canonical: '\\[a](https://x.com "t")',
  },
  { name: "nested emphasis from an agent", input: "***a** b*", canonical: "***a** b*" },
  { name: "single tilde is text", input: "~a~", canonical: "~a~" },
];
