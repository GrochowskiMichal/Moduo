// Screenshot + measurement harness for the Tasks visual audit.
// Usage: node shoot.mjs [group]   (group: tasks | prims | comp | all)
import { chromium } from "/Users/maciej/Documents/Coding/moduohyb/.claude/worktrees/tasks-module-research-ba3dc1/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

const SB = "http://localhost:6107";
const OUT = path.resolve(
  "/private/tmp/claude-501/-Users-maciej-Documents-Coding-moduohyb--claude-worktrees-tasks-module-research-ba3dc1/2b996305-fd5f-4d68-8dc0-ed3fb46ca01b/scratchpad/shots",
);
fs.mkdirSync(OUT, { recursive: true });
const group = process.argv[2] ?? "all";

const TASKS = [
  "tasks-tasklistview--single-bucket",
  "tasks-tasklistview--all-by-bucket",
  "tasks-tasklistview--all-flat",
  "tasks-tasklistview--completed-all",
  "tasks-tasklistview--with-energy",
  "tasks-tasklistview--read-only",
  "tasks-taskboardview--by-bucket",
  "tasks-taskboardview--by-status",
  "tasks-taskboardview--recent-completed",
  "tasks-taskdetailpanel--populated",
  "tasks-taskdetailpanel--core-properties-only",
  "tasks-taskdetailpanel--nothing-selected",
  "tasks-taskdetailpanel--read-only",
  "tasks-tasktimelineview--populated",
  "tasks-tasktimelineview--week-zoom",
  "tasks-tasktimelineview--quarter-zoom",
  "tasks-tasktimelineview--empty",
  "tasks-tasktimelineview--read-only",
  "calendar-taskblockchip--open",
  "calendar-taskblockchip--done",
  "calendar-taskblockchip--compact",
  "calendar-taskblockchip--view-only",
  "spine-entityhub--populated",
  "spine-entityhub--empty",
  "spine-entityhub--show-all",
  "spine-entityhub--read-only",
  "spine-entityhub--page-variant",
  "spine-entityhub--tombstone",
  "spine-entityhub--loading",
  "spine-entityhub--error-state",
  "spine-entityrefchip--task",
  "spine-entityrefchip--contact",
  "spine-entityrefchip--note",
  "spine-entityrefchip--removable",
  "spine-entityrefchip--linkable",
  "spine-entityrefchip--tombstoned",
  "spine-linksuggestionstrip--shared-tags",
  "spine-linksuggestionstrip--time-window",
  "spine-linksuggestionstrip--email-domain",
  "spine-linksuggestionstrip--busy",
  "spine-linksuggestionstrip--empty",
  "foundations-stateladder--default",
  "components-app-app-chrome--default",
  "components-app-app-chrome--single-workspace",
  "components-app-app-chrome--trial-banner-active",
  "components-app-app-chrome--icons-only",
  "components-app-feature-panels-shell--primary",
];

