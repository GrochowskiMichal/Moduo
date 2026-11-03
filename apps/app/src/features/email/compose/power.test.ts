import { describe, expect, it } from "@rstest/core";

import { pickAlias, swapSignature, type MailAlias } from "./aliases";
import { rankRecipients } from "./autocomplete";
import { followUpDueMs } from "./follow-up";
import { instantIntro } from "./intro";
import { blockShortcut, inlineShortcut } from "./markdown";
import { checkSendSize } from "./size-limit";
import { fillPlaceholders, findSnippetTrigger, insertSnippet } from "./snippets";

const alias = (p: Partial<MailAlias>): MailAlias => ({
  id: "a",
  accountId: "acc",
  address: "me@x.com",
  name: "Me",
  isDefault: false,
  signatureHtml: "",
  ...p,
});

describe("compose power features (AC23)", () => {
  it("alias signature: picks the addressed alias, else the default, and swaps only the signature", () => {
    const aliases = [
      alias({ id: "1", address: "me@x.com", isDefault: true, signatureHtml: "<p>Me</p>" }),
      alias({ id: "2", address: "sales@x.com", signatureHtml: "<p>Sales team</p>" }),
      alias({ id: "3", accountId: "other", address: "o@y.com", isDefault: true }),
    ];
    expect(pickAlias(aliases, "acc")?.id).toBe("1");
    expect(pickAlias(aliases, "acc", ["SALES@x.com"])?.id).toBe("2");
    const first = swapSignature("<p>Hi</p><blockquote>old</blockquote>", aliases[0]);
    expect(first).toContain("<p>Hi</p><div data-moduo-signature=\"\"><p>Me</p>");
    expect(first.indexOf("Me</p>")).toBeLessThan(first.indexOf("<blockquote"));
    const second = swapSignature(first, aliases[1]);
    expect(second).toContain("Sales team");
    expect(second).not.toContain("<p>Me</p>");
    expect(second).toContain("<p>Hi</p>");
    expect(swapSignature(second, null)).not.toContain("Sales team");
  });

  it("autocomplete rank: frequency first, contacts merged, prefix hits above inside hits", () => {
    const out = rankRecipients({
      query: "an",
      contacts: [{ name: "Anna Lee", email: "anna@x.com" }],
      correspondents: [
        { name: "Andy", email: "andy@y.com", count: 40 },
        { name: "Anna", email: "ANNA@x.com", count: 2 },
        { name: "Joanne", email: "jo@z.com", count: 99 },
      ],
      exclude: ["nobody@x.com"],
    });
    expect(out.map((c) => c.email)).toEqual(["andy@y.com", "anna@x.com", "jo@z.com"]);
    expect(out[1]).toMatchObject({ name: "Anna Lee", isContact: true, count: 2 });
    expect(rankRecipients({ query: "an", contacts: [], correspondents: [{ name: "Andy", email: "andy@y.com", count: 1 }], exclude: ["andy@y.com"] })).toEqual([]);
  });

  it("snippet placeholders: ;; trigger, fill from recipient and me, unknown kept", () => {
    expect(findSnippetTrigger("Hello ;;thx", 11)).toEqual({ start: 6, query: "thx" });
    expect(findSnippetTrigger("a;;b", 4)).toBeNull();
    const ctx = { recipient: { name: "Anna Lee", email: "anna@x.com" }, me: { name: "Mike G", email: "m@x.com" } };
    expect(fillPlaceholders("Hi {first name} {Last Name}, {my name} {unknown}", ctx)).toBe(
      "Hi Anna Lee, Mike G {unknown}",
    );
    const r = insertSnippet("Hey ;;th ok", 8, { id: "s", name: "thanks", body: "Thanks {first name}!" }, ctx);
    expect(r).toEqual({ text: "Hey Thanks Anna! ok", caret: 16 });
  });

  it("size limit: blocks before Send on the encoded size", () => {
    const limit = 25 * 1024 * 1024;
    expect(checkSendSize([{ size: 10 * 1024 * 1024 }], 1000, limit).ok).toBe(true);
    const big = checkSendSize([{ size: 20 * 1024 * 1024 }], 1000, limit);
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.message).toContain("25 MB");
  });

  it("instant intro: moves the introducer to Bcc with a note", () => {
    const out = instantIntro(
      { to: "Anna Lee <anna@x.com>, bob@y.com", cc: "anna@x.com", bcc: "", bodyHtml: "<p>body</p>" },
      "Anna Lee <anna@x.com>",
    );
    expect(out.to).toBe("bob@y.com");
    expect(out.cc).toBe("");
    expect(out.bcc).toBe("anna@x.com");
    expect(out.bodyHtml).toBe("<p>Thanks Anna (moving you to Bcc).</p><p>body</p>");
  });

  it("markdown shortcuts", () => {
    expect(blockShortcut("- ")).toBe("ul");
    expect(blockShortcut("1. ")).toBe("ol");
    expect(blockShortcut("> ")).toBe("quote");
    expect(blockShortcut("x- ")).toBeNull();
    expect(inlineShortcut("so **this**")).toEqual({ format: "bold", text: "this", length: 8 });
    expect(inlineShortcut("an _em_")).toEqual({ format: "italic", text: "em", length: 4 });
    expect(inlineShortcut("plain")).toBeNull();
  });

  it("follow-up footer: due at 9:00 the chosen days ahead", () => {
    const now = new Date(2026, 10, 4, 15, 30).getTime();
    expect(followUpDueMs("3d", now)).toBe(new Date(2026, 10, 7, 9, 0).getTime());
  });
});
