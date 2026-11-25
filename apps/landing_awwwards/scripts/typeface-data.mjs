// Reads the two Oudom masters (UFO sources from the generator in docs/local/Moduo Joiner/nib)
// and writes the outlines the site draws with, every glyph in both masters plus kerning, to
// src/data/typeface/font.json. It's read at build time (the type page's sheet, the footer's plate,
// the OG cards); the type page ships the few glyphs its name needs to the browser itself.
// The masters are compatible by construction, so any weight is a straight mix of the two.
//
//   node scripts/typeface-data.mjs [path/to/ufo-folder]
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ufoDir = process.argv[2] ?? join(here, "../../../docs/local/Moduo Joiner/nib/out/ufo");
// The sources still carry the face's first name, Modus; the site calls it Oudom (DESIGN.md §16).
const L = join(ufoDir, "ModuoModus-Light.ufo");
const B = join(ufoDir, "ModuoModus-Bold.ufo");
const out = join(here, "../src/data/typeface");

// A tiny plist reader: dict, array, string, integer, real. Enough for UFO files.
function plist(xml) {
  const tokens = xml
    .replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/g, "")
    .replace(/<plist[^>]*>/, "<plist>")
    .match(/<\/?[a-z]+\/?>|[^<]+/g)
    .map((t) => t.trim())
    .filter(Boolean);
  let i = 0;
  const value = () => {
    const t = tokens[i++];
    if (t === "<plist>") {
      const v = value();
      i++;
      return v;
    }
    if (t === "<dict>") {
      const o = {};
      while (tokens[i] !== "</dict>") {
        i++; // <key>
        const k = tokens[i++];
        i++; // </key>
        o[k] = value();
      }
      i++;
      return o;
    }
    if (t === "<dict/>") return {};
    if (t === "<array>") {
      const a = [];
      while (tokens[i] !== "</array>") a.push(value());
      i++;
      return a;
    }
    if (t === "<array/>") return [];
    if (t === "<string>" || t === "<integer>" || t === "<real>") {
      let s = tokens[i];
      if (s.startsWith("</")) s = "";
      else i++;
      i++; // closing tag
      return t === "<string>"
        ? s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        : Number(s);
    }
    if (t === "<true/>") return true;
    if (t === "<false/>") return false;
    throw new Error(`plist: unexpected ${t}`);
  };
  return value();
}

const attrs = (tag) =>
  Object.fromEntries([...tag.matchAll(/([a-zA-Z]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

// One glif file: advance, unicodes, contours (points with type and smooth), components.
function glif(path) {
  const xml = readFileSync(path, "utf8");
  const advance = Number(attrs(/<advance[^>]*>/.exec(xml)?.[0] ?? "").width ?? 0);
  const unicodes = [...xml.matchAll(/<unicode hex="([0-9A-Fa-f]+)"/g)].map((m) =>
    parseInt(m[1], 16),
  );
  const contours = [...xml.matchAll(/<contour>([\s\S]*?)<\/contour>/g)].map((m) =>
    [...m[1].matchAll(/<point[^>]*\/>/g)].map((p) => {
      const a = attrs(p[0]);
      return {
        x: Number(a.x),
        y: Number(a.y),
        type: a.type ?? "offcurve",
        smooth: a.smooth === "yes",
      };
    }),
  );
  const components = [...xml.matchAll(/<component[^>]*\/>/g)].map((m) => {
    const a = attrs(m[0]);
    return { base: a.base, dx: Number(a.xOffset ?? 0), dy: Number(a.yOffset ?? 0) };
  });
  return { advance, unicodes, contours, components };
}

function master(ufo) {
  const contents = plist(readFileSync(join(ufo, "glyphs/contents.plist"), "utf8"));
  const glyphs = {};
  for (const [name, file] of Object.entries(contents))
    glyphs[name] = glif(join(ufo, "glyphs", file));
  return {
    info: plist(readFileSync(join(ufo, "fontinfo.plist"), "utf8")),
    glyphs,
    groups: plist(readFileSync(join(ufo, "groups.plist"), "utf8")),
    kerning: plist(readFileSync(join(ufo, "kerning.plist"), "utf8")),
  };
}

const light = master(L);
const bold = master(B);

// Point type codes: 0 off-curve, 1 line, 2 curve; +4 when the on-curve point is smooth.
const TYPE = { offcurve: 0, line: 1, curve: 2, qcurve: 2 };
const r = (v) => Math.round(v);

const glyphs = {};
const problems = [];
for (const name of Object.keys(light.glyphs)) {
  const a = light.glyphs[name];
  const b = bold.glyphs[name];
  if (!b) {
    problems.push(`${name}: missing in Bold`);
    continue;
  }
  if (a.contours.length !== b.contours.length) problems.push(`${name}: contour count`);
  const c = a.contours.map((ca, i) => {
    const cb = b.contours[i] ?? [];
    if (ca.length !== cb.length) problems.push(`${name}[${i}]: point count`);
    // Start on an on-curve point, so a reader can walk the segments in order.
    const start = Math.max(
      0,
      ca.findIndex((p) => p.type !== "offcurve"),
    );
    const flat = [];
    for (let k = 0; k < ca.length; k++) {
      const j = (start + k) % ca.length;
      const p = ca[j];
      const q = cb[j] ?? p;
      flat.push(TYPE[p.type] + (p.smooth ? 4 : 0), r(p.x), r(p.y), r(q.x), r(q.y));
    }
    return flat;
  });
  const k = a.components.map((ka, i) => {
    const kb = b.components[i] ?? ka;
    return [ka.base, r(ka.dx), r(ka.dy), r(kb.dx), r(kb.dy)];
  });
  glyphs[name] = { u: a.unicodes, w: [r(a.advance), r(b.advance)], c, ...(k.length ? { k } : {}) };
}

// Kerning, both masters side by side. Keys are glyph names or public.kern1/2 groups.
const kern = {};
for (const [m, src] of [
  [0, light.kerning],
  [1, bold.kerning],
]) {
  for (const [left, row] of Object.entries(src)) {
    for (const [right, v] of Object.entries(row)) {
      kern[left] ??= {};
      kern[left][right] ??= [0, 0];
      kern[left][right][m] = v;
    }
  }
}

const info = light.info;
const metrics = {
  upm: info.unitsPerEm,
  asc: info.ascender,
  desc: info.descender,
  xh: info.xHeight,
  cap: info.capHeight,
  lineAsc: info.openTypeHheaAscender,
  lineDesc: info.openTypeHheaDescender,
};
const font = {
  family: String(info.familyName).replace("Modus", "Oudom"),
  version: `${info.versionMajor}.${String(info.versionMinor).padStart(3, "0")}`,
  weights: [300, 700],
  metrics,
  glyphs,
  groups: light.groups,
  kern,
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "font.json"), JSON.stringify(font));
// The repo's formatter checks JSON too (bun fmt, bunfig.toml): leave the file as it would.
spawnSync("bun", ["fmt", join(out, "font.json")], { stdio: "ignore" });
const size = (f) => (readFileSync(join(out, f)).length / 1024).toFixed(0);
console.log(
  `${Object.keys(glyphs).length} glyphs, ${Object.keys(kern).length} kerning rows; font.json ${size("font.json")} KB`,
);
if (problems.length) console.log(`problems:\n  ${problems.join("\n  ")}`);