const PRIMS = [
  "components-ui-nav-row--rail",
  "components-ui-nav-row--states",
  "components-ui-nav-row--sections-and-levels",
  "components-ui-meta-count--default",
  "components-ui-meta-count--group",
  "components-ui-meta-count--on-a-row",
  "components-ui-filter-bar--default",
  "components-ui-filter-bar--menu-open",
  "components-ui-filter-bar--operators",
  "components-ui-display-menu--default",
  "components-ui-display-menu--with-footer",
  "components-ui-property-row--grid",
  "components-ui-property-row--with-trailing",
  "components-ui-property-row--multi-line-value",
  "components-ui-complete-toggle--default",
  "components-ui-complete-toggle--done",
  "components-ui-complete-toggle--disabled",
  "components-ui-checkbox--default",
  "components-ui-checkbox--unchecked",
  "components-ui-checkbox--disabled",
  "components-ui-button--variants",
  "components-ui-button--sizes",
  "components-ui-button--with-icon",
  "components-ui-button--loading",
  "components-ui-button--disabled",
  "components-ui-icon-button--variants",
  "components-ui-icon-button--sizes",
  "components-ui-avatar--with-image",
  "components-ui-avatar--fallback-only",
  "components-ui-avatar--group",
  "components-ui-avatar--with-status-badge",
  "components-ui-badge--variants",
  "components-ui-badge--tag-list",
  "components-ui-badge--with-icon",
  "components-ui-segmented-control--default",
  "components-ui-segmented-control--icon-only",
  "components-ui-segmented-control--small",
  "components-ui-segmented-control--disabled-segment",
  "components-ui-toolbar--default",
  "components-ui-toolbar--gap-steps",
  "components-ui-empty-state--default",
  "components-ui-empty-state--with-icon-and-action",
  "components-ui-popover--default",
  "components-ui-popover--compact",
  "components-ui-dropdown-menu--default",
  "components-ui-dropdown-menu--checkbox-and-radio",
  "components-ui-dropdown-menu--with-submenu",
  "components-ui-context-menu--default",
  "components-ui-dialog--default",
  "components-ui-dialog--destructive",
  "components-ui-dialog--scrollable-body",
  "components-ui-sheet--right-side",
  "components-ui-tooltip--icon-bar",
  "components-ui-tooltip--sides",
  "components-ui-kbd--default",
  "components-ui-kbd--combo",
  "components-ui-kbd--inline-hint",
  "components-ui-input--variants",
  "components-ui-input--sizes",
  "components-ui-input--invalid",
  "components-ui-input--with-label",
  "components-ui-textarea--default",
  "components-ui-textarea--invalid",
  "components-ui-date-field--date-only",
  "components-ui-date-field--with-time",
  "components-ui-date-field--property",
  "components-ui-date-field--outline",
  "components-ui-calendar--default",
  "components-ui-progress--determinate",
  "components-ui-progress--edge-cases",
  "components-ui-tabs--horizontal",
  "components-ui-tabs--line-variant",
  "components-ui-sonner--variants",
  "components-ui-command--inline",
  "components-ui-command--palette-dialog",
  "components-ui-eyebrow--tones",
  "components-ui-eyebrow--in-a-section",
  "components-ui-eyebrow--as-a-group-header",
  "components-ui-detail-title--rail",
  "components-ui-detail-title--page",
  "components-ui-detail-title--editable",
  "components-ui-drag-visuals--all-pieces",
  "components-ui-drag-visuals--insertion-line-edges",
];

function storyUrl(id, globals = "theme:dark") {
  return `${SB}/iframe.html?id=${id}&viewMode=story&globals=${globals}`;
}

async function openStory(page, id, globals) {
  await page.goto(storyUrl(id, globals), { waitUntil: "load" });
  const root = page.locator("#storybook-root, #root").first();
  await root.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(400);
}

// Dump computed style + geometry of the interesting nodes in the story root.
const MEASURE = `(() => {
  const root = document.querySelector('#storybook-root') || document.body;
  const sel = 'button, a, input, textarea, [role], h1, h2, h3, svg, [class*="text-"], [data-task-row], li, td, th';
  const nodes = Array.from(root.querySelectorAll(sel)).slice(0, 900);
  const seen = new Set();
  const out = [];
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    const txt = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 48);
    const key = el.tagName + '|' + Math.round(r.x) + '|' + Math.round(r.y) + '|' + Math.round(r.width) + '|' + Math.round(r.height) + '|' + txt;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || undefined,
      aria: el.getAttribute('aria-label') || undefined,
      txt,
      cls: (el.getAttribute('class') || '').slice(0, 220),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
      fs: cs.fontSize, fw: cs.fontWeight, ff: cs.fontFamily.split(',')[0], lh: cs.lineHeight,
      color: cs.color, bg: cs.backgroundColor, br: cs.borderRadius, pad: cs.padding, op: cs.opacity,
      bw: cs.borderWidth, bc: cs.borderColor, gap: cs.gap, tt: cs.textTransform, ls: cs.letterSpacing,
    });
  }
  return out;
})()`;

