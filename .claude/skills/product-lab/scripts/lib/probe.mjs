// In-page instruments. PROBE is installed before the app's own code (addInitScript) and
// collects Event Timing, layout shifts, long animation frames, errors and rAF frames. The
// other exports are functions Playwright serialises into the page, so each one is
// self-contained: no closures over this module.

export const PROBE = `(() => {
  if (window.__lab) return;
  const L = (window.__lab = { events: [], shifts: [], loafs: [], errors: [], frames: [], sampling: false });
  // WebKit accepts observe() for entry types it doesn't support and stays silent, so ask first.
  const types = (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes) || [];
  const desc = (el) => {
    if (!el || !el.tagName) return null;
    const role = el.getAttribute && el.getAttribute("role");
    const name = (el.getAttribute && el.getAttribute("aria-label")) || (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 40);
    return el.tagName.toLowerCase() + (role ? "[role=" + role + "]" : "") + (name ? ' "' + name + '"' : "");
  };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        L.events.push({ name: e.name, start: e.startTime, duration: e.duration,
          inputDelay: e.processingStart - e.startTime, processing: e.processingEnd - e.processingStart,
          presentation: e.startTime + e.duration - e.processingEnd, id: e.interactionId || 0, target: desc(e.target) });
    }).observe({ type: "event", durationThreshold: 16, buffered: true });
    L.eventTiming = types.includes("event");
  } catch { L.eventTiming = false; }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) L.shifts.push({ value: e.value, recent: e.hadRecentInput, start: e.startTime });
    }).observe({ type: "layout-shift", buffered: true });
    L.layoutShift = types.includes("layout-shift");
  } catch { L.layoutShift = false; }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) L.loafs.push({ start: e.startTime, duration: e.duration, blocking: e.blockingDuration });
    }).observe({ type: "long-animation-frame", buffered: true });
    L.loaf = types.includes("long-animation-frame");
  } catch { L.loaf = false; }
  addEventListener("error", (e) => L.errors.push(String(e.message || e)));
  addEventListener("unhandledrejection", (e) => L.errors.push("unhandled rejection: " + String((e.reason && e.reason.message) || e.reason)));
  L.startFrames = () => {
    L.frames = []; L.sampling = true;
    const tick = (t) => { if (!L.sampling) return; L.frames.push(t); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  L.stopFrames = () => { L.sampling = false; return L.frames.slice(); };
  // In-page timer for "input to first shown frame": started just before the input, it stamps
  // the first animation frame in which the overlay has a box, with no harness round trips.
  L.watch = (sel) => {
    L.watchStart = performance.now(); L.shownAt = null;
    const tick = () => {
      if (L.shownAt) return;
      const el = [...document.querySelectorAll(sel)].pop();
      const r = el && el.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) { L.shownAt = performance.now(); return; }
      if (performance.now() - L.watchStart < 5000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  L.now = () => performance.now();
})();`;

/** Running and recent animations, optionally inside one subtree. */
export function inventory(selector) {
  const LAYOUT = /^(width|height|top|left|right|bottom|inset|margin|padding|max-|min-|flex-basis|grid-template)/;
  const root = selector ? document.querySelector(selector) : document;
  if (!root) return [];
  const anims = selector ? root.getAnimations({ subtree: true }) : document.getAnimations();
  return anims.slice(0, 40).map((a) => {
    const t = a.effect?.getTiming?.() ?? {};
    const kf = a.effect?.getKeyframes?.() ?? [];
    const props = new Set();
    let kfEasing = null;
    for (const k of kf)
      for (const key of Object.keys(k)) {
        if (["offset", "computedOffset", "composite"].includes(key)) continue;
        if (key === "easing") {
          if (k.easing !== "linear") kfEasing = k.easing;
          continue;
        }
        props.add(key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));
      }
    if (a.transitionProperty) props.add(a.transitionProperty);
    const el = a.effect?.target;
    const p = [...props];
    return {
      kind: a.constructor?.name ?? "Animation",
      props: p,
      layout: p.some((x) => LAYOUT.test(x)),
      moves: p.some((x) => /transform|translate|scale|rotate/.test(x)),
      duration: typeof t.duration === "number" ? t.duration : null,
      delay: t.delay ?? 0,
      iterations: t.iterations ?? 1,
      easing: kfEasing || t.easing || null,
      state: a.playState,
      target: el ? el.tagName.toLowerCase() + (el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : "") : null,
    };
  });
}

