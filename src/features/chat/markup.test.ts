import { describe, expect, it } from "vitest";
import {
  activeTrigger,
  decodeForComposer,
  encodeComposerText,
  isEmojiOnly,
  mentionedUserIds,
  parseBody,
  parseInline,
  toPlainText,
} from "./markup";

const ANA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";

describe("parseInline", () => {
  it("parses emphasis, code and strike", () => {
    expect(parseInline("a **b** _c_ ~~d~~ `e`")).toEqual([
      { t: "text", v: "a " },
      { t: "bold", c: [{ t: "text", v: "b" }] },
      { t: "text", v: " " },
      { t: "italic", c: [{ t: "text", v: "c" }] },
      { t: "text", v: " " },
      { t: "strike", c: [{ t: "text", v: "d" }] },
      { t: "text", v: " " },
      { t: "code", v: "e" },
    ]);
  });

  it("does not format inside code spans", () => {
    expect(parseInline("`**raw**`")).toEqual([{ t: "code", v: "**raw**" }]);
  });

  it("leaves snake_case and multiplication alone", () => {
    expect(parseInline("my_var_name and 2*3*4")).toEqual([
      { t: "text", v: "my_var_name and 2*3*4" },
    ]);
  });

  it("parses mention, channel and entity tokens", () => {
    expect(parseInline(`hi <@${ANA}> <!channel> see <moduo:task:${TASK}|Ship it>`)).toEqual([
      { t: "text", v: "hi " },
      { t: "mention", userId: ANA },
      { t: "text", v: " " },
      { t: "channel" },
      { t: "text", v: " see " },
      { t: "entity", type: "task", id: TASK, label: "Ship it" },
    ]);
  });

  it("autolinks URLs without swallowing trailing punctuation", () => {
    expect(parseInline("go to https://moduo.app/x.")).toEqual([
      { t: "text", v: "go to " },
      { t: "link", href: "https://moduo.app/x", label: "https://moduo.app/x" },
      { t: "text", v: "." },
    ]);
  });
});

describe("parseBody", () => {
  it("splits fenced code, quotes and paragraphs", () => {
    const blocks = parseBody("intro\n> quoted\n> more\nafter\n```ts\nconst a = 1;\n```\nend");
    expect(blocks.map((b) => b.t)).toEqual(["p", "quote", "p", "pre", "p"]);
    expect(blocks[1]).toEqual({ t: "quote", c: [{ t: "text", v: "quoted\nmore" }] });
    expect(blocks[3]).toEqual({ t: "pre", v: "const a = 1;", lang: "ts" });
  });
});

describe("plain text + mentions", () => {
  const names: Record<string, string> = { [ANA]: "Ana", [BEN]: "Ben" };
  const nameOf = (id: string) => names[id] ?? "someone";

  it("renders tokens to names for excerpts", () => {
    expect(toPlainText(`**hey** <@${ANA}>, see <moduo:task:${TASK}|Ship it>`, nameOf)).toBe(
      "hey @Ana, see Ship it",
    );
  });

  it("collects mentioned ids once, in order", () => {
    expect(mentionedUserIds(`<@${BEN}> <@${ANA}> <@${BEN}>`)).toEqual([BEN, ANA]);
  });
});

describe("composer encode/decode", () => {
  it("swaps picked names for tokens, longest first", () => {
    const out = encodeComposerText("@Ana Kowalska and @Ana ping @here #Ship it!", [
      { kind: "person", userId: BEN, label: "Ana" },
      { kind: "person", userId: ANA, label: "Ana Kowalska" },
      { kind: "entity", type: "task", id: TASK, label: "Ship it" },
    ]);
    expect(out.body).toBe(`<@${ANA}> and <@${BEN}> ping <!channel> <moduo:task:${TASK}|Ship it>!`);
    expect(out.mentionedUserIds).toEqual([ANA, BEN]);
    expect(out.notifyChannel).toBe(true);
  });

  it("does not encode an email address as a mention", () => {
    const out = encodeComposerText("mail ana@Ana.com", [
      { kind: "person", userId: ANA, label: "Ana" },
    ]);
    expect(out.body).toBe("mail ana@Ana.com");
  });

  it("round-trips through decode for editing", () => {
    const body = `hi <@${ANA}> re <moduo:task:${TASK}|Ship it> <!channel>`;
    const { text, picks } = decodeForComposer(body, () => "Ana");
    expect(text).toBe("hi @Ana re #Ship it @channel");
    expect(encodeComposerText(text, picks).body).toBe(body);
  });
});

describe("activeTrigger", () => {
  it("finds the @ or # query at the caret", () => {
    expect(activeTrigger("hello @an", 9)).toEqual({ trigger: "@", query: "an", start: 6 });
    expect(activeTrigger("#", 1)).toEqual({ trigger: "#", query: "", start: 0 });
    expect(activeTrigger("mail a@b", 8)).toBeNull();
  });
  it("opens emoji only after two letters", () => {
    expect(activeTrigger("time: 10", 5)).toBeNull();
    expect(activeTrigger("nice :th", 8)).toEqual({ trigger: ":", query: "th", start: 5 });
  });
});

describe("isEmojiOnly", () => {
  it("detects up to three emoji", () => {
    expect(isEmojiOnly("🎉")).toBe(true);
    expect(isEmojiOnly("👍🏽 🎉")).toBe(true);
    expect(isEmojiOnly("🎉🎉🎉🎉")).toBe(false);
    expect(isEmojiOnly("ok 🎉")).toBe(false);
  });
});

describe("searchEmoji", () => {
  it("ranks a primary-name match above an alias match", async () => {
    const { searchEmoji } = await import("./emoji");
    expect(searchEmoji("ta")[0]?.e).toBe("🎉");
    expect(searchEmoji(":+1")[0]?.e).toBe("👍");
  });
});
