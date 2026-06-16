#!/usr/bin/env bun
/**
 * Scans src/**\/*.{ts,tsx} for arbitrary Tailwind values that bypass the
 * design-system tokens (raw hex colors, pixel sizing, custom fonts). Allowed
 * paths in IGNORED_PATHS are skipped (e.g. the React-Native compatibility
 * shim, which is intentionally untouched). Exits non-zero on hits.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

type Pattern = { name: string; regex: RegExp };

const PATTERNS: Pattern[] = [
  { name: "bg-[#hex]", regex: /\bbg-\[#[0-9a-fA-F]{3,8}\b/g },
  { name: "p-[Npx]", regex: /\bp-\[\d+(?:\.\d+)?px\]/g },
  { name: "text-[Npx]", regex: /\btext-\[\d+(?:\.\d+)?px\]/g },
  { name: "rounded-[Npx]", regex: /\brounded-\[\d+(?:\.\d+)?px\]/g },
  { name: "font-[name]", regex: /\bfont-\[[^\]\s]+\]/g },
];

const IGNORED_PATHS: string[] = [
  // React Native compatibility shim — intentionally untouched per CLAUDE.md.
  "src/tw",

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
  "src/features/email/ui/email-workspace.tsx",
  // Children the structural refactor extracted out of the (already-exempt)
  // email-workspace + mindmap-workspace above. Same pre-foundation legacy
  // values, just relocated; queued to migrate with their feature briefs.
  "src/features/email/ui/email-account-sidebar.tsx",
  "src/features/email/ui/email-compose-panel.tsx",
  "src/features/email/ui/email-connection-setup.tsx",
  "src/features/email/ui/email-message-detail.tsx",
  "src/features/email/ui/email-message-list.tsx",
  "src/features/mindmap/ui/edge-style-menu.tsx",
  "src/features/mindmap/ui/mindmap-empty-state.tsx",
  "src/features/mindmap/ui/components/mindmap-relations.tsx",
  "src/features/mindmap/ui/components/mindmap-toolbar.tsx",
  "src/features/mindmap/ui/custom-node.tsx",
  "src/features/mindmap/ui/mindmap-workspace.tsx",
  "src/features/notes/editor/LexicalNoteEditor.tsx",
  "src/features/notes/editor/nodes/EmbeddedMindmap.tsx",
  "src/features/notes/editor/nodes/EmbeddedTask.tsx",
  "src/features/notes/editor/plugins/SlashCommandPlugin.tsx",
  "src/features/notes/ui/NotesSplitView.tsx",
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
  "src/routes/pages/onboarding-page.tsx",
  "src/routes/pages/paywall-page.tsx",
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
    `lint:tw — ${allHits.length} arbitrary Tailwind value(s) across ${fileCount} file(s):`
  );
  const sortedFiles = [...byFile.keys()].sort();
  for (const file of sortedFiles) {
    const hits = byFile.get(file)!;
    console.error(`\n  ${file}`);
    for (const hit of hits) {
      console.error(`    ${hit.line}:${hit.column}  ${hit.pattern}  ${hit.match}`);
    }
  }
  console.error(
    `\nlint:tw — design-system properties must use semantic tokens (see CLAUDE.md).`
  );
  process.exit(1);
}

await main();
