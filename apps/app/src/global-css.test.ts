// DS-1 — thin token scrollbars are the global default (global.css). The cascade
// is the whole design: the default sits in the base layer at zero specificity
// so every utility, component rule and the `.no-scrollbar` opt-out (unlayered)
// beats it, and both engine paths (standard properties for Chromium and newer
// WebKit, ::-webkit-scrollbar for pre-18.2 WKWebView) are token-coloured.
import { promises as fs } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@rstest/core";

import { type CssBlock, cssBlocks, declarations } from "./styles/css-blocks";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFile(path.join(ROOT, rel), "utf8");

async function globalBlocks(): Promise<CssBlock[]> {
  return cssBlocks(await read("src/global.css"));
}

function block(blocks: CssBlock[], prelude: string, parents: string[]): Map<string, string> {
  const found = blocks.filter(
    (b) => b.prelude === prelude && b.parents.join(" > ") === parents.join(" > "),
  );
  expect({ prelude, parents, count: found.length }).toEqual({ prelude, parents, count: 1 });
  return declarations(found[0]);
}

/** Files under `dir` whose name matches `ext`, tests excluded. */
async function sourceFiles(dir: string, ext: RegExp): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(rel, ext)));
    else if (ext.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

describe("global.css scrollbars (DS-1)", () => {
  it("global thin scrollbar + webkit fallback + opt-out", async () => {
    const blocks = await globalBlocks();
    const base = ["@layer base"];

    // Standard path: every element, base layer, token thumb on a clear track.
    expect(Object.fromEntries(block(blocks, "*", base))).toEqual({
      "scrollbar-width": "thin",
      "scrollbar-color": "var(--scroll-thumb) transparent",
    });

    // WebKit path: a styled bar whose thumb uses the same tokens.
    expect(block(blocks, "::-webkit-scrollbar", base).get("width")).toBeTruthy();
    const thumb = block(blocks, "::-webkit-scrollbar-thumb", base);
    expect(thumb.get("background-color")).toBe("var(--scroll-thumb)");
    expect(block(blocks, "::-webkit-scrollbar-thumb:hover", base).get("background-color")).toBe(
      "var(--scroll-thumb-hover)",
    );

    // The opt-out is unlayered, so it beats the base-layer default on both paths.
    expect(block(blocks, ".no-scrollbar", []).get("scrollbar-width")).toBe("none");
    expect(block(blocks, ".no-scrollbar::-webkit-scrollbar", []).get("display")).toBe("none");

    // The old opt-in class stays as an alias of the default.
    expect(block(blocks, ".scrollbar-thin", []).get("scrollbar-color")).toBe(
      "var(--scroll-thumb) transparent",
    );
  });

  it("colours every scrollbar from the scroll-thumb tokens", async () => {
    const offenders = (await globalBlocks()).flatMap((b) =>
      [...declarations(b)]
        .filter(([prop]) => prop === "scrollbar-color")
        .filter(([, value]) => !value.startsWith("var(--scroll-thumb)"))
        .map(([, value]) => `${b.prelude}: ${value}`),
    );
    expect(offenders).toEqual([]);
  });

  it("reserves the gutter on pane scrollers, never on the shell wrappers", async () => {
    const blocks = await globalBlocks();
    expect(block(blocks, ".pane-scroll", []).get("scrollbar-gutter")).toBe("stable");
    // Except in a side panel, where the strip made a fill's right inset 11 px
    // wider than its left with classic bars (MOD-121 follow-up). The shell
    // marks both side panels with data-rail-mode.
    expect(block(blocks, "[data-rail-mode] .pane-scroll", []).get("scrollbar-gutter")).toBe("auto");
    expect(
      (await read("src/components/app/feature-panels-shell.tsx")).match(/data-rail-mode=/g),
    ).toHaveLength(2);

    // Representative center panes; each is the element that actually scrolls.
    for (const rel of [
      "src/features/tasks/ui/task-list-view.tsx",
      "src/features/notes/ui/note-editor.tsx",
      "src/features/email/ui/email-thread-list.tsx",
      "src/features/contacts/ui/contact-hub.tsx",
    ]) {
      expect({ rel, gutter: (await read(rel)).includes("pane-scroll") }).toEqual({
        rel,
        gutter: true,
      });
    }

    // The shell's wrappers hand scrolling to their child; a stable gutter on
    // them would draw a dead strip beside the child's own bar.
    const shell = await read("src/components/app/feature-panels-shell.tsx");
    expect(shell).not.toContain("pane-scroll");

    // Every pane-scroll must sit on an element that really scrolls: it owns
    // the overflow AND its height is tied to its parent (h-full / flex-1).
    // Without the height cap it just grows, and the gutter is a dead strip
    // (the notes Outline panel was exactly that).
    const offenders: string[] = [];
    for (const rel of await sourceFiles("src", /(?<!\.stories)\.tsx$/)) {
      for (const [, classes] of (await read(rel)).matchAll(
        /["'`]([^"'`]*\bpane-scroll\b[^"'`]*)["'`]/g,
      )) {
        const scrolls = /\boverflow(-y)?-auto\b/.test(classes);
        const capped = /\b(h-full|flex-1)\b/.test(classes);
        if (!scrolls || !capped) offenders.push(`${rel}: "${classes}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("hides scrollbars only through .no-scrollbar", async () => {
    // `scrollbar-width: none` alone leaves old WebKit drawing the global styled
    // bar; .no-scrollbar covers both engine paths.
    const offenders: string[] = [];
    for (const rel of await sourceFiles("src", /\.tsx?$/)) {
      const text = await read(rel);
      for (const pattern of [
        /\[scrollbar-width:none\]/,
        /\bscrollbar-none\b/,
        /::-webkit-scrollbar\]:hidden/,
      ]) {
        if (pattern.test(text)) offenders.push(`${rel}: ${pattern.source}`);
      }
    }
    for (const rel of await sourceFiles("src", /\.css$/)) {
      for (const b of cssBlocks(await read(rel))) {
        if (declarations(b).get("scrollbar-width") === "none" && b.prelude !== ".no-scrollbar") {
          offenders.push(`${rel}: ${b.prelude}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// MOD-161 — the app never scrolls sideways. A sideways swipe that runs out of
// a scroller (the Board at its end, Home's pages) stops at the page instead of
// rubber-banding the desktop app's WebKit view or swiping a browser back, and
// the shell clips rather than hides, so focus or a scroll to something off
// screen can't shift it. Headless Chromium neither chains nor rubber-bands a
// wheel, so the rest was checked live (docs/decisions/design-system.md).
describe("the app never scrolls sideways (MOD-161)", () => {
  it("stops a sideways overscroll at the page", async () => {
    expect(Object.fromEntries(block(await globalBlocks(), "html, body", []))).toEqual({
      "overscroll-behavior-x": "none",
    });
  });

  it("clips the shell's root and content area instead of hiding them", async () => {
    const chrome = await read("src/components/app/app-chrome.tsx");
    expect(chrome).toContain('"flex h-screen min-h-screen flex-col overflow-clip bg-background"');
    expect(chrome).toContain('"min-h-0 flex-1 overflow-clip"');
    expect(chrome).not.toMatch(/h-screen[^"]*overflow-hidden/);
    // …and the panels' group, through the library's one overridable style.
    expect(await read("src/components/ui/resizable.tsx")).toMatch(
      /style=\{\{ overflow: "clip", \.\.\.style \}\}/,
    );
  });
});