async function dump(page, name) {
  const data = await page.evaluate(MEASURE);
  fs.writeFileSync(path.join(OUT, `${name}.measure.json`), JSON.stringify(data, null, 1));
}

async function shot(page, name, opts = {}) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true, ...opts });
  console.log("shot", name);
}

const browser = await chromium.launch({ executablePath: "/Users/maciej/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

const ids = group === "tasks" ? TASKS : group === "prims" ? PRIMS : group === "comp" ? [] : [...TASKS, ...PRIMS];

for (const id of ids) {
  try {
    await openStory(page, id);
    await shot(page, id);
    if (/^tasks-|nav-row|filter-bar|display-menu|property-row|segmented|toolbar|button--|meta-count|complete-toggle|stateladder|app-chrome|entityhub|taskblockchip/.test(id)) {
      await dump(page, id);
    }
  } catch (e) {
    console.log("FAIL", id, e.message);
  }
}

// ---- interaction states on key Tasks stories ----
async function states(id, rowSelector, label) {
  try {
    await openStory(page, id);
    const rows = page.locator(rowSelector);
    const n = await rows.count();
    console.log(label, "rows found", n);
    if (n === 0) return;
    const first = rows.nth(Math.min(1, n - 1));
    await first.hover();
    await page.waitForTimeout(250);
    await shot(page, `${id}__hover`);
    await dump(page, `${id}__hover`);
    // keyboard focus
    await page.keyboard.press("Tab");
    await page.waitForTimeout(150);
    await page.keyboard.press("Tab");
    await page.waitForTimeout(250);
    await shot(page, `${id}__focus-tab2`);
    // click to select
    await first.click({ position: { x: 200, y: 10 } });
    await page.waitForTimeout(300);
    await shot(page, `${id}__selected`);
    await dump(page, `${id}__selected`);
    // move mouse away so selected without hover is visible
    await page.mouse.move(5, 5);
    await page.waitForTimeout(250);
    await shot(page, `${id}__selected-nohover`);
  } catch (e) {
    console.log("FAIL states", id, e.message);
  }
}

if (group === "tasks" || group === "all") {
  await states("tasks-tasklistview--all-by-bucket", '[role="row"], [data-task-row], li[data-id], [data-testid*="row"], div[role="option"], button[aria-label*="task" i]', "list");
  await states("tasks-taskboardview--by-status", '[role="article"], [data-task-card], [data-card], div[draggable="true"], [role="button"]', "board");
  // right-click context menu on a list row
  try {
    await openStory(page, "tasks-tasklistview--all-by-bucket");
    const anyRow = page.locator('[role="row"], [data-task-row], li').nth(1);
    await anyRow.click({ button: "right", position: { x: 200, y: 10 } });
    await page.waitForTimeout(400);
    await shot(page, "tasks-tasklistview--all-by-bucket__contextmenu");
  } catch (e) { console.log("FAIL ctx", e.message); }
  // density variants on list + board + detail
  for (const d of ["compact", "dense"]) {
    for (const id of ["tasks-tasklistview--all-by-bucket", "tasks-taskboardview--by-status", "tasks-taskdetailpanel--populated"]) {
      try {
        await openStory(page, id, `theme:dark;density:${d}`);
        await shot(page, `${id}__density-${d}`);
        await dump(page, `${id}__density-${d}`);
      } catch (e) { console.log("FAIL density", id, d, e.message); }
    }
  }
  // accent + shade spot checks
  for (const g of ["accent:blue", "accent:amber", "shade:slate", "radius:sharp", "radius:round"]) {
    for (const id of ["tasks-tasklistview--all-by-bucket", "tasks-taskdetailpanel--populated"]) {
      try {
        await openStory(page, id, `theme:dark;${g}`);
        await shot(page, `${id}__${g.replace(":", "-")}`);
      } catch (e) { console.log("FAIL global", id, g, e.message); }
    }
  }
  // light theme spot checks
  for (const id of ["tasks-tasklistview--all-by-bucket", "tasks-taskboardview--by-status", "tasks-taskdetailpanel--populated", "foundations-stateladder--default"]) {
    try {
      await openStory(page, id, "theme:light");
      await shot(page, `${id}__light`);
    } catch (e) { console.log("FAIL light", id, e.message); }
  }
  // Hover states on NavRow story + board card + detail panel property rows
  try {
    await openStory(page, "components-ui-nav-row--rail");
    const rows = page.locator('[role="treeitem"], a, button, li, [role="link"], [role="button"]');
    console.log("navrow nodes", await rows.count());
    await rows.nth(2).hover();
    await page.waitForTimeout(300);
    await shot(page, "components-ui-nav-row--rail__hover");
    await dump(page, "components-ui-nav-row--rail__hover");
  } catch (e) { console.log("FAIL navrow hover", e.message); }
  try {
    await openStory(page, "tasks-taskdetailpanel--populated");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(250);
    await shot(page, "tasks-taskdetailpanel--populated__focus-tab3");
  } catch (e) { console.log("FAIL detail focus", e.message); }
  // open the filter + display menus in their stories
  for (const [id, trig] of [
    ["components-ui-display-menu--default", "button"],
    ["components-ui-filter-bar--default", "button"],
    ["components-ui-date-field--with-time", "button"],
    ["components-ui-dropdown-menu--default", "button"],
    ["components-ui-popover--default", "button"],
    ["components-ui-dialog--default", "button"],
    ["components-ui-sheet--right-side", "button"],
    ["components-ui-command--palette-dialog", "button"],
    ["components-ui-tooltip--icon-button", "button"],
  ]) {
    try {
      await openStory(page, id);
      const b = page.locator(trig).first();
      if (id.includes("tooltip")) { await b.hover(); } else { await b.click(); }
      await page.waitForTimeout(500);
      await shot(page, `${id}__open`, { fullPage: false });
      await dump(page, `${id}__open`);
    } catch (e) { console.log("FAIL open", id, e.message); }
  }
  // context menu story
  try {
    await openStory(page, "components-ui-context-menu--default");
    const target = page.locator("#storybook-root > *").first();
    await target.click({ button: "right" });
    await page.waitForTimeout(400);
    await shot(page, "components-ui-context-menu--default__open", { fullPage: false });
  } catch (e) { console.log("FAIL ctxmenu", e.message); }
  // sonner: click the buttons to spawn toasts
  try {
    await openStory(page, "components-ui-sonner--variants");
    const btns = page.locator("#storybook-root button");
    const n = await btns.count();
    for (let i = 0; i < Math.min(n, 4); i++) { await btns.nth(i).click(); await page.waitForTimeout(150); }
    await page.waitForTimeout(500);
    await shot(page, "components-ui-sonner--variants__toasts", { fullPage: false });
  } catch (e) { console.log("FAIL sonner", e.message); }
}

if (group === "comp" || group === "all") {
  const comp = "file:///Users/maciej/Documents/Coding/moduohyb/.claude/worktrees/tasks-module-research-ba3dc1/.design/tasks-dogfood/ui-proposal.html";
  await page.goto(comp);
  await page.waitForTimeout(800);
  await shot(page, "comp__full");
  const sections = page.locator("section, [id]");
  const n = await sections.count();
  console.log("comp sections", n);
  const ids2 = await page.evaluate(() => Array.from(document.querySelectorAll("section[id], h2[id], [id]")).map((e) => e.id).filter(Boolean));
  console.log("comp ids", ids2.join(","));
  const secs = page.locator("section");
  const sn = await secs.count();
  for (let i = 0; i < sn; i++) {
    try {
      const s = secs.nth(i);
      await s.scrollIntoViewIfNeeded();
      const id = (await s.getAttribute("id")) || `s${i}`;
      await s.screenshot({ path: path.join(OUT, `comp__section-${i}-${id}.png`) });
      console.log("comp section", i, id);
    } catch (e) { console.log("FAIL comp sec", i, e.message); }
  }
}

await browser.close();
console.log("DONE");
