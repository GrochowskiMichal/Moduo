import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@rstest/core";

import { MODUO_MARK_PATHS, MODUO_MARK_VIEWBOX } from "../../src/components/ui/moduo-mark-path";
import {
  artworkSvg,
  canvasSvg,
  fmt,
  glassLayerSvg,
  macosIconSvg,
  markModule,
  ogBaseSvg,
  placement,
  tileSvg,
} from "./compose";
import { packIco, pngSize } from "./ico";
import { parseMaster } from "./masters";
import { CANVAS, ICON_BLACK, ICON_WHITE, INK, oklchGrayToHex, PAPER } from "./palette";
import {
  AVATAR_MARK_SHARE,
  EMAIL_LIGHT_HALO_PX,
  EMAIL_LOCKUP_CANVAS,
  EMAIL_MARK_SIZE,
  markForTile,
  TILE_RADIUS,
} from "./spec";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel));
const text = (rel: string) => readFileSync(join(root, rel), "utf8");
const master = (file: string) => parseMaster(file, text(`brand/masters/${file}`));

describe("parseMaster", () => {
  it("reads the viewBox and every path of a flat master", () => {
    const m = parseMaster(
      "x.svg",
      '<svg viewBox="0 0 10 20"><path d="M0 0H10V20Z" fill-rule="evenodd"/><path d="M1 1H2V2Z"/></svg>',
    );
    expect(m.viewBox).toEqual([0, 0, 10, 20]);
    expect(m.paths).toEqual([
      { d: "M0 0H10V20Z", fillRule: "evenodd" },
      // SVG's own default when the attribute is absent
      { d: "M1 1H2V2Z", fillRule: "nonzero" },
    ]);
  });

  it.each([
    ['<svg viewBox="0 0 1 1"><g transform="scale(2)"><path d="M0 0Z"/></g></svg>', /transform/],
    ['<svg viewBox="0 0 1 1"><g clip-path="url(#c)"><path d="M0 0Z"/></g></svg>', /clip path/],
    ['<svg viewBox="0 0 1 1"><path d="M0 0Z" stroke="#000"/></svg>', /stroke/],
    ['<svg viewBox="0 0 1 1"><text>moduo</text></svg>', /live text/],
    ['<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>', /non-path shape/],
    ['<svg><path d="M0 0Z"/></svg>', /viewBox/],
    ['<svg viewBox="0 0 1 1"></svg>', /no <path>/],
    ["<svg viewBox='0 0 1 1'><path d='M0 0Z' stroke='#000'/></svg>", /stroke/],
    ['<svg viewBox="0 0 1 1"><path d="M0 0Z" fill="none"/></svg>', /unfilled/],
    ['<svg viewBox="0 0 1 1"><path d="M0 0Z" fill-opacity="0.5"/></svg>', /transparency/],
    ['<svg viewBox="0 0 1 1"><g fill-rule="evenodd"><path d="M0 0Z"/></g></svg>', /on a group/],
    ['<svg viewBox="0 0 1 1" fill-rule="evenodd"><path d="M0 0Z"/></svg>', /root/],
    ['<svg viewBox="0 0 1 1" opacity="0.3"><path d="M0 0Z"/></svg>', /root/],
    ['<svg viewBox="0 0 1 1"><svg x="5"><path d="M0 0Z"/></svg></svg>', /nested/],
  ])("rejects a master that isn't flat paths (%#)", (svg, message) => {
    expect(() => parseMaster("bad.svg", svg)).toThrow(message);
  });

  it("reads single-quoted attributes and collapses wrapped path data", () => {
    const m = parseMaster(
      "x.svg",
      "<svg viewBox='0 0 4 4'><path fill-opacity='1' d='M0 0\n   H4\tV4Z'/></svg>",
    );
    expect(m.viewBox).toEqual([0, 0, 4, 4]);
    expect(m.paths[0].d).toBe("M0 0 H4 V4Z");
  });

  it('accepts Figma\'s export shape (fill="none" on the root, white paths)', () => {
    const m = parseMaster(
      "x.svg",
      '<svg width="20" height="10" viewBox="0 0 20 10" fill="none" xmlns="http://www.w3.org/2000/svg">\n<title>Moduo</title>\n<path fill-rule="evenodd" clip-rule="evenodd" d="M0 0H10V10Z" fill="white"/>\n<path d="M12 0H20V10Z" fill="white"/>\n</svg>\n',
    );
    expect(m.paths.map((p) => p.fillRule)).toEqual(["evenodd", "nonzero"]);
  });

  // Structure only, never the drawing: Maciej's redraw (BRAND-0) must pass.
  it("accepts every master in brand/masters", () => {
    const mark = master("mark.svg");
    expect(mark.viewBox[2]).toBe(mark.viewBox[3]);
    for (const file of ["mark.svg", "wordmark.svg", "lockup.svg"]) {
      expect(master(file).paths.length).toBeGreaterThan(0);
    }
  });
});

