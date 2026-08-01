import { describe, expect, it } from "vitest";
import {
  comparePublicNotes,
  publicUrlTransform,
  stripLeadingTitle,
  stripTaskIdComments,
} from "./public-render";

describe("stripTaskIdComments (DF-13 — no internal ids on the public page)", () => {
  it("strips the task-line stable-id comment, keeps the title", () => {
    expect(stripTaskIdComments("- [x] Ship it <!-- moduo:task:abc-123 -->")).toBe("- [x] Ship it");
  });

  it("strips multiple comments across lines, leaves other html alone", () => {
    const md = "- [ ] a <!-- moduo:task:t1 -->\n- [ ] b <!-- moduo:task:t2 -->\n<!-- keep -->";
    expect(stripTaskIdComments(md)).toBe("- [ ] a\n- [ ] b\n<!-- keep -->");
  });
});

describe("stripLeadingTitle (NO-9b — no double title on the public page)", () => {
  it("drops a leading `# Title` that matches the note title", () => {
    expect(stripLeadingTitle("# My Note\n\nBody here", "My Note")).toBe("Body here");
  });

  it("drops a leading plain-text title line (case/space-insensitive)", () => {
    expect(stripLeadingTitle("  my note  \n\nBody", "My Note")).toBe("Body");
  });

  it("keeps the body when the first line is NOT the title", () => {
    expect(stripLeadingTitle("## Section\n\nBody", "My Note")).toBe("## Section\n\nBody");
  });

  it("no-ops on empty title", () => {
    expect(stripLeadingTitle("# Anything\n\nx", "")).toBe("# Anything\n\nx");
  });

  it("handles a body that is only the title", () => {
    expect(stripLeadingTitle("# My Note", "My Note")).toBe("");
  });
});

describe("publicUrlTransform (NO-9b — public-page URL allow-list)", () => {
  it("allows http/https/mailto", () => {
    expect(publicUrlTransform("https://example.com")).toBe("https://example.com");
    expect(publicUrlTransform("http://example.com/x")).toBe("http://example.com/x");
    expect(publicUrlTransform("mailto:a@b.com")).toBe("mailto:a@b.com");
  });

  it("drops javascript:/data:/vbscript: (the XSS schemes)", () => {
    expect(publicUrlTransform("javascript:alert(1)")).toBe("");
    expect(publicUrlTransform("data:text/html;base64,PHN2Zz4=")).toBe("");
    expect(publicUrlTransform("vbscript:msgbox(1)")).toBe("");
  });

  it("drops a moduo:// in-app deep link (useless + unsafe on a public page)", () => {
    expect(publicUrlTransform("moduo://contact/abc123")).toBe("");
  });

  it("drops control-char scheme-smuggling (tab/newline break browsers strip)", () => {
    expect(publicUrlTransform("java\tscript:alert(1)")).toBe("");
    expect(publicUrlTransform("java\nscript:alert(1)")).toBe("");
    expect(publicUrlTransform("java\r\nscript:alert(1)")).toBe("");
    expect(publicUrlTransform("javascript\t:alert(1)")).toBe("");
    expect(publicUrlTransform("java\x00script:alert(1)")).toBe("");
  });

  it("allows relative / anchor / scheme-less URLs", () => {
    expect(publicUrlTransform("/docs/x")).toBe("/docs/x");
    expect(publicUrlTransform("#section")).toBe("#section");
    expect(publicUrlTransform("example.com/path")).toBe("example.com/path");
  });

  it("handles empty/whitespace", () => {
    expect(publicUrlTransform("")).toBe("");
    expect(publicUrlTransform("   ")).toBe("");
  });
});

describe("comparePublicNotes (DF-13 — authored page order)", () => {
  const n = (id: string, title: string, position?: string | null, createdAt?: string | null) => ({
    id,
    title,
    position,
    createdAt,
  });

  it("orders by fractional position, not title", () => {
    const list = [n("1", "Alpha", "m"), n("2", "Zulu", "a"), n("3", "Mike", "z")];
    expect(list.sort(comparePublicNotes).map((x) => x.id)).toEqual(["2", "1", "3"]);
  });

  it("mirrors the in-app tree: legacy empty positions sort first", () => {
    const list = [n("1", "B", "a"), n("2", "A", "")];
    expect(list.sort(comparePublicNotes).map((x) => x.id)).toEqual(["2", "1"]);
  });

  it("mirrors tree.ts EXACTLY: equal positions tiebreak on createdAt, not title", () => {
    // Both position "a"; createdAt decides (creation order), NOT alphabetical.
    const list = [
      n("1", "Zulu", "a", "2026-01-01T00:00:00Z"),
      n("2", "Alpha", "a", "2026-02-01T00:00:00Z"),
    ];
    expect(list.sort(comparePublicNotes).map((x) => x.id)).toEqual(["1", "2"]);
  });

  it("degrades to alphabetical when the edge fn predates the fields", () => {
    const list = [n("1", "Charlie"), n("2", "alpha", null), n("3", "Bravo")];
    expect(list.sort(comparePublicNotes).map((x) => x.title)).toEqual([
      "alpha",
      "Bravo",
      "Charlie",
    ]);
  });

  it("ties (equal position + title, no createdAt) break on id, untitled sorts as 'Untitled'", () => {
    const list = [n("b", "  ", "a"), n("a", "Untitled", "a")];
    expect(list.sort(comparePublicNotes).map((x) => x.id)).toEqual(["a", "b"]);
  });
});
