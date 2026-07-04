import { describe, expect, it } from "vitest";
import { publicUrlTransform, stripLeadingTitle } from "./public-render";

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
