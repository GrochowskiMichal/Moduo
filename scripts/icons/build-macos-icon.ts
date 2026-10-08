#!/usr/bin/env bun

/**
 * Build src-tauri/icons/icon.icns + the cross-platform PNG fallbacks from
 * scripts/icons/source/macos-icon-1024.svg.
 *
 * Renders the source SVG via @resvg/resvg-js (Rust-backed; no native deps,
 * reliable across macOS versions), writes PNGs at every size macOS expects,
 * and packages them through `iconutil`. Run from the repo root:
 *
 *   bun scripts/icons/build-macos-icon.ts
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const repoRoot = process.cwd();
const sourceSvg = join(repoRoot, "scripts/icons/source/macos-icon-1024.svg");
const icnsOut = join(repoRoot, "src-tauri/icons/icon.icns");
const iconsDir = join(repoRoot, "src-tauri/icons");

const svg = readFileSync(sourceSvg);

function render(width: number): Buffer {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width } });
  return resvg.render().asPng();
}

function write(path: string, buf: Buffer): void {
  writeFileSync(path, buf);
  console.log(`  → ${path} (${buf.byteLength.toLocaleString()} bytes)`);
}

const workDir = mkdtempSync(join(tmpdir(), "moduo-icon-"));
const iconsetDir = join(workDir, "icon.iconset");
spawnSync("mkdir", ["-p", iconsetDir]);

console.log("rendering iconset PNGs");

type Entry = { name: string; px: number };
const entries: Entry[] = [
  { name: "icon_16x16.png", px: 16 },
  { name: "icon_16x16@2x.png", px: 32 },
  { name: "icon_32x32.png", px: 32 },
  { name: "icon_32x32@2x.png", px: 64 },
  { name: "icon_128x128.png", px: 128 },
  { name: "icon_128x128@2x.png", px: 256 },
  { name: "icon_256x256.png", px: 256 },
  { name: "icon_256x256@2x.png", px: 512 },
  { name: "icon_512x512.png", px: 512 },
  { name: "icon_512x512@2x.png", px: 1024 },
];

for (const { name, px } of entries) {
  write(join(iconsetDir, name), render(px));
}

console.log("packaging icon.icns");
const pack = spawnSync("iconutil", ["-c", "icns", iconsetDir, "-o", icnsOut], {
  stdio: "inherit",
});
if (pack.status !== 0) {
  console.error("iconutil failed");
  process.exit(1);
}

console.log("refreshing cross-platform PNGs");
write(join(iconsDir, "32x32.png"), render(32));
write(join(iconsDir, "64x64.png"), render(64));
write(join(iconsDir, "128x128.png"), render(128));
write(join(iconsDir, "128x128@2x.png"), render(256));

rmSync(workDir, { recursive: true, force: true });

console.log(`✓ wrote ${icnsOut}`);
