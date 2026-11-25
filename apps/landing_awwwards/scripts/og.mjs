// Renders the share images: serves the OG build (.og-build, from `OG=1 astro build`), screenshots
// every /og/<slug> page at 1200 × 630 into public/og/<slug>.png, then removes the build.
// Run with `bun run og` after changing a title, the lockup or the chain.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { chromium } from "playwright";

const root = path.resolve(".og-build");
const out = path.resolve("public/og");
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const candidates = [
    path.join(root, url),
    path.join(root, `${url}.html`),
    path.join(root, url, "index.html"),
  ];
  const file = candidates.find(
    (f) => f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile(),
  );
  if (!file) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
// Any free port: another tool may hold the usual one.
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const slugs = fs
  .readdirSync(path.join(root, "og"))
  .filter((f) => f.endsWith(".html"))
  .map((f) => f.slice(0, -5));
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
for (const slug of slugs) {
  await page.goto(`http://127.0.0.1:${port}/og/${slug}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, `${slug}.png`) });
  console.log(`og: public/og/${slug}.png`);
}
await browser.close();
server.close();
fs.rmSync(root, { recursive: true, force: true });
