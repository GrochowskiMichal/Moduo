import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// Makes auto mode the default permission mode for your interactive Claude Code sessions (HV-1, AC6).
// Claude Code ignores `defaultMode: "auto"` in project settings, so it goes in your user settings:
//   bun run agent:auto-mode            (~/.claude/settings.json; other keys are kept)
// Unattended lanes run bypass inside srt instead (scripts/agent/lane.sh).

export function withAutoMode(settings: Record<string, unknown>): Record<string, unknown> {
  const permissions = (settings.permissions ?? {}) as Record<string, unknown>;
  return { ...settings, permissions: { ...permissions, defaultMode: "auto" } };
}

export function applyAutoMode(file: string): void {
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(withAutoMode(current), null, 2)}\n`);
}

if (import.meta.main) {
  const file = process.argv[2] ?? path.join(homedir(), ".claude", "settings.json");
  applyAutoMode(file);
  console.log(`Auto mode is now the default in ${file}. New sessions start in it.`);
}