/** Wait until finite animations finish (cap ms), so frames are the app at rest. */
export async function settle(cap) {
  const t0 = performance.now();
  await document.fonts?.ready;
  while (performance.now() - t0 < cap) {
    const busy = document
      .getAnimations()
      .some((a) => a.playState === "running" && a.effect?.getTiming?.().iterations !== Infinity);
    if (!busy) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

/** What the screen shows: text amount, element count, overflow, focus. */
export function pageInfo() {
  const se = document.scrollingElement || document.documentElement;
  const vw = window.innerWidth;
  const offenders = [];
  if (se.scrollWidth > se.clientWidth + 1) {
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > vw + 1 && getComputedStyle(el).position !== "fixed") {
        offenders.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} right=${Math.round(r.right)}`);
        if (offenders.length >= 5) break;
      }
    }
  }
  const text = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
  let visible = 0;
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight) visible++;
    if (visible > 2000) break;
  }
  return {
    textLength: text.length,
    textHash: [...text.slice(0, 4000)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7),
    visibleElements: visible,
    overflowX: se.scrollWidth > se.clientWidth + 1,
    scrollWidth: se.scrollWidth,
    offenders,
    url: location.pathname + location.search,
    errors: window.__lab?.errors?.slice(0, 10) ?? [],
  };
}

/** The focused element: where it is, and whether its focus indicator is visible. */
export function focusInfo() {
  const el = document.activeElement;
  if (!el || el === document.body) return { none: true };
  const keys = ["outline-style", "outline-width", "outline-color", "box-shadow", "border-color", "background-color", "color", "text-decoration-line"];
  // A field's ring often sits on its wrapper (:focus-within), so read two ancestors too.
  const chain = [el, el.parentElement, el.parentElement?.parentElement].filter(Boolean);
  const read = () => {
    const out = {};
    chain.forEach((node, i) => {
      const cs = getComputedStyle(node);
      for (const k of keys) out[i ? `${i}:${k}` : k] = cs.getPropertyValue(k);
    });
    return out;
  };
  const on = read();
  el.blur();
  const off = read();
  el.focus();
  const changed = Object.keys(on).filter((k) => on[k] !== off[k]);
  const outline = on["outline-style"] !== "none" && Number.parseFloat(on["outline-width"]) > 0;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const name = el.getAttribute("aria-label") || (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50);
  return {
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute("role"),
    name,
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    inViewport: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
    hidden: cs.visibility === "hidden" || Number(cs.opacity) === 0 || r.width === 0,
    indicator: outline || changed.length > 0,
    changed,
  };
}

/** Pointer targets worth a rest/hover pair: visible, enabled, one per look-alike. */
export function hoverTargets({ selector, max }) {
  const seen = new Set();
  const out = [];
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) continue;
    if (el.closest("[aria-hidden='true'],[inert]") || el.disabled || el.getAttribute("aria-disabled") === "true") continue;
    const sig = `${el.tagName}|${el.getAttribute("role")}|${[...el.classList].sort().slice(0, 6).join(".")}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const name = el.getAttribute("aria-label") || (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    out.push({ x: r.x, y: r.y, width: r.width, height: r.height, tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), name });
    if (out.length >= max) break;
  }
  return out;
}

/** Computed styles that a hover usually changes, at one point on the screen. */
export function stylesAt({ x, y }) {
  let el = document.elementFromPoint(x, y);
  const keys = ["color", "background-color", "border-color", "box-shadow", "transform", "opacity", "text-decoration-line", "outline-color", "filter", "scale", "translate"];
  const out = {};
  for (let i = 0; el && i < 3; i++, el = el.parentElement) {
    const cs = getComputedStyle(el);
    for (const k of keys) out[`${i}:${k}`] = cs.getPropertyValue(k);
  }
  return out;
}

/** An overlay's box, and whether it is shown. */
export function overlayBox(selector) {
  const els = [...document.querySelectorAll(selector)].filter((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden";
  });
  const el = els[els.length - 1];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, opacity: Number(getComputedStyle(el).opacity) };
}

/** Pause the overlay's animations at a fraction of their length (deterministic strips). */
export function seekOverlay({ selector, fraction }) {
  const el = [...document.querySelectorAll(selector)].pop();
  if (!el) return 0;
  const anims = [document.documentElement, el].flatMap((n) => n.getAnimations({ subtree: n === el }));
  let longest = 0;
  for (const a of anims) {
    const t = a.effect?.getTiming?.() ?? {};
    const total = (t.delay ?? 0) + (typeof t.duration === "number" ? t.duration : 0);
    if (t.iterations === Infinity) continue;
    longest = Math.max(longest, total);
    a.pause();
    a.currentTime = total * fraction;
  }
  return longest;
}

export function finishAll() {
  for (const a of document.getAnimations()) {
    try {
      if (a.effect?.getTiming?.().iterations !== Infinity) a.finish();
      else a.play();
    } catch {}
  }
}
