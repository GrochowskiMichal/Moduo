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

import {
  artworkSvg,
  canvasSvg,
  glassLayerSvg,
  macosIconSvg,
  markModule,
  ogBaseSvg,
  tileSvg,
} from "./compose";
import { packIco } from "./ico";
import { type Master, parseMaster } from "./masters";
import { artworkShare } from "./measure";
import { CANVAS, ICON_BLACK, ICON_WHITE, INK, PAPER } from "./palette";
import {
  AVATAR_MARK_SHARE,
  EMAIL_LOCKUP_CANVAS,
  EMAIL_MARK_DISPLAY_PX,
  EMAIL_MARK_SIZE,
  FAVICON_TAB_PX,
  markForDisplay,
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
// shape so a redrawn master needs no hand-entered numbers.
// Rounded and recorded, so the drift test (which can't load the native
// renderer) rebuilds the avatar from the same number.
const markFill = Number(artworkShare(mark).toFixed(6));
write(
  "brand/exports/measurements.json",
  `${JSON.stringify({ markArtworkShare: markFill }, null, 2)}\n`,
);

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
// Each file is drawn for the size it is *displayed* at (CSS px), which picks
// the small master: browser tabs show favicons at 16 px, even from the 32 px
// file meant for 2× screens; .ico's 32 and 48 serve Windows at 32/48 px.
function faviconSet(dir: string, background: string, fill: string): void {
  const tile = (displayPx: number, radius = TILE_RADIUS) =>
    tileSvg({ mark: markForDisplay(displayPx, mark, markSmall), background, fill, radius });
  const tab = tile(FAVICON_TAB_PX);
  write(`${dir}/favicon.svg`, tab);
  write(
    `${dir}/favicon.ico`,
    packIco([
      { size: 16, png: png(tab, 16) },
      { size: 32, png: png(tile(32), 32) },
      { size: 48, png: png(tile(48), 48) },
    ]),
  );
  write(`${dir}/favicon-32x32.png`, png(tab, 32));
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

// ── Email logos (the email kit's contract: spec.ts, TX-1 assets.ts) ─────
// "light" = for light emails (Ink artwork); "dark" = for dark mode (Paper).
// No halo (decision 74a): emails pick the file that matches the reader's mode.
const lockupCanvas = (fill: string) => canvasSvg({ master: lockup, fill, ...EMAIL_LOCKUP_CANVAS });
const markCanvas = (fill: string) =>
  canvasSvg({
    master: markForDisplay(EMAIL_MARK_DISPLAY_PX, mark, markSmall),
    fill,
    width: EMAIL_MARK_SIZE,
    height: EMAIL_MARK_SIZE,
  });
const emailSvgs: [string, string, number][] = [
  ["lockup-light", lockupCanvas(INK), EMAIL_LOCKUP_CANVAS.width],
  ["lockup-dark", lockupCanvas(PAPER), EMAIL_LOCKUP_CANVAS.width],
  ["mark-light", markCanvas(INK), EMAIL_MARK_SIZE],
  ["mark-dark", markCanvas(PAPER), EMAIL_MARK_SIZE],
];
const emailLogos: [string, Uint8Array][] = [];
for (const [base, svg, width] of emailSvgs) {
  write(`brand/exports/email/${base}.svg`, svg);
  const data = png(svg, width);
  write(`brand/exports/email/${base}@2x.png`, data);
  emailLogos.push([`${base}@2x.png`, data]);
}
// The email kit fixes the lockup box at 96:22. If a redrawn lockup no longer
// fills it edge to edge, the box (and assets.ts) should follow the new ratio.
const lockupRatio = lockup.viewBox[2] / lockup.viewBox[3];
const boxRatio = EMAIL_LOCKUP_CANVAS.width / EMAIL_LOCKUP_CANVAS.height;
const ratioDrift = Math.abs(lockupRatio - boxRatio) / boxRatio;

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
if (ratioDrift > 0.05) {
  console.log(
    `\n⚠ The lockup's ratio (${lockupRatio.toFixed(2)}) no longer matches the email box (${boxRatio.toFixed(2)}).\n` +
      "  Update EMAIL_LOCKUP_CANVAS in scripts/brand/spec.ts and LOCKUP_DISPLAY_* in\n" +
      "  supabase/functions/_shared/email/assets.ts together.",
  );
}
if (iconsChanged) {
  console.log(
    "\n⚠ The macOS icon sources changed. Rebuild the native icons and commit them:\n" +
      "  bun scripts/icons/build-macos-icon.ts && bun run icon:liquid",
  );
}
