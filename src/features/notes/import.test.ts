import { describe, expect, it } from "vitest";
import { planMdZipImport } from "./import";

describe("planMdZipImport (AC11/AC14)", () => {
  it("maps folders to parents (Notion-style nesting)", () => {
    const plan = planMdZipImport([
      { path: "Clients.md", content: "# Clients\nlist" },
      { path: "Clients/Acme.md", content: "# Acme\ndetails" },
      { path: "Clients/Acme/Contact.md", content: "# Contact\njane" },
    ]);
    const byTitle = Object.fromEntries(plan.nodes.map((n) => [n.title, n]));
    expect(plan.nodes).toHaveLength(3);
    expect(byTitle["Clients"].parentTempId).toBeNull();
    expect(byTitle["Acme"].parentTempId).toBe(byTitle["Clients"].tempId);
    expect(byTitle["Contact"].parentTempId).toBe(byTitle["Acme"].tempId);
  });

  it("isolates + counts malformed / non-markdown files", () => {
    const plan = planMdZipImport([
      { path: "ok.md", content: "content" },
      { path: "image.png", content: "binary" },
      { path: "empty.md", content: "   " },
    ]);
    expect(plan.nodes.map((n) => n.title)).toEqual(["ok"]);
    expect(plan.skipped).toHaveLength(2);
    expect(plan.skipped.map((s) => s.reason).sort()).toEqual(["empty file", "not a markdown file"]);
  });

  it("strips Notion hash suffixes from titles and still resolves parents", () => {
    const plan = planMdZipImport([
      { path: "Projects 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.md", content: "x" },
      {
        path: "Projects 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d/Task abcdef0123456789abcdef0123456789.md",
        content: "y",
      },
    ]);
    const byTitle = Object.fromEntries(plan.nodes.map((n) => [n.title, n]));
    expect(byTitle["Projects"]).toBeTruthy();
    expect(byTitle["Task"].parentTempId).toBe(byTitle["Projects"].tempId);
  });

  it("emits parents before children even when the zip lists them reversed (M1)", () => {
    // Child file first, parent second — the FK-safe import order must reverse it.
    const plan = planMdZipImport([
      { path: "Clients/Acme.md", content: "# Acme" },
      { path: "Clients.md", content: "# Clients" },
    ]);
    const idx = Object.fromEntries(plan.nodes.map((n, i) => [n.title, i]));
    expect(idx["Clients"]).toBeLessThan(idx["Acme"]);
    // Every node's parent (if any) appears before it.
    const seen = new Set<string>();
    for (const n of plan.nodes) {
      if (n.parentTempId) expect(seen.has(n.parentTempId)).toBe(true);
      seen.add(n.tempId);
    }
  });

  it("a file whose parent folder has no page attaches to root", () => {
    const plan = planMdZipImport([{ path: "Orphans/Lonely.md", content: "z" }]);
    expect(plan.nodes).toHaveLength(1);
    expect(plan.nodes[0].parentTempId).toBeNull();
  });

  it("derives a title from the first heading when the filename is bare", () => {
    const plan = planMdZipImport([{ path: ".md", content: "# Real Title\nbody" }]);
    expect(plan.nodes[0].title).toBe("Real Title");
  });
});
