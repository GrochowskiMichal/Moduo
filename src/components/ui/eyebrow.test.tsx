// DF-18 — the eyebrow is ONE spec. These cover the primitive itself plus the
// drift guard: the whole point of extracting it is that a fifth dialect can't
// quietly reappear at the feature layer.
import { promises as fs } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { Eyebrow, eyebrowVariants } from "./eyebrow";

afterEach(cleanup);

describe("Eyebrow", () => {
  it("renders the canonical recipe: body face, text-2xs, medium, uppercase, wide tracking, muted", () => {
    render(<Eyebrow>Linked</Eyebrow>);
    const el = screen.getByText("Linked");
    for (const cls of [
      "font-sans",
      "text-2xs",
      "font-medium",
      "uppercase",
      "tracking-wide",
      "text-muted-foreground",
    ]) {
      expect(el.className).toContain(cls);
    }
    expect(el.tagName).toBe("SPAN");
  });

  it("keeps the semantics of the markup it replaces via `as`", () => {
    render(<Eyebrow as="h3">People</Eyebrow>);
    expect(screen.getByText("People").tagName).toBe("H3");
  });

  it("tone=muted is the sub-eyebrow step; tone=inherit hands colour to the parent", () => {
    render(
      <>
        <Eyebrow tone="muted">Buckets</Eyebrow>
        <Eyebrow tone="inherit">Selected</Eyebrow>
      </>,
    );
    expect(screen.getByText("Buckets").className).toContain("text-muted-foreground/70");
    const inherit = screen.getByText("Selected").className;
    expect(inherit).not.toContain("text-muted-foreground");
  });

  it("tone=tag is quieter than a section header; tone=strong is the sanctioned louder step", () => {
    render(
      <>
        <Eyebrow tone="tag">References</Eyebrow>
        <Eyebrow tone="strong">12-word phrase</Eyebrow>
      </>,
    );
    const tag = screen.getByText("References").className;
    expect(tag).toContain("font-normal");
    expect(tag).not.toMatch(/(?:^|\s)font-medium(?:\s|$)/);

    const strong = screen.getByText("12-word phrase").className;
    expect(strong).toContain("font-semibold");
    expect(strong).toContain("tracking-widest");
    // Louder, but still on the ONE size step — emphasis must not re-fork the scale.
    expect(strong).toContain("text-2xs");
    expect(strong).not.toMatch(/(?:^|\s)tracking-wide(?:\s|$)/);
  });

  it("asChild carries the recipe onto an element with its own props", () => {
    render(
      <Eyebrow asChild>
        <label htmlFor="depth">Inbox history</label>
      </Eyebrow>,
    );
    const el = screen.getByText("Inbox history");
    expect(el.tagName).toBe("LABEL");
    expect(el.getAttribute("for")).toBe("depth");
    expect(el.className).toContain("text-2xs");
  });

  it("merges layout classes without letting them override the type recipe", () => {
    render(<Eyebrow className="sticky top-0 px-2 backdrop-blur">A</Eyebrow>);
    const el = screen.getByText("A");
    expect(el.className).toContain("sticky");
    expect(el.className).toContain("px-2");
    expect(el.className).toContain("text-2xs");
  });

  it("exposes the recipe for controls that must own their own element", () => {
    // The collapsible timeline section headers are <button>s wearing the eyebrow.
    expect(eyebrowVariants()).toContain("text-2xs");
    expect(eyebrowVariants({ tone: "muted" })).toContain("text-muted-foreground/70");
  });
});

/**
 * The guard that makes the extraction stick. `Eyebrow` is not "the preferred way"
 * to write a small-caps label — it is the ONLY way, so the 11px spec lives in
 * exactly one file. A hand-rolled `uppercase` className anywhere else fails this
 * test, whether or not it currently happens to match the recipe: an on-recipe
 * copy is precisely what re-forks the moment `eyebrowVariants` changes.
 *
 * Two files are exempt, each for a structural reason:
 */
const DRIFT_ALLOWLIST = new Set([
  // Quarantined legacy: the mindmap runs its own palette + type ladder entirely
  // (lint:tw IGNORED_PATHS). Migrated with the mindmap rethink, not before.
  "src/features/mindmap/ui/components/mindmap-relations.tsx",
  // cmdk renders its group headings itself, so the recipe has to be applied
  // through `[&_[cmdk-group-heading]]:` descendant variants, not the component.
  "src/components/ui/command.tsx",
]);

describe("eyebrow drift guard", () => {
  it("no hand-rolled small-caps label exists outside the documented allowlist", async () => {
    const root = path.resolve(__dirname, "../../..");
    const srcRoot = path.join(root, "src");

    // Skipped wholesale: src/ui is Subframe-generated (it carries Subframe's own
    // theme idioms, same exemption lint:tw grants), src/tw is the RN shim.
    const skipDirs = new Set([path.join(srcRoot, "ui"), path.join(srcRoot, "tw")]);

    const walk = async (dir: string): Promise<string[]> => {
      const out: string[] = [];
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || skipDirs.has(full)) continue;
          out.push(...(await walk(full)));
        } else if (
          entry.name.endsWith(".tsx") &&
          !entry.name.endsWith(".stories.tsx") &&
          !entry.name.endsWith(".test.tsx")
        ) {
          out.push(full);
        }
      }
      return out;
    };

    const self = path.join(srcRoot, "components", "ui", "eyebrow.tsx");
    const offenders: string[] = [];
    for (const file of await walk(srcRoot)) {
      if (file === self) continue;
      const rel = path.relative(root, file).split(path.sep).join("/");
      if (DRIFT_ALLOWLIST.has(rel)) continue;
      const lines = (await fs.readFile(file, "utf8")).split(/\r?\n/);
      lines.forEach((line, i) => {
        // Only className-ish lines: skip prose comments mentioning "uppercase".
        if (!/uppercase/.test(line) || /^\s*(?:\*|\/\/|\/\*)/.test(line)) return;
        offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
      });
    }

    expect(offenders).toEqual([]);
  });

  it("the guard can actually fail — it sees the two allowlisted files", async () => {
    for (const rel of DRIFT_ALLOWLIST) {
      const source = await fs.readFile(path.resolve(__dirname, "../../..", rel), "utf8");
      expect(source, rel).toMatch(/uppercase/);
    }
  });
});
