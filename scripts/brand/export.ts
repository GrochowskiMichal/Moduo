#!/usr/bin/env bun

/**
 * `bun run brand:export`: regenerate every brand file from brand/masters/.
 *
 * Writes brand/exports/ (the full set) and the consumers that ship it: the
 * web favicons in public/, the email logos in public/email/, the ModuoMark
 * path module, and the macOS icon sources. Deterministic: running it twice
 * changes nothing. Rules: .design/brand/BRAND_BRIEF.md §14.
 *
 * After a mark change, also rebuild the native icons:
 *   bun scripts/icons/build-macos-icon.ts && bun run icon:liquid
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

import { artworkSvg, glassLayerSvg, macosIconSvg, markModule, ogBaseSvg, tileSvg } from "./compose";
import { packIco } from "./ico";
import { type Master, parseMaster } from "./masters";
import { CANVAS, ICON_BLACK, ICON_WHITE, INK, PAPER } from "./palette";
import {
  AVATAR_MARK_SHARE,
  EMAIL_LOCKUP_WIDTH,
  EMAIL_MARK_WIDTH,
  markForTile,
  TILE_RADIUS,
} from "./spec";

const root = process.cwd();
const written: string[] = [];

function write(rel: string, data: string | Uint8Array): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, data);
  written.push(rel);
}

function readMaster(file: string): Master {
  return parseMaster(file, readFileSync(join(root, "brand/masters", file), "utf8"));
}

/** Render an SVG to PNG at an exact pixel width (height follows the aspect). */
function png(svg: string, width: number): Uint8Array {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: false },
  });
  return resvg.render().asPng();
}

const mark = readMaster("mark.svg");
const markSmall = existsSync(join(root, "brand/masters/mark-small.svg"))
  ? readMaster("mark-small.svg")
  : null;
const wordmark = readMaster("wordmark.svg");
const lockup = readMaster("lockup.svg");

for (const m of [mark, markSmall]) {
  if (m && m.viewBox[2] !== m.viewBox[3]) {
    throw new Error(`brand/masters/${m.name}: the viewBox must be square (it is the icon box).`);
  }
}

// How much of its own box the mark's artwork fills, measured from the
// rendered shape so a redrawn master needs no hand-entered numbers.
const markBox = new Resvg(artworkSvg(mark, CANVAS), {
  font: { loadSystemFonts: false },
}).getBBox();
if (!markBox) throw new Error("brand/masters/mark.svg renders empty.");
const markFill = markBox.width / mark.viewBox[2];

// ── SVG + PNG artwork ────────────────────────────────────────────────────
const artwork: [Master, number][] = [
  [mark, 128],
  [lockup, 320],
  [wordmark, 240],
];
const name = (m: Master) => m.name.replace(/\.svg$/, "");
for (const [m, baseWidth] of artwork) {
  write(`brand/exports/svg/${name(m)}-paper.svg`, artworkSvg(m, PAPER));
  write(`brand/exports/svg/${name(m)}-ink.svg`, artworkSvg(m, INK));
  write(`brand/exports/svg/${name(m)}-current.svg`, artworkSvg(m, "currentColor"));
  for (const [variant, fill] of [
    ["paper", PAPER],
    ["ink", INK],
  ] as const) {
    for (const scale of [1, 2, 3]) {
      write(
        `brand/exports/png/${name(m)}-${variant}@${scale}x.png`,
        png(artworkSvg(m, fill), baseWidth * scale),
      );
    }
  }
}

