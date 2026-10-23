// Planted defects. A run with --ablate degrades the app on purpose, through CSS and JS
// injected before load, so the critic's recall and the lab's gates can be checked against
// a known-worse build of the same product. ablation.json records what was done; the critic
// never sees it.

export const LEVELS = {
  level1: ["no-focus", "jitter-spacing"],
  level2: ["no-focus", "jitter-spacing", "off-tokens", "no-motion", "slow"],
  level3: ["no-focus", "jitter-spacing", "off-tokens", "no-motion", "slow", "low-contrast", "jank", "layout-shift", "flat-elevation", "system-font"],
};

export const DESCRIPTIONS = {
  "no-focus": "Focus indicators removed (outline and focus rings).",
  "no-motion": "All transitions and animations removed (state changes snap).",
  "jitter-spacing": "Padding and margins of about a third of elements nudged by 2-6 px.",
  "off-tokens": "Colours, font sizes and radii of about a fifth of elements nudged just off their tokens.",
  "system-font": "Interface font replaced with Arial.",
  "flat-elevation": "Shadows removed, so overlays and cards lose their elevation.",
  "low-contrast": "Text faded toward transparent, below AA contrast.",
  "blank-empty": "Main content of empty states hidden (only headings remain).",
  "layout-shift": "A 40 px block is inserted at the top of the page shortly after each click.",
  "slow": "Every network request delayed by 700 ms.",
  "jank": "Every pointer down and key down blocks the main thread for 120 ms.",
};

export function expand(spec) {
  if (!spec) return [];
  const out = new Set();
  for (const part of String(spec).split(",").map((s) => s.trim()).filter(Boolean)) {
    for (const a of LEVELS[part] ?? [part]) {
      if (!DESCRIPTIONS[a]) throw new Error(`Unknown ablation "${a}". Known: ${Object.keys(DESCRIPTIONS).join(", ")}, level1-3`);
      out.add(a);
    }
  }
  return [...out];
}

const CSS = {
  "no-focus": "*:focus,*:focus-visible,*:focus-within{outline:none!important;box-shadow:none!important}",
  "no-motion": "*,*::before,*::after{transition:none!important;animation:none!important}",
  "system-font": "*{font-family:Arial,Helvetica,sans-serif!important}",
  "flat-elevation": "*{box-shadow:none!important}",
  // Fades text toward transparent, so it fails contrast on dark and light themes alike.
  "low-contrast": "body *{color:color-mix(in srgb,currentColor 45%,transparent)!important}",
};

/** One init script that applies every chosen ablation, seeded so runs repeat. */
export function initScript(ablations) {
  const css = ablations.map((a) => CSS[a]).filter(Boolean).join("\n");
  const js = [];
  if (ablations.includes("jitter-spacing") || ablations.includes("off-tokens") || ablations.includes("blank-empty")) {
    js.push(`
      let seed = 1337;
      const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const done = new WeakSet();
      const tweak = () => {
        for (const el of document.querySelectorAll("body *")) {
          if (done.has(el)) continue;
          done.add(el);
          ${ablations.includes("jitter-spacing") ? `if (rand() < 0.33) { el.style.setProperty("padding-top", (2 + Math.floor(rand() * 5)) + "px", "important"); el.style.setProperty("margin-left", (2 + Math.floor(rand() * 5)) + "px", "important"); }` : ""}
          ${ablations.includes("off-tokens") ? `if (rand() < 0.2) { const cs = getComputedStyle(el); const fs = parseFloat(cs.fontSize); el.style.setProperty("font-size", (fs + 0.5) + "px", "important"); el.style.setProperty("color", "color-mix(in oklch, " + cs.color + " 88%, rgb(255 120 60))", "important"); const r = parseFloat(cs.borderTopLeftRadius); if (r > 0 && r < 100) el.style.setProperty("border-radius", (r + 2) + "px", "important"); }` : ""}
        }
        ${ablations.includes("blank-empty") ? `for (const m of document.querySelectorAll("main p, main [role=status], main img, main svg")) m.style.setProperty("visibility", "hidden", "important");` : ""}
      };
      new MutationObserver(() => tweak()).observe(document, { childList: true, subtree: true });
      addEventListener("DOMContentLoaded", tweak);`);
  }
  if (ablations.includes("jank")) {
    js.push(`
      const block = () => { const t = performance.now(); while (performance.now() - t < 120) {} };
      addEventListener("pointerdown", block, true);
      addEventListener("keydown", block, true);`);
  }
  if (ablations.includes("layout-shift")) {
    js.push(`
      addEventListener("click", () => setTimeout(() => {
        const d = document.createElement("div");
        d.style.cssText = "height:40px;width:100%";
        document.body.prepend(d);
        setTimeout(() => d.remove(), 700);
      }, 150), true);`);
  }
  return `(() => {
    if (window.__labAblated) return; window.__labAblated = true;
    const css = ${JSON.stringify(css)};
    const add = () => { if (!css) return; const s = document.createElement("style"); s.setAttribute("data-lab-ablation", ""); s.textContent = css; (document.head || document.documentElement).appendChild(s); };
    if (document.readyState === "loading") addEventListener("DOMContentLoaded", add); else add();
    ${js.join("\n")}
  })();`;
}

export async function applyRoutes(context, ablations) {
  if (!ablations.includes("slow")) return;
  await context.route("**/*", async (route) => {
    const type = route.request().resourceType();
    if (type === "fetch" || type === "xhr") await new Promise((r) => setTimeout(r, 700));
    await route.fallback();
  });
}
