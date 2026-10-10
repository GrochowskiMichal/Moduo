import { describe, expect, it } from "@rstest/core";

import { escapeHtml, redactAddresses, singleLine } from "./escape.ts";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("escapes & first, so existing entities are not left live", () => {
    expect(escapeHtml("&lt;script&gt;")).toBe("&amp;lt;script&amp;gt;");
  });

  it("leaves plain text alone", () => {
    expect(escapeHtml("Ana's team — Q4 plan")).toBe("Ana&#39;s team — Q4 plan");
    expect(escapeHtml("Moduo")).toBe("Moduo");
  });
});

describe("singleLine", () => {
  it("turns line breaks and control characters into single spaces", () => {
    expect(singleLine("Eve\r\nBcc: someone@example.com")).toBe("Eve Bcc: someone@example.com");
    expect(singleLine("a\u0000b\tc\u2028d")).toBe("a b c d");
    expect(singleLine("  lots   of\n\n space  ")).toBe("lots of space");
  });

  it("drops C1 controls, bidi overrides and the BOM, but keeps emoji joiners", () => {
    expect(singleLine("a\u0085b")).toBe("a b");
    expect(singleLine("\u202etnuocca ruoy yfirev")).toBe("tnuocca ruoy yfirev");
    expect(singleLine("x\u2066y\u2069z\ufeff")).toBe("x y z");
    expect(singleLine("👩\u200d💻 team")).toBe("👩\u200d💻 team");
  });

  it("never splits an emoji when it cuts", () => {
    const out = singleLine(`${"a".repeat(78)}😀😀`, 80);
    expect(out).toBe(`${"a".repeat(78)}😀😀`);
    const cut = singleLine(`${"a".repeat(78)}😀😀😀`, 80);
    expect(cut).toBe(`${"a".repeat(78)}😀…`);
    // encodeURIComponent throws on a lone surrogate.
    expect(() => encodeURIComponent(cut)).not.toThrow();
  });

  it("cuts long values with an ellipsis", () => {
    const out = singleLine("x".repeat(200), 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith("…")).toBe(true);
    expect(singleLine("short", 20)).toBe("short");
  });

  it("can come back empty, so callers keep their fallback", () => {
    expect(singleLine("\u0000\n ")).toBe("");
  });
});

describe("redactAddresses", () => {
  it("blanks every address and keeps the rest of the message", () => {
    expect(redactAddresses('Failing row contains (tom@becker.studio, bounce). To: "Anna" <anna@northwind.studio>')).toBe(
      'Failing row contains ([address], bounce). To: "Anna" <[address]>',
    );
    expect(redactAddresses("resend_http_500")).toBe("resend_http_500");
  });
});