describe("compose", () => {
  it("prints no transform when a master already fills its box", () => {
    expect(placement(master("mark.svg"), 0, 0, 1000)).toBe("");
    expect(placement(master("mark.svg"), 12, 12, 1000)).toBe("translate(12 12)");
  });

  it("recolours every path and keeps the master's box", () => {
    const m = parseMaster(
      "x.svg",
      '<svg viewBox="10.5 20 300 80"><path d="M11 21H20Z" fill="#000"/><path d="M30 30H40Z"/></svg>',
    );
    const svg = artworkSvg(m, "#123456");
    expect(svg).toContain('viewBox="10.5 20 300 80"');
    expect(svg.match(/fill="#123456"/g)).toHaveLength(2);
    expect(placement(m, 0, 0, 600)).toBe("scale(2) translate(-10.5 -20)");
  });

  it("fits a master into a fixed canvas, left-aligned and vertically centred", () => {
    const m = parseMaster("x.svg", '<svg viewBox="0 0 100 20"><path d="M0 0H100V20Z"/></svg>');
    const svg = canvasSvg({ master: m, fill: "#000", width: 200, height: 50 });
    expect(svg).toContain('viewBox="0 0 200 50" width="200" height="50"');
    expect(svg).toContain('transform="translate(0 5) scale(2)"');
    expect(svg).not.toContain("stroke=");
    const haloed = canvasSvg({
      master: m,
      fill: "#000",
      width: 200,
      height: 50,
      haloPx: 2,
      haloFill: "#fff",
    });
    // Inset by the halo so the canvas edge never clips it: (200 − 4) / 100.
    expect(haloed).toContain('transform="translate(2 5.4) scale(1.96)"');
    expect(haloed).toContain('stroke="#fff"');
  });

  it("centres a scaled mark on its tile", () => {
    const svg = tileSvg({
      mark: master("mark.svg"),
      background: "#000",
      fill: "#fff",
      radius: 0,
      markScale: 0.5,
    });
    expect(svg).toContain('transform="translate(250 250) scale(0.5)"');
    expect(svg).not.toContain("rx=");
  });
});

describe("packIco", () => {
  it("writes a header, one entry per image and the PNG bytes at their offsets", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5]);
    const ico = packIco([
      { size: 16, png: a },
      { size: 256, png: b },
    ]);
    const view = new DataView(ico.buffer);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint16(4, true)).toBe(2);
    expect(ico[6]).toBe(16);
    expect(ico[22]).toBe(0); // 256 is written as 0
    expect(view.getUint32(6 + 12, true)).toBe(38);
    expect(Array.from(ico.slice(38, 41))).toEqual([1, 2, 3]);
    expect(Array.from(ico.slice(41))).toEqual([4, 5]);
  });
});

describe("palette", () => {
  const token = (name: string) => {
    const m = text("src/styles/tokens.css").match(
      new RegExp(`${name}:\\s*oklch\\(([\\d.]+) 0 0\\)`),
    );
    if (!m) throw new Error(`token ${name} not found as an achromatic oklch value`);
    return Number(m[1]);
  };

  it("mirrors the tokens it names", () => {
    expect(PAPER).toBe(oklchGrayToHex(token("--neutral-50")));
    expect(CANVAS).toBe(oklchGrayToHex(token("--background")));
    expect(INK).toBe(oklchGrayToHex(0.16));
  });
});

