// Writes apps/native/crates/tokens/tests/golden.json: what Chromium computes for every token in
// six appearances, so the Rust resolver can be checked against the browser (specs/native-foundation.md,
// NF-4). Run it again after a tokens.css change: `bun scripts/native/tokens-golden.ts`.
//
// Each token is read through registered custom properties, which make Chromium compute a typed
// value or fall back to a sentinel: a colour through color-mix() into srgb (so it comes back as
// floats, before any clipping), a length in px, a time, a number; shadows through box-shadow.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

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
  { name: "light-mono", attrs: { ...DEFAULTS, theme: "light", accent: "mono" } },
  { name: "dark-reduced-motion", attrs: { ...DEFAULTS, motion: "reduced" } },
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
const page = await browser.newPage({
  viewport: VIEWPORT,
  reducedMotion: "no-preference",
  colorScheme: "dark",
});
await page.setContent(
  `<!doctype html><html><head><style>${css}</style></head><body><div id="p"></div></body></html>`,
);

const out: Record<string, Record<string, Probe>> = {};
for (const appearance of APPEARANCES) {
  out[appearance.name] = await page.evaluate(
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
      const result: Record<string, Probe> = {};
      for (const name of names) {
        const text = getComputedStyle(html).getPropertyValue(`--${name}`).trim();
        p.style.cssText = "";
        p.style.setProperty(
          "--probe-color",
          `color-mix(in srgb, var(--${name}) 100%, transparent)`,
        );
        p.style.setProperty("--probe-length", `var(--${name})`);
        p.style.setProperty("--probe-time", `var(--${name})`);
        p.style.setProperty("--probe-number", `var(--${name})`);
        p.style.setProperty("box-shadow", `var(--${name})`);
        const cs = getComputedStyle(p);
        const probe: Probe = { text };
        const color = cs.getPropertyValue("--probe-color").trim();
        const m = /^color\(srgb ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)(?: \/ ([-\d.e]+))?\)$/.exec(color);
        if (m)
          probe.color = [
            Number(m[1]),
            Number(m[2]),
            Number(m[3]),
            m[4] === undefined ? 1 : Number(m[4]),
          ];
        const length = cs.getPropertyValue("--probe-length").trim();
        if (length !== "-12345px" && length.endsWith("px")) probe.px = Number(length.slice(0, -2));
        const time = cs.getPropertyValue("--probe-time").trim();
        if (time !== "-12345s")
          probe.ms = time.endsWith("ms")
            ? Number(time.slice(0, -2))
            : Number(time.slice(0, -1)) * 1000;
        const number = cs.getPropertyValue("--probe-number").trim();
        if (number !== "-12345") probe.number = Number(number);
        const shadow = cs.boxShadow;
        if (shadow && shadow !== "none" && /\dpx/.test(shadow)) probe.shadow = shadow;
        result[name] = probe;
      }
      return result;
    },
    { attrs: appearance.attrs, names },
  );
}
await browser.close();

const golden = { viewport: VIEWPORT, appearances: APPEARANCES, tokens: out };
writeFileSync(join(root, GOLDEN_JSON), `${JSON.stringify(golden, null, 2)}\n`);
Bun.spawnSync(["bun", "fmt", join(root, GOLDEN_JSON)]);
console.log(`wrote ${GOLDEN_JSON}: ${names.length} tokens × ${APPEARANCES.length} appearances`);
