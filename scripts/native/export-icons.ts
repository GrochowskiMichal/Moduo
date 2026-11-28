// Writes the native app's icons and mark from the web app's own sources (specs/native-foundation.md,
// NF-5): every lucide icon the shell and Tasks import, at the lucide-react version the app pins,
// the custom ground-roots icon, and the Moduo mark. `moduo-ui`'s build script turns the folder
// into its `IconName` enum.
//
//   bun run native:icons            rewrite apps/native/assets/icons and assets/brand
//   bun run native:icons --check    exit 1 when they are stale (verify runs the test instead)
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as lucide from "lucide-react";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Icon } from "../../apps/app/src/components/ui/icon";
import {
  MODUO_MARK_PATHS,
  MODUO_MARK_VIEWBOX,
} from "../../apps/app/src/components/ui/moduo-mark-path";

export const ICONS_DIR = "apps/native/assets/icons";
export const BRAND_DIR = "apps/native/assets/brand";
/** Where the app imports icons from: the shell, the primitives and Tasks. */
export const SOURCE_DIRS = ["apps/app/src/components", "apps/app/src/features/tasks"];

const root = join(import.meta.dir, "../..");

/** "ChevronDownIcon" → "chevron-down"; lucide's own names, without the Icon alias suffix. */
export function kebab(component: string): string {
  return (
    component
      .replace(/Icon$/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
      // "Grid2x2" keeps its "2x2" together.
      .replace(/([a-zA-Z])(\d)/g, (m, a: string, d: string, at: number, s: string) =>
        a === "x" && /\d/.test(s[at - 1] ?? "") ? m : `${a}-${d}`,
      )
      .toLowerCase()
  );
}

/** Every lucide component imported by the source folders (aliases ending in Icon included). */
export function importedIcons(): string[] {
  const names = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(entry.name) && !/\.(test|stories)\./.test(entry.name)) {
        const text = readFileSync(join(root, rel), "utf8");
        for (const m of text.matchAll(
          /import\s*(?:type\s*)?\{([^}]+)\}\s*from\s*"lucide-react"/g,
        )) {
          for (const raw of m[1]!.split(",")) {
            const name = raw
              .trim()
              .replace(/^type\s+/, "")
              .split(/\s+as\s+/)[0]!
              .trim();
            if (name && name !== "LucideIcon" && name !== "LucideProps") names.add(name);
          }
        }
      }
    }
  };
  for (const dir of SOURCE_DIRS) walk(dir);
  return [...names].sort();
}

/** The files to write, by path relative to the repo root. */
export function exportIcons(): Map<string, string> {
  const files = new Map<string, string>();
  const icons = lucide as unknown as Record<string, ComponentType<Record<string, unknown>>>;
  for (const name of importedIcons()) {
    const component = icons[name];
    if (!component) throw new Error(`lucide-react has no ${name}`);
    files.set(
      `${ICONS_DIR}/${kebab(name)}.svg`,
      `${renderToStaticMarkup(createElement(component))}\n`,
    );
  }
  files.set(
    `${ICONS_DIR}/ground-roots.svg`,
    `${renderToStaticMarkup(createElement(Icon, { name: "ground-roots", size: 24 }))}\n`,
  );
  const paths = MODUO_MARK_PATHS.map(
    (p) =>
      `<path fill="currentColor" fill-rule="${p.fillRule}" clip-rule="${p.fillRule}" d="${p.d}"/>`,
  ).join("");
  files.set(
    `${BRAND_DIR}/moduo-mark.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MODUO_MARK_VIEWBOX}">${paths}</svg>\n`,
  );
  return files;
}

/** What is on disk now, in the same shape. */
export function committedIcons(): Map<string, string> {
  const files = new Map<string, string>();
  for (const dir of [ICONS_DIR, BRAND_DIR]) {
    let entries: string[] = [];
    try {
      entries = readdirSync(join(root, dir));
    } catch {
      continue;
    }
    for (const f of entries.filter((f) => f.endsWith(".svg"))) {
      files.set(`${dir}/${f}`, readFileSync(join(root, dir, f), "utf8"));
    }
  }
  return files;
}

if (import.meta.main) {
  const next = exportIcons();
  if (process.argv.includes("--check")) {
    const now = committedIcons();
    const same = now.size === next.size && [...next].every(([p, svg]) => now.get(p) === svg);
    if (!same) {
      console.error(`${ICONS_DIR} is stale: run bun run native:icons`);
      process.exit(1);
    }
  } else {
    for (const dir of [ICONS_DIR, BRAND_DIR]) {
      rmSync(join(root, dir), { recursive: true, force: true });
      mkdirSync(join(root, dir), { recursive: true });
    }
    for (const [path, svg] of next) writeFileSync(join(root, path), svg);
    console.log(`wrote ${next.size} files`);
  }
}
