// Writes apps/native/crates/tokens/tests/golden.json: what Chromium computes for every token in
// six appearances, so the Rust resolver can be checked against the browser (specs/native-foundation.md,
// NF-4). Run it again after a tokens.css change: `bun scripts/native/tokens-golden.ts`.
//
// Each token is read through registered custom properties, which make Chromium compute a typed
// value or fall back to a sentinel: a colour through color-mix() into srgb (so it comes back as
// floats, before any clipping), a length in px, a time, a number; shadows through box-shadow.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium, type Page } from "playwright";

import { TOKENS_CSS, TOKENS_JSON } from "./export-tokens";

export const GOLDEN_JSON = "apps/native/crates/tokens/tests/golden.json";
/** The window the native app opens at; the media layers depend on it. */
export const VIEWPORT = { width: 1280, height: 840 };

const DEFAULTS = {
  theme: "dark",
  shade: "black",
  accent: "mono",
  density: "comfortable",
  radius: "soft",
  font: "geist",
};

export const APPEARANCES: { name: string; attrs: Record<string, string> }[] = [
  { name: "dark", attrs: { ...DEFAULTS } },
  { name: "light", attrs: { ...DEFAULTS, theme: "light" } },
  { name: "dark-warm-violet", attrs: { ...DEFAULTS, shade: "warm", accent: "violet" } },
  { name: "dark-dense-sharp", attrs: { ...DEFAULTS, density: "dense", radius: "sharp" } },
  { name: "light-violet", attrs: { ...DEFAULTS, theme: "light", accent: "violet" } },
  { name: "dark-reduced-motion", attrs: { ...DEFAULTS, motion: "reduced" } },
];

/**
 * Appearances that need their own page: the system's reduced motion, the smallest window, and
 * a font. `tests/golden_extra.rs` checks them.
 */
export const EXTRA: {
  name: string;
  attrs: Record<string, string>;
  viewport: { width: number; height: number };
  reducedMotion: "reduce" | "no-preference";
}[] = [
  {
    name: "dark-system-reduced-motion",
    attrs: { ...DEFAULTS },
    viewport: VIEWPORT,
    reducedMotion: "reduce",
  },
  {
    name: "dark-smallest-window",
    attrs: { ...DEFAULTS },
    viewport: { width: 1024, height: 700 },
    reducedMotion: "no-preference",
  },
  {
    name: "dark-font-inter",
    attrs: { ...DEFAULTS, font: "inter" },
    viewport: VIEWPORT,
    reducedMotion: "no-preference",
  },
];

type Probe = {
  text: string;
  color?: number[];
  px?: number;
  ms?: number;
  number?: number;
  shadow?: string;
};

const root = join(import.meta.dir, "../..");
const css = readFileSync(join(root, TOKENS_CSS), "utf8");
const names = [
  ...new Set(
    (
      JSON.parse(readFileSync(join(root, TOKENS_JSON), "utf8")) as {
        layers: { set: Record<string, unknown> }[];
      }
    ).layers.flatMap((l) => Object.keys(l.set)),
  ),
].sort();

const browser = await chromium.launch();
const html = `<!doctype html><html><head><style>${css}</style></head><body><div id="p"></div></body></html>`;

async function probeAll(page: Page, attrs: Record<string, string>): Promise<Record<string, Probe>> {
  return page.evaluate(
    ({ attrs, names }) => {
      const html = document.documentElement;
      for (const a of Array.from(html.attributes))
        if (a.name.startsWith("data-")) html.removeAttribute(a.name);
      for (const [k, v] of Object.entries(attrs)) html.setAttribute(`data-${k}`, v);
      const register = (name: string, syntax: string, initialValue: string) => {
        try {
          CSS.registerProperty({ name, syntax, inherits: false, initialValue });
        } catch {
          // Registered on an earlier pass.
        }
      };
      register("--probe-color", "<color>", "rgb(1, 2, 3)");
      register("--probe-length", "<length>", "-12345px");
      register("--probe-time", "<time>", "-12345s");
      register("--probe-number", "<number>", "-12345");
      const p = document.getElementById("p")!;
      const read = (cs: CSSStyleDeclaration, prop: string) => cs.getPropertyValue(prop).trim();
      // Each reader returns undefined when the probe fell back to its sentinel (not that kind).
      const readers = {
        color: (cs: CSSStyleDeclaration) => {
          const m = /^color\(srgb ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)(?: \/ ([-\d.e]+))?\)$/.exec(
            read(cs, "--probe-color"),
          );
          return m ? [m[1], m[2], m[3], m[4] ?? "1"].map(Number) : undefined;
        },
        px: (cs: CSSStyleDeclaration) => {
          const v = read(cs, "--probe-length");
          return v !== "-12345px" && v.endsWith("px") ? Number(v.slice(0, -2)) : undefined;
        },
        ms: (cs: CSSStyleDeclaration) => {
          const v = read(cs, "--probe-time");
          if (v === "-12345s") return undefined;
          return v.endsWith("ms") ? Number(v.slice(0, -2)) : Number(v.slice(0, -1)) * 1000;
        },
        number: (cs: CSSStyleDeclaration) => {
          const v = read(cs, "--probe-number");
          return v === "-12345" ? undefined : Number(v);
        },
        shadow: (cs: CSSStyleDeclaration) => {
          const v = cs.boxShadow;
          return v && v !== "none" && /\dpx/.test(v) ? v : undefined;
        },
      };
      const probeOf = (name: string): Probe => {
        p.style.cssText = "";
        p.style.setProperty(
          "--probe-color",
          `color-mix(in srgb, var(--${name}) 100%, transparent)`,
        );
        for (const prop of ["--probe-length", "--probe-time", "--probe-number", "box-shadow"]) {
          p.style.setProperty(prop, `var(--${name})`);
        }
        const cs = getComputedStyle(p);
        const probe: Record<string, unknown> = { text: read(getComputedStyle(html), `--${name}`) };
        for (const [kind, reader] of Object.entries(readers)) {
          const value = reader(cs);
          if (value !== undefined) probe[kind] = value;
        }
        return probe as Probe;
      };
      const result: Record<string, Probe> = {};
      for (const name of names) result[name] = probeOf(name);
      return result;
    },
    { attrs, names },
  );
}

const page = await browser.newPage({
  viewport: VIEWPORT,
  reducedMotion: "no-preference",
  colorScheme: "dark",
});
await page.setContent(html);
const out: Record<string, Record<string, Probe>> = {};
for (const appearance of APPEARANCES) out[appearance.name] = await probeAll(page, appearance.attrs);

const extra: Record<string, Record<string, Probe>> = {};
for (const appearance of EXTRA) {
  const own = await browser.newPage({
    viewport: appearance.viewport,
    reducedMotion: appearance.reducedMotion,
    colorScheme: "dark",
  });
  await own.setContent(html);
  extra[appearance.name] = await probeAll(own, appearance.attrs);
  await own.close();
}
await browser.close();

const golden = {
  viewport: VIEWPORT,
  appearances: APPEARANCES,
  tokens: out,
  extra: { appearances: EXTRA, tokens: extra },
};
writeFileSync(join(root, GOLDEN_JSON), `${JSON.stringify(golden, null, 2)}\n`);
Bun.spawnSync(["bun", "fmt", join(root, GOLDEN_JSON)]);
console.log(`wrote ${GOLDEN_JSON}: ${names.length} tokens × ${APPEARANCES.length} appearances`);
