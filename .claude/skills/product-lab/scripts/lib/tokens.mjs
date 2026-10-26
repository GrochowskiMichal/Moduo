// Token conformance and drift: which rendered values come from the design system's tokens,
// which are near-misses of a token (the sloppiness signal), and which are off the system.
// Near-misses are measured against the tokens, never between observed values, so a type scale
// with 1 px steps does not flag itself.
import fs from "node:fs";
import path from "node:path";

import { deltaE2000, rgbToLab, rgbaKey } from "./color.mjs";

export function tokenNames(files, root) {
  const names = new Set();
  for (const f of files ?? []) {
    let css = "";
    try {
      css = fs.readFileSync(path.resolve(root, f), "utf8");
    } catch {
      continue;
    }
    for (const m of css.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) names.add(m[1]);
  }
  return [...names];
}

/** In page: each token's computed value and kind, read on a probe inside the app's root. */
export function resolveTokens(names) {
  const host = document.querySelector("#root, #app, main") || document.body;
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:0";
  host.appendChild(probe);
  const out = [];
  const csHost = getComputedStyle(probe);
  for (const name of names) {
    const raw = csHost.getPropertyValue(name).trim();
    if (!raw) continue;
    let kind = null;
    let value = null;
    if (/^-?[\d.]+m?s$/.test(raw) && CSS.supports("transition-duration", raw)) {
      kind = "time";
      probe.style.transitionDuration = `var(${name})`;
      value = Number.parseFloat(getComputedStyle(probe).transitionDuration) * 1000;
    } else if (CSS.supports("color", raw) && !/^-?[\d.]+(px|rem|em|%)?$/.test(raw)) {
      kind = "color";
      probe.style.color = `var(${name})`;
      value = getComputedStyle(probe).color;
    } else if (/\d(px|rem|em)\b/.test(raw) && /(rgb|oklch|hsl|#|color|lab|lch)/i.test(raw) && CSS.supports("box-shadow", raw)) {
      kind = "shadow";
      probe.style.boxShadow = `var(${name})`;
      value = getComputedStyle(probe).boxShadow;
    } else if (/^-?[\d.]+(px|rem|em)$/.test(raw) || /^calc\(/.test(raw)) {
      kind = "length";
      probe.style.marginLeft = `var(${name})`;
      const v = getComputedStyle(probe).marginLeft;
      value = v.endsWith("px") ? Number.parseFloat(v) : null;
      if (value === null) kind = null;
    } else if (/^[\d.]+$/.test(raw)) {
      kind = "number";
      value = Number(raw);
    } else if (/,|serif|sans|mono|system-ui/.test(raw) && CSS.supports("font-family", raw)) {
      kind = "family";
      probe.style.fontFamily = `var(${name})`;
      value = getComputedStyle(probe).fontFamily.split(",")[0].replace(/["']/g, "").trim().toLowerCase();
    }
    probe.removeAttribute("style");
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:0";
    if (kind) out.push({ name, kind, value, raw: raw.slice(0, 80) });
  }
  probe.remove();
  return out;
}

/** In page: the styles every rendered element actually uses, one row per look-alike. */
export function harvest({ exclude, max }) {
  const rows = [];
  const seen = new Set();
  const excl = (exclude ?? []).join(",");
  const push = (fam, prop, value, el, sig) => {
    const key = `${sig}|${prop}|${value}`;
    if (seen.has(key) || rows.length >= max) return;
    seen.add(key);
    const r = el.getBoundingClientRect();
    const name = el.getAttribute("aria-label") || (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
    rows.push({ fam, prop, value, sig, where: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), tag: el.tagName.toLowerCase(), name } });
  };
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  for (const el of document.querySelectorAll("body *")) {
    if (rows.length >= max) break;
    if (excl && el.matches(excl)) continue;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "META", "LINK"].includes(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const sig = `${el.tagName}|${el.getAttribute("role") ?? ""}|${el.getAttribute("data-slot") ?? ""}|${[...el.classList].sort().slice(0, 5).join(".")}`;
    if (ownText(el)) {
      push("fontSize", "font-size", cs.fontSize, el, sig);
      push("lineHeight", "line-height", cs.lineHeight, el, sig);
      push("fontWeight", "font-weight", cs.fontWeight, el, sig);
      push("fontFamily", "font-family", cs.fontFamily.split(",")[0].replace(/["']/g, "").trim().toLowerCase(), el, sig);
      push("color", "color", cs.color, el, sig);
    }
    if (!/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) push("color", "background-color", cs.backgroundColor, el, sig);
    if (Number.parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none") push("color", "border-color", cs.borderTopColor, el, sig);
    const rad = cs.borderTopLeftRadius;
    if (rad && rad !== "0px" && !rad.includes("%")) push("radius", "border-radius", rad, el, sig);
    // Tailwind's ring and shadow layers default to transparent; only count shadows that show.
    const shadow = (cs.boxShadow || "none").replace(/(rgba\(0, 0, 0, 0\)|transparent) [^,]*(,\s*)?/g, "").replace(/,\s*$/, "").trim();
    if (shadow && shadow !== "none") push("shadow", "box-shadow", shadow, el, sig);
    for (const p of ["padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-bottom", "row-gap", "column-gap"]) {
      const v = cs.getPropertyValue(p);
      if (v && v !== "0px" && v !== "normal" && v.endsWith("px")) push("spacing", p, v, el, sig);
    }
    const dur = cs.transitionDuration.split(",").map((s) => s.trim()).filter((s) => s !== "0s");
    for (const d of dur) push("duration", "transition-duration", d, el, sig);
    if (cs.transitionProperty.split(",").some((s) => s.trim() === "all") && dur.length) push("transitionAll", "transition-property", "all", el, sig);
  }
  return rows;
}

/** In page: any CSS colour to [r, g, b, a] in 8-bit sRGB via a canvas. */
export function toRgba(colors) {
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const out = {};
  for (const col of colors) {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillStyle = col;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    out[col] = [d[0], d[1], d[2], Math.round((d[3] / 255) * 100) / 100];
  }
  return out;
}

const px = (v) => Number.parseFloat(v);

/** A computed box-shadow's layers: colour plus lengths (offset x, offset y, blur, spread). */
export function shadowLayers(v) {
  return String(v)
    .split(/,(?![^(]*\))/)
    .map((layer) => {
      const s = layer.trim();
      const color = /^([a-z-]+\([^)]*\)|#[0-9a-f]+|[a-z]+)/i.exec(s)?.[1] ?? null;
      const lengths = [...s.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
      return { color, lengths, inset: /\binset\b/.test(s) };
    })
    .filter((l) => l.color || l.lengths.length);
}
const named = (tokens, kind, pattern) => {
  const all = tokens.filter((t) => t.kind === kind && t.value != null);
  const hit = all.filter((t) => pattern.test(t.name));
  return hit.length ? hit : all;
};

/**
 * Node: classify harvested rows against the resolved tokens and score each family.
 * rows: [{fam, prop, value, sig, state, where}], tokens: [{name, kind, value}],
 * rgba: { cssColor: [r,g,b,a] } for every colour in rows and tokens.
 */
export function score(rows, tokens, rgba) {
  const colorTokens = tokens
    .filter((t) => t.kind === "color" && rgba[t.value])
    .map((t) => ({ ...t, rgba: rgba[t.value], lab: rgbToLab(rgba[t.value]) }));
  const sizes = named(tokens, "length", /text|font-size|size/);
  const radii = named(tokens, "length", /radius|rounded/);
  const leads = tokens.filter((t) => t.kind === "length" && /leading|line-height/.test(t.name));
  const times = named(tokens, "time", /duration|motion|speed/);
  const weights = tokens.filter((t) => t.kind === "number" && /weight/.test(t.name)).map((t) => t.value);
  const fontFamilies = new Set(tokens.filter((t) => t.kind === "family").map((t) => t.value));
  // The same transparent-layer stripping the harvest applies, so a token compares like for like.
  const bare = (s) => String(s).replace(/(rgba\(0, 0, 0, 0\)|transparent) [^,]*(,\s*)?/g, "").replace(/,\s*$/, "").trim();
  const shadows = new Set(tokens.filter((t) => t.kind === "shadow").map((t) => bare(t.value)));
  const spacingUnit = tokens.find((t) => t.name === "--spacing" && t.kind === "length")?.value || 4;

  const nearest = (list, v) => {
    let best = null;
    for (const t of list) {
      const d = Math.abs(t.value - v);
      if (!best || d < best.d) best = { name: t.name, value: t.value, d };
    }
    return best;
  };

  const classify = (row) => {
    const v = row.value;
    switch (row.fam) {
      case "color": {
        const c = rgba[v];
        if (!c || c[3] === 0) return { cls: "skip" };
        const lab = rgbToLab(c);
        let best = null;
        for (const t of colorTokens) {
          const d = deltaE2000(lab, t.lab);
          const alphaSame = Math.abs((t.rgba[3] ?? 1) - (c[3] ?? 1)) <= 0.02;
          const score = d + (alphaSame ? 0 : 0.0001);
          if (!best || score < best.score) best = { name: t.name, d, alphaSame, score };
        }
        if (!best) return { cls: "off", key: rgbaKey(c) };
        if (best.d < 0.6) return { cls: best.alphaSame ? "exact" : "derived", token: best.name };
        if (best.d < 3) return { cls: "near", token: best.name, dist: Math.round(best.d * 10) / 10, key: rgbaKey(c) };
        return { cls: "off", token: best.name, dist: Math.round(best.d * 10) / 10, key: rgbaKey(c) };
      }
      case "fontSize":
      case "radius":
      case "lineHeight": {
        if (row.fam === "lineHeight" && (v === "normal" || !leads.length)) return { cls: "skip" };
        const list = row.fam === "fontSize" ? sizes : row.fam === "radius" ? radii : leads;
        const n = nearest(list, px(v));
        if (!n) return { cls: "skip" };
        const tol = row.fam === "radius" ? 2 : 1.5;
        if (n.d <= 0.25) return { cls: "exact", token: n.name };
        if (row.fam === "radius" && px(v) >= 999) return { cls: "exact", token: "full" };
        if (n.d <= tol) return { cls: "near", token: n.name, dist: Math.round(n.d * 100) / 100, key: v };
        return { cls: "off", token: n.name, dist: Math.round(n.d * 100) / 100, key: v };
      }
      case "fontWeight":
        if (!weights.length) return { cls: "skip" };
        return weights.includes(Number(v)) ? { cls: "exact" } : { cls: "off", key: v };
      case "fontFamily":
        if (!fontFamilies.size) return { cls: "skip" };
        return fontFamilies.has(v) ? { cls: "exact" } : { cls: "off", key: v };
      case "shadow": {
        if (shadows.has(v)) return { cls: "exact" };
        const layers = shadowLayers(v);
        // A ring (no offset, no blur) is a border drawn as a shadow: judge it by its colour.
        if (layers.length && layers.every((l) => l.lengths[0] === 0 && l.lengths[1] === 0 && (l.lengths[2] ?? 0) === 0)) {
          const verdicts = layers.map((l) => (l.color ? classify({ fam: "color", value: l.color }) : { cls: "skip" }));
          if (verdicts.every((c) => c.cls === "exact" || c.cls === "derived" || c.cls === "skip")) return { cls: "derived", token: "ring" };
          const bad = verdicts.find((c) => c.cls === "near" || c.cls === "off");
          return { ...bad, key: `ring ${bad.key}` };
        }
        if (!shadows.size) return { cls: "skip" };
        // Same geometry as a token shadow with a theme's colour: derived, not drift.
        const geo = (s) => shadowLayers(s).map((l) => l.lengths.join(" ")).join(",");
        if ([...shadows].some((t) => geo(t) === geo(v))) return { cls: "derived", token: "shadow geometry" };
        return { cls: "off", key: v.slice(0, 90) };
      }
      case "spacing": {
        const n = Math.abs(px(v));
        if (n <= 1) return { cls: "exact", token: "hairline" };
        const half = spacingUnit / 2;
        const off = Math.abs(n / half - Math.round(n / half)) * half;
        if (off < 0.26) return { cls: "exact", token: "grid" };
        if (off <= 1) return { cls: "near", token: `${spacingUnit}px grid`, dist: Math.round(off * 100) / 100, key: v };
        return { cls: "off", token: `${spacingUnit}px grid`, key: v };
      }
      case "duration": {
        const ms = v.endsWith("ms") ? px(v) : px(v) * 1000;
        const n = nearest(times, ms);
        if (!n) return { cls: "skip" };
        if (n.d <= 5) return { cls: "exact", token: n.name };
        if (n.d <= 40) return { cls: "near", token: n.name, dist: Math.round(n.d), key: `${ms}ms` };
        return { cls: "off", token: n.name, dist: Math.round(n.d), key: `${ms}ms` };
      }
      case "transitionAll":
        return { cls: "off", key: "transition: all" };
      default:
        return { cls: "skip" };
    }
  };

  const WEIGHT = { color: 0.3, fontSize: 0.15, spacing: 0.15, radius: 0.1, duration: 0.1, lineHeight: 0.05, fontWeight: 0.05, fontFamily: 0.05, shadow: 0.05 };
  const fams = {};
  const findings = new Map();
  for (const row of rows) {
    const c = classify(row);
    if (c.cls === "skip") continue;
    const fam = row.fam === "transitionAll" ? "duration" : row.fam;
    const f = (fams[fam] ??= { total: 0, exact: 0, derived: 0, near: 0, off: 0, nearValues: new Set(), offValues: new Set(), values: new Map() });
    f.total++;
    f[c.cls]++;
    f.values.set(row.value, (f.values.get(row.value) ?? 0) + 1);
    if (c.cls === "near") f.nearValues.add(c.key);
    if (c.cls === "off") f.offValues.add(c.key);
    if (c.cls === "near" || c.cls === "off") {
      const id = `${fam}|${c.key}`;
      const item = findings.get(id) ?? { family: fam, prop: row.prop, value: c.key, cls: c.cls, nearest: c.token ?? null, distance: c.dist ?? null, count: 0, where: [] };
      item.count++;
      if (item.where.length < 3) item.where.push({ state: row.state, ...row.where });
      findings.set(id, item);
    }
  }

  const families = {};
  let weighted = 0;
  let weightSum = 0;
  for (const [fam, f] of Object.entries(fams)) {
    const coverage = (f.exact + f.derived) / f.total;
    const counts = [...f.values.values()];
    const total = counts.reduce((a, b) => a + b, 0);
    const shannon = -counts.reduce((h, c) => h + (c / total) * Math.log(c / total), 0);
    const simpson = 1 / counts.reduce((s, c) => s + (c / total) ** 2, 0);
    const s = Math.max(0, Math.min(100, 100 * coverage - Math.min(30, 4 * f.nearValues.size)));
    families[fam] = {
      observations: f.total,
      coverage: Math.round(coverage * 1000) / 10,
      nearMissValues: f.nearValues.size,
      offSystemValues: f.offValues.size,
      distinctValues: f.values.size,
      effectiveValues: { d1: Math.round(Math.exp(shannon) * 10) / 10, d2: Math.round(simpson * 10) / 10 },
      score: Math.round(s),
    };
    const w = WEIGHT[fam] ?? 0.05;
    weighted += w * s;
    weightSum += w;
  }
  const overall = weightSum ? Math.round(weighted / weightSum) : null;
  const band = overall == null ? null : overall >= 90 ? "Tight" : overall >= 75 ? "Minor drift" : overall >= 50 ? "Drifting" : "No working system";
  const top = [...findings.values()]
    .sort((a, b) => (a.cls === b.cls ? b.count - a.count : a.cls === "near" ? -1 : 1))
    .slice(0, 12);
  return { overall, band, families, top, tokenCount: tokens.length };
}
