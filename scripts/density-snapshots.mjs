// Visual spot-check for the density / text-size appearance axes.
//
// Usage:
//   ./node_modules/.bin/sb dev -p 6106 --no-open   # in one shell
//   node scripts/density-snapshots.mjs             # in another
//
// Screenshots land in OUT (default /tmp/density-snaps), one per
// story × (density, text-size) combo, and the resolved token values are
// printed so regressions in the cascade are visible without opening images.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const PORT = process.env.SB_PORT ?? "6106";
const OUT = process.env.OUT ?? "/tmp/density-snaps";
mkdirSync(OUT, { recursive: true });

const BASE = `http://127.0.0.1:${PORT}/iframe.html`;
const stories = [
  "components-app-feature-panels-shell--primary",
  "components-ui-button--sizes",
  "components-ui-input--with-label",
];
const combos = [
  ["comfortable", "normal"],
  ["compact", "normal"],
  ["dense", "normal"],
  ["dense", "small"], // the full Linear-level end of the range
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });

for (const story of stories) {
  for (const [density, textSize] of combos) {
    const url = `${BASE}?id=${story}&viewMode=story&globals=density:${density};textSize:${textSize}`;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForSelector("#storybook-root > *", { timeout: 30000 });
    // let the appearance effect + fonts settle
    await page.waitForTimeout(400);
    const attrs = await page.evaluate(() => ({
      density: document.documentElement.getAttribute("data-density"),
      textSize: document.documentElement.getAttribute("data-text-size"),
      rowH: getComputedStyle(document.documentElement).getPropertyValue("--row-h").trim(),
      ctrlH: getComputedStyle(document.documentElement).getPropertyValue("--ctrl-h").trim(),
      textBase: getComputedStyle(document.documentElement).getPropertyValue("--text-base").trim(),
    }));
    console.log(story, density, textSize, JSON.stringify(attrs));
    const short = story.split("--")[0].split("-").slice(-2).join("-");
    await page.screenshot({ path: `${OUT}/${short}--${density}-${textSize}.png` });
  }
}

await browser.close();
console.log("done");
