import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "@rstest/core";

import {
  addRelease,
  buildRelease,
  nextVersion,
  prepareRelease,
  readReleases,
  renderChangelog,
  renderComingNextMarkdown,
  renderReleaseMarkdown,
} from "./changes.ts";
import { type Note, SECURITY_LINE } from "./check-notes.ts";

const n = (type: Note["type"], text: string, extra: Partial<Note> = {}): Note => ({
  slug: text.slice(0, 8),
  type,
  internal: false,
  highlight: false,
  text,
  ...extra,
});

function tempRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changes-"));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

const noteFile = (type: string, text: string, extra = "") =>
  `---\ntype: ${type}\ninternal: ${extra.includes("internal") ? "true" : "false"}\n${extra.replace("internal\n", "")}---\n${text}\n`;

describe("release notes pipeline", () => {
  it("collects, versions, renders", () => {
    const notes = [
      n("fixed", "Moods save reliably again."),
      n("new", "You can log a mood from the dashboard."),
      n("improved", "Search finds notes faster.", { highlight: true }),
      n("new", "Internal tidy-up.", { internal: true }),
      n("security", SECURITY_LINE),
      n("security", SECURITY_LINE),
    ];

    // Any public `new` → minor; otherwise patch. Internal notes don't count.
    expect(nextVersion("1.1.0", notes)).toBe("1.2.0");
    expect(nextVersion("1.1.3", [n("fixed", "A fix.")])).toBe("1.1.4");
    expect(nextVersion("1.1.3", [n("new", "Hidden.", { internal: true })])).toBe("1.1.4");
    expect(() => nextVersion("1.1", notes)).toThrow();

    const release = buildRelease("1.2.0", "2026-11-02", notes);
    expect(release).toEqual({
      version: "1.2.0",
      date: "2026-11-02",
      // marked highlights win over the first `new` items
      highlights: ["Search finds notes faster."],
      items: [
        { type: "new", text: "You can log a mood from the dashboard." },
        { type: "improved", text: "Search finds notes faster." },
        { type: "fixed", text: "Moods save reliably again." },
        { type: "security", text: SECURITY_LINE },
      ],
    });
    // Without marked ones: the first two `new` items.
    expect(
      buildRelease("1.2.0", "2026-11-02", [
        n("new", "A."),
        n("fixed", "F."),
        n("new", "B."),
        n("new", "C."),
      ]).highlights,
    ).toEqual(["A.", "B."]);
    // A patch release still gets highlights: the first improved, then fixed items.
    expect(
      buildRelease("1.1.1", "2026-11-02", [n("fixed", "F."), n("improved", "I."), n("fixed", "G.")])
        .highlights,
    ).toEqual(["I.", "F."]);

    const file = addRelease(
      { releases: [buildRelease("1.1.0", "2026-10-18", [n("fixed", "Old.")])] },
      release,
    );
    expect(file.releases.map((r) => r.version)).toEqual(["1.2.0", "1.1.0"]);
    expect(() => addRelease(file, release)).toThrow(/already has 1.2.0/);

    expect(renderReleaseMarkdown(release)).toBe(
      [
        "**Search finds notes faster.**",
        "",
        "### New",
        "",
        "- You can log a mood from the dashboard.",
        "",
        "### Improved",
        "",
        "- Search finds notes faster.",
        "",
        "### Fixed",
        "",
        "- Moods save reliably again.",
        "",
        "### Security",
        "",
        `- ${SECURITY_LINE}`,
        "",
      ].join("\n"),
    );
    const changelog = renderChangelog(file);
    expect(changelog.indexOf("## 1.2.0 · 2026-11-02")).toBeLessThan(changelog.indexOf("## 1.1.0"));
    expect(changelog).not.toContain("Internal tidy-up.");
    expect(renderComingNextMarkdown(notes)).toMatch(/^## Coming next\n\n### New\n/);
    expect(renderComingNextMarkdown([n("new", "x", { internal: true })])).toBe(
      "Coming next: reliability improvements.\n",
    );
  });

  it("prepares a release from the note files", () => {
    const root = tempRepo({
      VERSION: "1.1.0\n",
      ".changes/README.md": "# not a note",
      ".changes/mood.md": noteFile("new", "You can log a mood from the dashboard."),
      ".changes/tidy.md": noteFile("improved", "Refactored things.", "internal\n"),
      "release-notes/releases.json": JSON.stringify({
        releases: [{ version: "1.1.0", date: "2026-10-18", highlights: [], items: [] }],
      }),
    });
    const result = prepareRelease({ root, date: "2026-11-02" });
    expect(result.version).toBe("1.2.0");
    expect(fs.readFileSync(path.join(root, "VERSION"), "utf8")).toBe("1.2.0\n");
    expect(readReleases(root).releases[0]).toEqual({
      version: "1.2.0",
      date: "2026-11-02",
      highlights: ["You can log a mood from the dashboard."],
      items: [{ type: "new", text: "You can log a mood from the dashboard." }],
    });
    expect(fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8")).toContain(
      "## 1.2.0 · 2026-11-02",
    );
    // Consumed notes (internal too) are deleted; the README stays.
    expect(fs.readdirSync(path.join(root, ".changes"))).toEqual(["README.md"]);
  });

  it("ships only-internal work only when asked, with the reliability line", () => {
    const files = {
      VERSION: "1.1.0\n",
      ".changes/tidy.md": noteFile("improved", "Refactored things.", "internal\n"),
    };
    expect(() => prepareRelease({ root: tempRepo(files), date: "2026-11-02" })).toThrow(
      /no public notes/,
    );
    const root = tempRepo(files);
    expect(prepareRelease({ root, date: "2026-11-02", reliability: true }).release).toEqual({
      version: "1.1.1",
      date: "2026-11-02",
      highlights: ["Reliability improvements."],
      items: [{ type: "improved", text: "Reliability improvements." }],
    });
    expect(() =>
      prepareRelease({
        root: tempRepo(files),
        date: "2026-11-02",
        reliability: true,
        version: "1.0.9",
      }),
    ).toThrow(/must be higher/);
  });

  it("refuses to prepare while a note leaks", () => {
    const root = tempRepo({
      VERSION: "1.1.0\n",
      ".changes/leak.md": noteFile("fixed", "Fixed the taskStore cache."),
    });
    expect(() => prepareRelease({ root, date: "2026-11-02" })).toThrow(/taskStore/);
    expect(fs.readFileSync(path.join(root, "VERSION"), "utf8")).toBe("1.1.0\n");
  });

  it("the committed CHANGELOG.md matches releases.json", () => {
    const root = path.resolve(import.meta.dirname, "..", "..");
    expect(fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8")).toBe(
      renderChangelog(readReleases(root)),
    );
  });
});
