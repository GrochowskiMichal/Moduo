// CV-0 spike 1: run the harness in Playwright's Chromium (headed: headless
// rasterises in software and overstates long frames) and wait for the
// collector to have every library's results.
//   bun scripts/spikes/chat/s1/run-chromium.ts <devPort> <collectPort> [libs] [extra query]
// The dev server and the collector must be running (see the record).

import { chromium } from "@playwright/test";

const devPort = Number(process.argv[2] ?? 8391);
const collectPort = Number(process.argv[3] ?? 8392);
const libs = (process.argv[4] ?? "tanstack").split(",");
const extra = process.argv[5] ?? "";
const engine = process.env.S1_ENGINE ?? "chromium";
const headless = process.env.S1_HEADLESS === "1";

const browser = await chromium.launch({ headless });
const page = await browser.newPage({
  viewport: { width: 1280, height: 840 },
  deviceScaleFactor: Number(process.env.S1_DPR ?? 1),
});
page.on("pageerror", (e) => console.error("[page error]", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.error("[console]", m.text());
});
const collect = `http://127.0.0.1:${collectPort}/`;
const url = `http://127.0.0.1:${devPort}/?auto=1&engine=${engine}&libs=${libs.join(",")}&collect=${encodeURIComponent(collect)}${extra ? `&${extra}` : ""}`;
console.log(`[chromium] ${url}`);
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => "__s1Done" in window, undefined, {
  timeout: 30 * 60_000,
  polling: 1000,
});
const done = (await page.evaluate(
  () => (window as unknown as { __s1Done: unknown }).__s1Done,
)) as Record<
  string,
  Array<{ scenario: string; config: string; pass: boolean | null; note?: string }>
>;
for (const [lib, results] of Object.entries(done)) {
  for (const r of results) {
    const mark = r.pass === null ? "·" : r.pass ? "PASS" : "FAIL";
    console.log(
      `${mark.padEnd(4)} ${lib}/${r.config}/${r.scenario}${r.note ? ` (${r.note})` : ""}`,
    );
  }
}
console.log(`[chromium] done in ${Math.round((Date.now() - t0) / 1000)} s`);
await browser.close();