// Drift guard: the committed files must be exactly what `bun run brand:export`
// makes from today's masters, so a master or a rule changed without a
// re-export fails here. PNGs are rendered from these same SVGs in the same
// run; their bytes aren't compared because rasterisers differ by platform.
describe("exports match the masters", () => {
  const mark = master("mark.svg");
  const small = existsSync(join(root, "brand/masters/mark-small.svg"))
    ? master("mark-small.svg")
    : null;
  const lockup = master("lockup.svg");

  it("the SVG exports were made from today's masters", () => {
    for (const file of ["mark.svg", "wordmark.svg", "lockup.svg"]) {
      const base = `brand/exports/svg/${file.replace(".svg", "")}`;
      expect(text(`${base}-current.svg`)).toBe(artworkSvg(master(file), "currentColor"));
      expect(text(`${base}-paper.svg`)).toBe(artworkSvg(master(file), PAPER));
      expect(text(`${base}-ink.svg`)).toBe(artworkSvg(master(file), INK));
    }
  });

  it("ModuoMark renders the masters, byte for byte", () => {
    expect(text("src/components/ui/moduo-mark-path.ts")).toBe(markModule(mark, small));
    expect(MODUO_MARK_VIEWBOX).toBe(mark.viewBox.map(fmt).join(" "));
    expect(MODUO_MARK_PATHS).toEqual(mark.paths);
  });

  it("the favicons follow the masters and the tile rules", () => {
    const tile = (background: string, fill: string) =>
      tileSvg({ mark: markForTile(32, mark, small), background, fill, radius: TILE_RADIUS });
    expect(text("brand/exports/favicon/prod/favicon.svg")).toBe(tile(CANVAS, PAPER));
    expect(text("brand/exports/favicon/staging/favicon.svg")).toBe(tile(PAPER, CANVAS));
    expect(text("public/favicon.svg")).toBe(tile(CANVAS, PAPER));
  });

  it("the avatar follows the master and its share rule", () => {
    const avatar = tileSvg({
      mark,
      background: CANVAS,
      fill: PAPER,
      radius: 0,
      markScale:
        AVATAR_MARK_SHARE / JSON.parse(text("brand/exports/measurements.json")).markArtworkShare,
    });
    expect(text("brand/exports/avatar/avatar.svg")).toBe(avatar);
  });

  it("the macOS icon sources and the share-image base follow the masters", () => {
    expect(text("scripts/icons/source/macos-icon-1024.svg")).toBe(
      macosIconSvg(mark, ICON_BLACK, ICON_WHITE),
    );
    expect(text("scripts/icons/source/Moduo.icon/Assets/moduo-mark.svg")).toBe(
      glassLayerSvg(mark, ICON_WHITE),
    );
    expect(text("brand/exports/og/og-base.svg")).toBe(ogBaseSvg(lockup, CANVAS, PAPER));
  });

  it("ships the email logos on the email kit's exact canvases", () => {
    const lockupSvg = (fill: string, haloPx = 0) =>
      canvasSvg({ master: lockup, fill, ...EMAIL_LOCKUP_CANVAS, haloPx, haloFill: PAPER });
    const markSvg = (fill: string, haloPx = 0) =>
      canvasSvg({
        master: markForTile(EMAIL_MARK_SIZE, mark, small),
        fill,
        width: EMAIL_MARK_SIZE,
        height: EMAIL_MARK_SIZE,
        haloPx,
        haloFill: PAPER,
      });
    expect(text("brand/exports/email/lockup-light.svg")).toBe(lockupSvg(INK, EMAIL_LIGHT_HALO_PX));
    expect(text("brand/exports/email/lockup-dark.svg")).toBe(lockupSvg(PAPER));
    expect(text("brand/exports/email/mark-light.svg")).toBe(markSvg(INK, EMAIL_LIGHT_HALO_PX));
    expect(text("brand/exports/email/mark-dark.svg")).toBe(markSvg(PAPER));
    for (const tone of ["light", "dark"]) {
      expect(pngSize(read(`public/email/lockup-${tone}@2x.png`))).toEqual(EMAIL_LOCKUP_CANVAS);
      expect(pngSize(read(`public/email/mark-${tone}@2x.png`))).toEqual({
        width: EMAIL_MARK_SIZE,
        height: EMAIL_MARK_SIZE,
      });
    }
  });

  it("ships a three-size favicon.ico", () => {
    const ico = read("public/favicon.ico");
    const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
    expect(view.getUint16(4, true)).toBe(3);
    expect([ico[6], ico[22], ico[38]]).toEqual([16, 32, 48]);
  });
});

describe("the small master", () => {
  const mark = parseMaster("mark.svg", '<svg viewBox="0 0 10 10"><path d="M1 1H9V9Z"/></svg>');
  const small = parseMaster(
    "mark-small.svg",
    '<svg viewBox="0 0 10 10"><path d="M2 2H8V8Z"/></svg>',
  );

  it("takes over for tiles of 32 px and below once it exists", () => {
    expect(markForTile(16, mark, small)).toBe(small);
    expect(markForTile(32, mark, small)).toBe(small);
    expect(markForTile(48, mark, small)).toBe(mark);
    expect(markForTile(16, mark, null)).toBe(mark);
  });

  it("feeds ModuoMark's small drawing, falling back to the standard mark", () => {
    expect(markModule(mark, small)).toContain(
      'MODUO_MARK_SMALL_PATHS: readonly { d: string; fillRule: "evenodd" | "nonzero" }[] = [\n  {\n    d: "M2 2H8V8Z"',
    );
    expect(markModule(mark, null)).toContain(
      'MODUO_MARK_SMALL_PATHS: readonly { d: string; fillRule: "evenodd" | "nonzero" }[] = [\n  {\n    d: "M1 1H9V9Z"',
    );
  });
});
