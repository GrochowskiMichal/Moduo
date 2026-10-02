#!/usr/bin/env bun
/**
 * Scans src/**\/*.{ts,tsx} for arbitrary Tailwind values (and inline styles)
 * that bypass the design-system tokens — raw hex / color-function colors across
 * every color utility, arbitrary font-size / radius / spacing / shadow, the
 * motion-token bypass (duration-200 / duration-[180ms]), and static hex in
 * inline `style={{}}` props. Enforces AGENTS.md design-system rules 1–3 and
 * docs/DESIGN_RULES.md (token surface). Allowed: the sanctioned `[var(--token)]`
 * escape hatch, and one-off *geometry* (top-/left-/h-/w-/translate-/inset-[…])
 * which is never a design-system property. Paths in IGNORED_PATHS are skipped
 * (the RN shim + the curated legacy backlog). Exits non-zero on hits.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

type Pattern = { name: string; regex: RegExp };

// Color utilities that must use a semantic token, never an arbitrary value.
const COLOR_UTILS =
  "bg|text|border|ring|ring-offset|outline|decoration|divide|fill|stroke|caret|accent|from|via|to|shadow";

// Side/axis suffixes a color utility can carry: border-t-, divide-x-, border-s-…
const COLOR_UTIL_SIDES = "(?:-(?:t|r|b|l|s|e|x|y))?";

// Tailwind's built-in palette. These are NOT arbitrary values, so the
// `-[…]` patterns miss them entirely — but `text-red-400` bypasses the token
// layer exactly as hard as `text-[#f87171]` does (and drifts with the palette,
// not with the theme). Only the semantic tokens from tokens.css are legal.
const TW_PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

const PATTERNS: Pattern[] = [
  // Named palette utilities: text-red-400, bg-red-500/10, border-t-emerald-500.
  {
    name: "color-palette",
    regex: new RegExp(
      `\\b(?:${COLOR_UTILS})${COLOR_UTIL_SIDES}-(?:${TW_PALETTE})-\\d{2,3}(?:\\/\\d{1,3})?\\b`,
      "g",
    ),
  },
  // Absolute black/white — theme-blind by definition (`bg-white` stays white in
  // dark mode). Use `bg-background` / `text-foreground` / `bg-foreground/10`.
  {
    name: "color-absolute",
    regex: new RegExp(
      `\\b(?:${COLOR_UTILS})${COLOR_UTIL_SIDES}-(?:white|black)(?:\\/\\d{1,3})?\\b`,
      "g",
    ),
  },
  // Raw hex in any color utility: bg-[#fff], text-[#d4d8e1], border-t-[#222]…
  {
    name: "color-[#hex]",
    regex: new RegExp(`\\b(?:${COLOR_UTILS})${COLOR_UTIL_SIDES}-\\[#[0-9a-fA-F]{3,8}\\b`, "g"),
  },
  // Color functions in any color utility: bg-[rgb(...)], text-[oklch(...)]…
  {
    name: "color-[fn]",
    regex: new RegExp(
      `\\b(?:${COLOR_UTILS})${COLOR_UTIL_SIDES}-\\[(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color|hwb)\\(`,
      "g",
    ),
  },
  // Arbitrary font-size (px/rem/em) — use the text-* scale.
  { name: "text-[size]", regex: /\btext-\[\d+(?:\.\d+)?(?:px|rem|em)\]/g },
  // Arbitrary radius incl. side variants (rounded-t-[…], rounded-tl-[…]).
  { name: "rounded-[size]", regex: /\brounded(?:-[a-z]{1,2})?-\[\d+(?:\.\d+)?(?:px|rem|em|%)\]/g },
  // Arbitrary spacing: padding / margin / gap / space — NOT geometry (h/w/top/…).
  {
    name: "spacing-[size]",
    regex:
      /\b(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y)-\[\d+(?:\.\d+)?(?:px|rem|em)\]/g,
  },
  // Arbitrary shadow with a RAW color (#/rgb/hsl/oklch). Token-colored shadows
  // (e.g. an active-tab underline `shadow-[inset_0_-2px_0_0_var(--primary)]`)
  // are allowed — the violation is the hardcoded color, not the geometry.
  {
    name: "shadow-[rawcolor]",
    regex: /\bshadow-\[[^\]]*(?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|okl(?:ch|ab)\()[^\]]*\]/g,
  },
  // Custom font family/weight — use font-display/-sans/-mono.
  { name: "font-[name]", regex: /\bfont-\[(?!var\()[^\]\s]+\]/g },
  // Motion-token bypass — use duration-[var(--motion-*)] / the motion tokens.
  { name: "duration-[ms]", regex: /\bduration-\[(?!var\()[^\]]+\]/g },
  { name: "duration-NNN", regex: /\bduration-\d+\b/g },
  { name: "ease-[curve]", regex: /\bease-\[(?!var\()[^\]]+\]/g },
  // Static hex in inline style={{}} design props (runtime values like
  // `color: priority.color` are not quoted hex, so they don't match).
  {
    name: "style hex literal",
    regex:
      /\b(?:color|background|backgroundColor|border(?:Top|Right|Bottom|Left)?Color|outlineColor|fill|stroke|caretColor|boxShadow|textShadow)\s*:\s*["'`]#[0-9a-fA-F]{3,8}/g,
  },
];

const IGNORED_PATHS: string[] = [
  // This gate's own test fixtures — the probe strings ARE violations by design.
  "src/components/design-lint.test.ts",

  // React Native compatibility shim — intentionally untouched per AGENTS.md.
  "src/tw",

  // Subframe-generated code (synced from the Subframe project via the CLI).
  // Not hand-authored; it carries Subframe's own theme idioms, so it's exempt
  // from the design-system gate. The Subframe theme mirrors tokens.css.
  "src/ui",

  // Legacy baseline: files that still hold pre-foundation arbitrary
  // Tailwind values. Each is queued for its own per-feature brief; the
  // CI gate enforces "no new violations in clean files" without blocking
  // on legacy. Remove an entry when its feature brief lands.
  "src/features/brainstorm/ui/brainstorm-workspace.tsx",
  "src/features/brainstorm/ui/visual-templates/framework-poster.tsx",
  "src/features/brainstorm/ui/visual-templates/swot-visual.tsx",
  "src/features/dashboard/ui/dashboard-grid.tsx",
  "src/features/dashboard/ui/grid-workspace.tsx",
  "src/features/dashboard/ui/widget-container.tsx",
  "src/features/dashboard/ui/widgets-panel.tsx",
  "src/features/dashboard/ui/widgets/clock-widget.tsx",
  "src/features/dashboard/ui/widgets/countdown-widget.tsx",
  "src/features/dashboard/ui/widgets/crypto-widget.tsx",
  "src/features/dashboard/ui/widgets/hydration-widget.tsx",
  "src/features/dashboard/ui/widgets/job-tracker-widget.tsx",
  "src/features/dashboard/ui/widgets/notes-widget.tsx",
  "src/features/dashboard/ui/widgets/pomodoro-widget.tsx",
  "src/features/dashboard/ui/widgets/stock-widget.tsx",
  "src/features/dashboard/ui/widgets/tasks-widget.tsx",
  "src/features/dashboard/ui/widgets/todo-list-widget.tsx",
  "src/features/dashboard/ui/widgets/weather-widget.tsx",
  "src/features/dashboard/ui/widgets/widget-shell.tsx",
  "src/features/mindmap/ui/edge-style-menu.tsx",
  "src/features/mindmap/ui/mindmap-empty-state.tsx",
  "src/features/mindmap/ui/components/mindmap-relations.tsx",
  "src/features/mindmap/ui/components/mindmap-toolbar.tsx",
  "src/features/mindmap/ui/custom-node.tsx",
  "src/features/mindmap/ui/mindmap-workspace.tsx",
  "src/features/plan/ui/calendar-view.tsx",
  "src/features/plan/ui/kanban-task-context-modal.tsx",
  "src/features/plan/ui/kanban-view.tsx",
  "src/features/plan/ui/link-view.tsx",
  "src/features/plan/ui/list-view.tsx",
  "src/features/plan/ui/plan-nav.tsx",
  "src/features/plan/ui/plan-workspace.tsx",
  "src/features/plan/ui/project-settings-panel.tsx",
  "src/features/plan/ui/task-details-view.tsx",
  "src/features/tasks/ui/tasks-gantt.tsx",
  "src/features/templates/ui/templates-editor.tsx",
  "src/features/templates/ui/templates-preview.tsx",

  // Hardcoded color CONSTANTS / defaults (not Tailwind classes) surfaced when
  // the gate's color coverage was widened. Deferred to the curated label-color
  // palette work (an open question in docs/DESIGN_SYSTEM.md) + the per-feature briefs
  // for mindmap (legacy) and calendar (not built yet).
  "src/features/mindmap/ui/components/mindmap-mini-map.tsx",
  "src/features/mindmap/ui/types.ts",
  "src/features/calendar/hooks/use-slot-bookings-sync.ts",
];

const PROJECT_ROOT = process.cwd();
const SRC_ROOT = path.join(PROJECT_ROOT, "src");

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function isIgnored(relPath: string): boolean {
  const posix = toPosix(relPath);
  return IGNORED_PATHS.some((prefix) => posix === prefix || posix.startsWith(`${prefix}/`));
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      out.push(...(await walk(full)));
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        out.push(full);
      }
    }
  }
  return out;
}

type Hit = { file: string; line: number; column: number; pattern: string; match: string };

function scanFile(content: string, file: string): Hit[] {
  const hits: Hit[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { name, regex } of PATTERNS) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      // biome-ignore lint/suspicious/noAssignInExpressions: regex-drain idiom
      while ((match = regex.exec(line))) {
        hits.push({
          file,
          line: i + 1,
          column: match.index + 1,
          pattern: name,
          match: match[0],
        });
      }
    }
  }
  return hits;
}

async function main() {
  const files = await walk(SRC_ROOT);
  const allHits: Hit[] = [];

  for (const file of files) {
    const rel = toPosix(path.relative(PROJECT_ROOT, file));
    if (isIgnored(rel)) continue;
    const content = await fs.readFile(file, "utf8");
    const hits = scanFile(content, rel);
    allHits.push(...hits);
  }

  if (allHits.length === 0) {
    console.log("lint:tw — no arbitrary Tailwind values found in design-system surface.");
    return;
  }

  const byFile = new Map<string, Hit[]>();
  for (const hit of allHits) {
    const existing = byFile.get(hit.file) ?? [];
    existing.push(hit);
    byFile.set(hit.file, existing);
  }

  const fileCount = byFile.size;
  console.error(
    `lint:tw — ${allHits.length} arbitrary Tailwind value(s) across ${fileCount} file(s):`,
  );
  const sortedFiles = [...byFile.keys()].sort();
  for (const file of sortedFiles) {
    const hits = byFile.get(file)!;
    console.error(`\n  ${file}`);
    for (const hit of hits) {
      console.error(`    ${hit.line}:${hit.column}  ${hit.pattern}  ${hit.match}`);
    }
  }
  console.error(`\nlint:tw — design-system properties must use semantic tokens (see AGENTS.md).`);
  process.exit(1);
}

// Exported so the patterns are unit-testable (src/components/design-lint.test.ts)
// — a silently-broken regex here reads exactly like a clean codebase.
export { type Hit, isIgnored, PATTERNS, scanFile };

// `import.meta.main` under Bun (how `lint:tw` runs); the argv fallback keeps the
// gate alive under any runner that lacks it. A silent no-op here would report a
// clean design surface forever, so prefer over-running to under-running.
const meta = import.meta as ImportMeta & { main?: boolean };
const isDirectRun =
  typeof meta.main === "boolean"
    ? meta.main
    : Boolean(process.argv[1] && /check-arbitrary-tw\.[tj]s$/.test(process.argv[1]));

if (isDirectRun) {
  await main();
}
