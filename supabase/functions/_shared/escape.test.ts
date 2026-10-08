import { describe, expect, it } from "@rstest/core";

import { escapeHtml, noTags, singleLine } from "./escape.ts";

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

describe("noTags", () => {
  it("removes angle brackets so no tag survives", () => {
    expect(noTags('Hi <a href="https://evil.example">confirm here</a>')).toBe(
      'Hi a href="https://evil.example"confirm here/a',
    );
    expect(noTags("<script>alert(1)</script>")).not.toMatch(/[<>]/);
  });

  it("leaves ordinary text, including &, alone", () => {
    expect(noTags("Tom & Jerry's agenda: Q4 > Q3")).toBe("Tom & Jerry's agenda: Q4  Q3");
    expect(noTags("ana@example.com")).toBe("ana@example.com");
  });
});

describe("singleLine", () => {
  it("turns line breaks and control characters into single spaces", () => {
    expect(singleLine("Eve\r\nBcc: someone@example.com")).toBe("Eve Bcc: someone@example.com");
    expect(singleLine("a\u0000b\tc\u2028d")).toBe("a b c d");
    expect(singleLine("  lots   of\n\n space  ")).toBe("lots of space");
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
