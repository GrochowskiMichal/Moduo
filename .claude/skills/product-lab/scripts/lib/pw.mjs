// Playwright and axe-core, resolved from the project the lab runs in (never installed by the
// lab itself). The axe fallback and its pinned hash follow juliobsz/skills (MIT).
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const req = createRequire(path.join(process.cwd(), "noop.js"));

export async function loadPlaywright() {
  for (const name of ["playwright", "playwright-core", "@playwright/test"]) {
    try {
      const mod = await import(pathToFileURL(req.resolve(name)).href);
      const pw = mod.default?.chromium ? mod.default : mod;
      if (pw.chromium) return pw;
    } catch {}
  }
  throw new Error(
    "Playwright not found from this folder. Run the lab from the project root (npm i -D playwright).",
  );
}

export async function launch(engine, { headed = false, cdpPort = null } = {}) {
  const pw = await loadPlaywright();
  const type = pw[engine];
  if (!type) throw new Error(`Unknown engine "${engine}" (chromium | webkit)`);
  const args =
    engine === "chromium"
      ? ["--ignore-gpu-blocklist", ...(cdpPort ? [`--remote-debugging-port=${cdpPort}`] : [])]
      : [];
  try {
    return await type.launch({ headless: !headed, args });
  } catch (e) {
    if (/Executable doesn't exist|install/i.test(String(e.message))) {
      throw new Error(`No ${engine} build for this Playwright. Run: npx playwright install ${engine}`);
    }
    throw e;
  }
}

const AXE_CDN = {
  url: "https://cdn.jsdelivr.net/npm/axe-core@4.14.0/axe.min.js",
  sha384: "lFUXB8tI4BaTE1bqxH9eeAXON2NH1qsdAhs7S5L++nUNP5QOy+hwr0C3TYEJUEl0",
};

export async function loadAxe() {
  try {
    return fs.readFileSync(req.resolve("axe-core/axe.min.js"), "utf8");
  } catch {}
  try {
    const res = await fetch(AXE_CDN.url);
    const text = await res.text();
    const hash = crypto.createHash("sha384").update(text).digest("base64");
    if (hash === AXE_CDN.sha384) return text;
  } catch {}
  return null;
}

export async function runAxe(page, axeSource) {
  if (!axeSource) return { skipped: "axe-core not found: add axe-core as a dev dependency" };
  await page.evaluate(axeSource);
  return page.evaluate(async () => {
    const r = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      resultTypes: ["violations", "incomplete"],
    });
    return {
      violations: r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        count: v.nodes.length,
        targets: v.nodes.slice(0, 4).map((n) => String(n.target[0]).slice(0, 120)),
        contrast: v.id.includes("contrast")
          ? v.nodes.slice(0, 6).map((n) => {
              const d = n.any?.[0]?.data ?? {};
              return {
                ratio: d.contrastRatio,
                expected: d.expectedContrastRatio,
                fg: d.fgColor,
                bg: d.bgColor,
                target: String(n.target[0]).slice(0, 120),
              };
            })
          : undefined,
      })),
      needsReview: r.incomplete.reduce((n, v) => n + v.nodes.length, 0),
    };
  });
}
