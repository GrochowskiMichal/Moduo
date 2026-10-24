// Contact sheets and crops, drawn by the browser itself so the lab needs no image library:
// a small HTML page lays the frames out, and Playwright screenshots it.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * items: [{ file, caption }] (absolute paths). Writes `out` (png). Columns adapt to count.
 */
export async function contactSheet(browser, items, out, { title = "", width = 2400, columns } = {}) {
  const present = items.filter((i) => i.file && fs.existsSync(i.file));
  if (!present.length) return null;
  const cols = columns ?? (present.length <= 2 ? present.length : present.length <= 4 ? 2 : present.length <= 9 ? 3 : 4);
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#16161a;color:#e8e8ea;font:14px/1.4 -apple-system,system-ui,sans-serif;padding:20px;width:${width - 40}px}
    h1{font-size:18px;font-weight:600;margin:0 0 14px}
    .g{display:grid;grid-template-columns:repeat(${cols},1fr);gap:16px}
    figure{margin:0}img{max-width:100%;height:auto;display:block;border:1px solid #33333a;border-radius:4px;background:#000}
    figcaption{margin-top:6px;color:#b4b4bc;font-size:13px}
  </style><h1>${esc(title)}</h1><div class="g">${present
    .map((i) => `<figure><img src="${pathToFileURL(i.file).href}"><figcaption>${esc(i.caption ?? path.basename(i.file))}</figcaption></figure>`)
    .join("")}</div>`;
  const htmlFile = `${out}.html`;
  fs.writeFileSync(htmlFile, html);
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try {
    await page.goto(pathToFileURL(htmlFile).href);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    await page.screenshot({ path: out, fullPage: true });
  } finally {
    await ctx.close();
    fs.rmSync(htmlFile, { force: true });
  }
  return out;
}

/** Crop a region (with padding) out of a saved screenshot. */
export async function crop(browser, file, rect, out, { pad = 24, scale = 1 } = {}) {
  if (!fs.existsSync(file)) return null;
  const x = Math.max(0, Math.round(rect.x - pad));
  const y = Math.max(0, Math.round(rect.y - pad));
  const w = Math.max(16, Math.round(rect.w ?? rect.width) + pad * 2);
  const h = Math.max(16, Math.round(rect.h ?? rect.height) + pad * 2);
  const html = `<!doctype html><style>body{margin:0}img{display:block}</style><img src="${pathToFileURL(file).href}">`;
  const htmlFile = `${out}.html`;
  fs.writeFileSync(htmlFile, html);
  const ctx = await browser.newContext({ viewport: { width: 2000, height: 1400 }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  try {
    await page.goto(pathToFileURL(htmlFile).href);
    await page.waitForFunction(() => document.images[0]?.complete);
    const size = await page.evaluate(() => ({ w: document.images[0].naturalWidth, h: document.images[0].naturalHeight }));
    await page.setViewportSize({ width: Math.max(size.w, 16), height: Math.max(size.h, 16) });
    // A resize repaints; wait for the decoded image to be on screen before clipping it.
    await page.evaluate(() => document.images[0].decode());
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: out, clip: { x, y, width: Math.min(w, size.w - x), height: Math.min(h, size.h - y) } });
  } finally {
    await ctx.close();
    fs.rmSync(htmlFile, { force: true });
  }
  return out;
}