// ── Favicons (prod: black tile; staging: inverted) ──────────────────────
function faviconSet(dir: string, background: string, fill: string): void {
  const tile = (px: number, radius = TILE_RADIUS) =>
    tileSvg({ mark: markForTile(px, mark, markSmall), background, fill, radius });
  const at32 = png(tile(32), 32);
  write(`${dir}/favicon.svg`, tile(32));
  write(
    `${dir}/favicon.ico`,
    packIco([
      { size: 16, png: png(tile(16), 16) },
      { size: 32, png: at32 },
      { size: 48, png: png(tile(48), 48) },
    ]),
  );
  write(`${dir}/favicon-32x32.png`, at32);
  write(`${dir}/icon-192.png`, png(tile(192), 192));
  write(`${dir}/icon-512.png`, png(tile(512), 512));
  // iOS masks its own corners, so the touch icon is a full square.
  write(`${dir}/apple-touch-icon.png`, png(tile(180, 0), 180));
}
faviconSet("brand/exports/favicon/prod", CANVAS, PAPER);
faviconSet("brand/exports/favicon/staging", PAPER, CANVAS);

// ── Avatar: paper mark at ~55% of the width on Canvas black (brief §6) ──
const avatarScale = AVATAR_MARK_SHARE / markFill;
const avatar = tileSvg({
  mark,
  background: CANVAS,
  fill: PAPER,
  radius: 0,
  markScale: avatarScale,
});
write("brand/exports/avatar/avatar.svg", avatar);
write("brand/exports/avatar/avatar-1024.png", png(avatar, 1024));

// ── App icon ────────────────────────────────────────────────────────────
const macosIcon = macosIconSvg(mark, ICON_BLACK, ICON_WHITE);
write("brand/exports/png/app-icon-1024.png", png(macosIcon, 1024));

// ── Share-image base ────────────────────────────────────────────────────
const og = ogBaseSvg(lockup, CANVAS, PAPER);
write("brand/exports/og/og-base.svg", og);
write("brand/exports/og/og-base.png", png(og, 1200));

// ── Email logos (names and size per specs/transactional-email.md T6) ────
// "light" = for light emails (Ink artwork); "dark" = for dark mode (Paper).
const emailLogos: [string, Uint8Array][] = [
  ["lockup-light@2x.png", png(artworkSvg(lockup, INK), EMAIL_LOCKUP_WIDTH)],
  ["lockup-dark@2x.png", png(artworkSvg(lockup, PAPER), EMAIL_LOCKUP_WIDTH)],
  ["mark-light@2x.png", png(artworkSvg(mark, INK), EMAIL_MARK_WIDTH)],
  ["mark-dark@2x.png", png(artworkSvg(mark, PAPER), EMAIL_MARK_WIDTH)],
];
for (const [file, data] of emailLogos) write(`brand/exports/email/${file}`, data);

// ── Consumers ───────────────────────────────────────────────────────────
for (const file of [
  "favicon.svg",
  "favicon.ico",
  "favicon-32x32.png",
  "icon-192.png",
  "apple-touch-icon.png",
]) {
  write(`public/${file}`, readFileSync(join(root, "brand/exports/favicon/prod", file)));
}
for (const [file, data] of emailLogos) write(`public/email/${file}`, data);

// The native icons (src-tauri/icons) are built from these sources by separate
// tools (iconutil, actool), so say loudly when they need a rebuild.
const iconSources: [string, string][] = [
  ["scripts/icons/source/macos-icon-1024.svg", macosIcon],
  ["scripts/icons/source/Moduo.icon/Assets/moduo-mark.svg", glassLayerSvg(mark, ICON_WHITE)],
];
const iconsChanged = iconSources.some(
  ([rel, svg]) => !existsSync(join(root, rel)) || readFileSync(join(root, rel), "utf8") !== svg,
);
for (const [rel, svg] of iconSources) write(rel, svg);

const markModulePath = "src/components/ui/moduo-mark-path.ts";
write(markModulePath, markModule(mark, markSmall));

console.log(`brand:export wrote ${written.length} files from brand/masters/`);
for (const rel of written) console.log(`  ${rel}`);
if (!markSmall) console.log("  (no mark-small.svg yet: small sizes use the standard mark)");
if (iconsChanged) {
  console.log(
    "\n⚠ The macOS icon sources changed. Rebuild the native icons and commit them:\n" +
      "  bun scripts/icons/build-macos-icon.ts && bun run icon:liquid",
  );
}
