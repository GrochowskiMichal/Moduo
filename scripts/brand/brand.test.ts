import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@rstest/core";

import { MODUO_MARK_PATHS, MODUO_MARK_VIEWBOX } from "../../src/components/ui/moduo-mark-path";
import { artworkSvg, placement, tileSvg } from "./compose";
import { packIco, pngSize } from "./ico";
import { parseMaster } from "./masters";
import { CANVAS, INK, oklchGrayToHex, PAPER } from "./palette";

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

// Drift guard: the shipped files must be what `bun run brand:export` makes
// from today's masters. If this fails, run `bun run brand:export` and commit.
describe("exports match the masters", () => {
  const mark = master("mark.svg");

  it("the SVG exports were made from today's masters", () => {
    for (const file of ["mark.svg", "wordmark.svg", "lockup.svg"]) {
      const exported = text(`brand/exports/svg/${file.replace(".svg", "")}-current.svg`);
      expect(exported).toBe(artworkSvg(master(file), "currentColor"));
    }
  });

  it("ModuoMark renders the master's path", () => {
    expect(MODUO_MARK_VIEWBOX).toBe(mark.viewBox.join(" "));
    expect(MODUO_MARK_PATHS).toEqual(mark.paths);
  });

  it("the web favicon and the macOS icon sources use the master's path", () => {
    expect(text("public/favicon.svg")).toBe(text("brand/exports/favicon/prod/favicon.svg"));
    for (const file of [
      "public/favicon.svg",
      "scripts/icons/source/macos-icon-1024.svg",
      "scripts/icons/source/Moduo.icon/Assets/moduo-mark.svg",
    ]) {
      for (const p of mark.paths) expect(text(file)).toContain(p.d);
    }
  });

  it("ships the email logos at the email spec's sizes", () => {
    for (const tone of ["light", "dark"]) {
      expect(pngSize(read(`public/email/lockup-${tone}@2x.png`)).width).toBe(192);
      expect(pngSize(read(`public/email/mark-${tone}@2x.png`))).toEqual({ width: 72, height: 72 });
    }
  });

  it("ships a three-size favicon.ico", () => {
    const ico = read("public/favicon.ico");
    const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
    expect(view.getUint16(4, true)).toBe(3);
    expect([ico[6], ico[22], ico[38]]).toEqual([16, 32, 48]);
  });
});
