// REL-4 · AC11: moduo.app/changelog lists every release from releases.json,
// newest first, in the text pages' style.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@rstest/core";

import { changelogReleases, renderChangelogPage } from "./changelog.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const template = fs.readFileSync(path.join(root, "terms.html"), "utf8");

const DATA = {
  releases: [
    {
      version: "1.0.0",
      date: "2026-10-01",
      highlights: [],
      items: [{ type: "new", text: "Moduo for web, Mac and Windows." }],
    },
    {
      version: "1.1.0",
      date: "2026-10-18",
      highlights: ["Chat keeps your place"],
      items: [
        { type: "fixed", text: "Calendar events keep their time." },
        { type: "new", text: "Chat keeps your place <everywhere>." },
        { type: "security", text: "Security and reliability improvements." },
        { type: "improved", text: "Notes open faster." },
      ],
    },
    { version: "1.10.0", date: "2026-11-30", highlights: [], items: [] },
  ],
};

describe("changelog page from releases.json", () => {
  const html = renderChangelogPage(template, DATA);

  it("lists every release, newest first", () => {
    const versions = [...html.matchAll(/<h2 id="h-[^"]+">Moduo ([^<]+)<\/h2>/g)].map((m) => m[1]);
    expect(versions).toEqual(["1.10.0", "1.1.0", "1.0.0"]);
    expect(changelogReleases(DATA).map((r) => r.version)).toEqual(["1.10.0", "1.1.0", "1.0.0"]);
  });

  it("groups each release New, Improved, Fixed, with the security line under Fixed", () => {
    const section = html.slice(html.indexOf('id="v1-1-0"'), html.indexOf('id="v1-0-0"'));
    const headings = [...section.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
    expect(headings).toEqual(["New", "Improved", "Fixed"]);
    expect(section).toContain("<li>Security and reliability improvements.</li>");
    expect(section).toContain('<time datetime="2026-10-18">18 October 2026</time>');
  });

  it("escapes the notes' text", () => {
    expect(html).toContain("Chat keeps your place &lt;everywhere&gt;.");
  });

  it("is its own indexable page in the text pages' style", () => {
    expect(html).toContain("<title>Changelog · Moduo</title>");
    expect(html).toContain('<link rel="canonical" href="https://moduo.app/changelog" />');
    expect(html).not.toContain('name="robots"');
    expect(html).not.toContain("Beta terms");
    expect(html).toContain('id="pref-theme"');
  });

  it("with no releases yet, says so", () => {
    expect(renderChangelogPage(template, {})).toContain("The first release notes will appear here");
  });
});
