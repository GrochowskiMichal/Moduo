#!/usr/bin/env bun
/**
 * Compile the macOS 26 "Liquid Glass" app icon.
 *
 * Source of truth is scripts/icons/source/Moduo.icon (an Icon Composer
 * bundle: icon.json manifest + Assets/ layers). This script runs Apple's
 * `actool` to compile it into src-tauri/icons/Assets.car, which Tauri ships
 * in the app bundle's Contents/Resources. Paired with CFBundleIconName in
 * src-tauri/Info.plist, macOS Tahoe renders the layered glass icon (light /
 * dark / clear / tinted appearances, system squircle + specular). On macOS
 * 25 and earlier the system falls back to icons/icon.icns.
 *
 * Requires full Xcode (actool ships with Xcode, not the Command Line Tools).
 * Run from the repo root:
 *
 *   bun scripts/icons/build-liquid-icon.ts
 *
 * Re-run whenever scripts/icons/source/Moduo.icon changes, then rebuild the
 * desktop app. The compiled Assets.car is committed so non-macOS / no-Xcode
 * builds still work.
 */

import { mkdtempSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/** Icon set name — must match CFBundleIconName in src-tauri/Info.plist. */
const ICON_NAME = "Moduo";
/** Lowest macOS that reads the layered .icon. Older versions use icon.icns. */
const MIN_TARGET = "26.0";

const repoRoot = process.cwd();
const iconSource = join(repoRoot, "scripts/icons/source", `${ICON_NAME}.icon`);
const carOut = join(repoRoot, "src-tauri/icons/Assets.car");

if (!existsSync(iconSource)) {
  console.error(`source icon not found: ${iconSource}`);
  process.exit(1);
}

const actool = spawnSync("xcrun", ["--find", "actool"], { encoding: "utf8" });
if (actool.status !== 0) {
  console.error(
    "actool not found. Install full Xcode (the Command Line Tools alone do " +
      "not ship actool), then: sudo xcode-select -s /Applications/Xcode.app",
  );
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), "moduo-liquid-icon-"));

console.log(`compiling ${ICON_NAME}.icon → Assets.car (actool)`);
const compile = spawnSync(
  "xcrun",
  [
    "actool",
    iconSource,
    "--compile", workDir,
    "--app-icon", ICON_NAME,
    "--output-partial-info-plist", join(workDir, "partial.plist"),
    "--minimum-deployment-target", MIN_TARGET,
    "--platform", "macosx",
    "--target-device", "mac",
    "--output-format", "human-readable-text",
    "--notices", "--warnings", "--errors",
    "--include-all-app-icons",
    "--enable-on-demand-resources", "NO",
    "--development-region", "en",
  ],
  { stdio: "inherit" },
);

if (compile.status !== 0) {
  rmSync(workDir, { recursive: true, force: true });
  console.error("actool failed");
  process.exit(1);
}

const builtCar = join(workDir, "Assets.car");
if (!existsSync(builtCar)) {
  rmSync(workDir, { recursive: true, force: true });
  console.error("actool did not emit Assets.car");
  process.exit(1);
}

copyFileSync(builtCar, carOut);
rmSync(workDir, { recursive: true, force: true });

console.log(`✓ wrote ${carOut}`);
console.log(
  "  bundled via tauri.conf.json bundle.resources; CFBundleIconName is set " +
    "in src-tauri/Info.plist. Rebuild the desktop app to apply.",
);
