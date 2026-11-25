// The signature: one driver maps the home scene's scroll progress p (0 → 1) to everything that
// carries the concept, so the strokes, their names, the windows, the captions and the text
// always agree. Everything grows out of the mark. With First light (motion/first-light.ts) the
// scene's first HERO_LEAD of scroll is the hero's: the whole first screen holds (its room is a
// sticky layer; the words and Home are held here) while its glass stroke opens into the mark and
// turns Paper, then this canvas takes the mark on the same pixels, the words fade where they stand
// and p runs over the rest. Without it the mark starts in the header:
//
//   p 0.00–0.05  the hero fades; the mark grows until it fills the stage (from the hero's mark,
//                or dropping out of the header first, which lends it: html.mark-lent)
//   p 0.05–0.20  the mark deals out six strokes, apart: each new stroke slides out from under
//                the stroke of its own layer, crossing the windows on its way ("six apps")
//   p 0.30–0.68  the five pairs close left to right; each overlap cancels into a window, and the
//                link it holds arrives under the chain as a card of the app: the thing in the
//                next module, carrying the chip of the thing it came from (the card before it)
//   p 0.71–0.84  the plate: six names, five windows, and the five cards as one client's story
//   p 0.84–0.97  it keeps growing: the chain deals itself out to both edges of the screen
//
// The strokes are drawn on a canvas with the mark's own rule: even strokes are layer A, odd
// strokes layer B, and B is composited onto A with `xor`, so every overlap is a window. A window
// that opens sends out one ring, drawn the same way, so it inverts whatever it crosses.
//
// At rest (the plate and the ribbon) the chain breathes: a slow wave runs along it, the plate
// lights its links in turn, and the window nearest the pointer opens a little (idle input on
// the GSAP ticker, paused off screen, absent under reduced motion). A card or a window under
// the pointer (or a focused card) opens its window wider and lights its two modules.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { interlock } from "../data/site";
import { ease, isMobile, isTouch, jumpTo, onPage, prefersReducedMotion } from "../engine";
import { HERO_LEAD, NAME_ROOM } from "../lib/scene";
import { CAP_X, STROKE, STROKE_H, STROKE_PATH, windowCenter } from "../lib/stroke";

gsap.registerPlugin(ScrollTrigger);

const N = 6;
const OFF = STROKE.offset;
const W = STROKE.w;
const APART = 1.95;
/** Strokes the ribbon deals out on each side of the chain. */
const RIBBON = 14;
/** The mark: strokes 0–2 at the mark's offset. */
const MARK = [0, 1, 2].map((i) => i * OFF);
const MARK_W = 2 * OFF + W;
/** When each stroke starts to deal out (fraction of the fan), and how long it travels. */
const FAN_AT = [0, 0.04, 0.08, 0.14, 0.2, 0.26];
const FAN_LEN = 0.45;

const P = {
  heroOut: [0.002, 0.025] as const,
  drop: [0, 0.012] as const,
  zoom: [0.004, 0.05] as const,
  fan: [0.08, 0.21] as const,
  close0: 0.3,
  closeEach: 0.08,
  closeLen: 0.06,
  done: 0.71,
  ribbon: [0.84, 0.97] as const,
};
const PLATE_END = P.ribbon[0];
/** Seconds each link stays lit while the plate rests. */
const CYCLE = 3.2;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, p: number) => {
  const t = clamp01((p - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = gsap.parseEase(ease.inOut);
// The deal starts quickly, so a stroke never lingers half out of register with its twin.
const easeDeal = gsap.parseEase("power3.out");

type Rect = { x: number; y: number; w: number; h: number };
const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  w: lerp(a.w, b.w, t),
  h: lerp(a.h, b.h, t),
});

function closeT(k: number, p: number) {
  const a = P.close0 + k * P.closeEach;
  return smooth(a, a + P.closeLen, p);
}

/** Scroll state → gaps between the six strokes (1 = interlocked like the mark). */
function gapsAt(p: number): number[] {
  return Array.from({ length: N - 1 }, (_, k) => 1 + (APART - 1) * (1 - closeT(k, p)));
}

/** How far stroke i has dealt out of the mark (0 → 1). */
function fanT(i: number, p: number) {
  const u = clamp01((p - P.fan[0]) / (P.fan[1] - P.fan[0]));
  return easeDeal(clamp01((u - FAN_AT[i]) / FAN_LEN));
}

/** How far the j-th ribbon stroke on each side has dealt out (0 → 1). */
function ribbonT(j: number, p: number) {
  const u = clamp01((p - P.ribbon[0]) / (P.ribbon[1] - P.ribbon[0]));
  return easeInOut(clamp01((u - (j - 1) * 0.045) / 0.42));
}

/** 1 where the chain rests (the plate and the end of the ribbon), 0 while it moves. */
const restAt = (p: number) =>
  smooth(P.done, P.done + 0.03, p) * (1 - smooth(PLATE_END, PLATE_END + 0.02, p)) +
  smooth(0.95, 0.99, p);

/** 1 while the plate is up (the cards). */
const plateAt = (p: number) => 1 - smooth(PLATE_END, PLATE_END + 0.03, p);

/** The chain as the scene last drew it, for the section that takes it over (motion/modules.ts):
 *  each stroke's left edge in mark units, the ribbon's first stroke on each side, and the camera
 *  (view origin, pixels per unit) on the canvas, and the scene's progress when it drew them. */
export const lastChain = { xs: [] as number[], vx: 0, vy: 0, k: 0, edges: [] as number[], p: 0 };

export function startInterlock() {
  onPage(({ firstLoad }) => {
    const root = document.documentElement;
    const scene = document.querySelector<HTMLElement>("[data-scene]");
    // The first visit's class goes once the intro has played.
    const introDone = gsap.delayedCall(1.5, () => root.classList.remove("intro"));
    if (!firstLoad) root.classList.remove("intro");
    if (!scene || prefersReducedMotion()) return () => introDone.kill();

    const stage = scene.querySelector<HTMLElement>("[data-stage]")!;
    const canvas = stage.querySelector<HTMLCanvasElement>("[data-canvas]")!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return () => introDone.kill();
    const layerB = document.createElement("canvas");
    const ctxB = layerB.getContext("2d")!;
    const sceneSlot = scene.querySelector<HTMLElement>('[data-slot="scene"]')!;
    const names = [...stage.querySelectorAll<HTMLElement>("[data-name]")];
    const beats = [...stage.querySelectorAll<HTMLElement>("[data-beat]")];
    const caps = [...stage.querySelectorAll<HTMLElement>("[data-cap]")];
    const chips = caps.map((el) => el.querySelector<HTMLElement>("[data-chip]"));
    const readout = stage.querySelector<HTMLElement>("[data-readout]")!;
    const heroEl = scene.querySelector<HTMLElement>("[data-hero]")!;
    // The hero's monument: when the hero stands one, the scene grows from it, not the header.
    const monument = heroEl.querySelector<HTMLElement>("[data-light-mark]");
    // The first screen holds while the stroke opens: the words and Home stay where they stand.
    const held = monument ? heroEl : null;
    // With the monument the hero fades in raw progress, over the end of its lead and a little
    // past it: the mark is already growing out of the window's bar while the words go.
    const heroOutAt: readonly [number, number] = monument
      ? [HERO_LEAD - 0.006, HERO_LEAD + 0.022]
      : P.heroOut;
    // Scene progress from raw progress, and back: the monument's lead is the hero's own.
    const toScene = (raw: number) =>
      monument ? clamp01((raw - HERO_LEAD) / (1 - HERO_LEAD)) : raw;
    const toRaw = (q: number) => (monument ? HERO_LEAD + q * (1 - HERO_LEAD) : q);
    // The header's mark: the scene starts on it. At the very top the header draws it; once the
    // page moves the canvas takes it over on the same pixels and the header hides its own
    // (html.mark-lent, components/Header.astro) until the mark has grown away.
    const lockup = document.querySelector<HTMLElement>(".hdr__brand .lockup--typed");
    const brandMark = lockup?.querySelector<SVGSVGElement>("svg.lockup__mark") ?? null;
    // Wide screens hang every caption from its window; narrow ones show one at a time.
    const wide = matchMedia("(min-width: 1000px)");
    const strokePath = new Path2D(STROKE_PATH);
    const css = getComputedStyle(root);
    const PAPER = css.getPropertyValue("--c-stroke").trim() || "#fafafa";

    // Layout cache, refreshed with ScrollTrigger.
    let stageW = 1;
    let stageH = 1;
    let dpr = 1;
    let margin = 16;
    let navRect: Rect = { x: 0, y: 0, w: 1, h: 1 };
    // How far the mark drops to clear the header (its top to the bar's foot), in px.
    let dropBy = 44;
    let sceneRect: Rect = { x: 0, y: 0, w: 1, h: 1 };
    // Phones: where the ribbon rests, under the words like the chain.
    let narrowRibbon: Rect = { x: 0, y: 0, w: 1, h: 1 };
    // Each name's width, for the row a phone sets them in.
    let nameW = names.map(() => 0);
    const measure = () => {
      const s = stage.getBoundingClientRect();
      stageW = s.width;
      stageH = s.height;
      nameW = names.map((el) => el.offsetWidth);
      dpr = Math.min(devicePixelRatio || 1, 2);
      const cw = Math.round(stageW * dpr);
      const ch = Math.round(stageH * dpr);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = layerB.width = cw;
        canvas.height = layerB.height = ch;
      }
      const r = sceneSlot.getBoundingClientRect();
      sceneRect = { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
      margin = r.left - s.left;
      // The header's mark in stage pixels. The stage holds the top of the viewport for the whole
      // scene and the header is fixed there, so its place is measured against the header (which
      // may be stepping aside) and the mark is found in its viewBox, which crops the artwork.
      if (monument) {
        // Measured against the hero's top, which is the stage's at p = 0.
        const m = monument.getBoundingClientRect();
        const h = heroEl.getBoundingClientRect();
        navRect = { x: m.left - s.left, y: m.top - h.top, w: m.width, h: m.height };
        dropBy = 0;
      } else if (lockup && brandMark) {
        const l = lockup.getBoundingClientRect();
        const h = lockup.closest(".hdr")?.getBoundingClientRect() ?? s;
        const vb = brandMark.viewBox.baseVal;
        const k0 = l.height / vb.height;
        navRect = {
          x: l.left - s.left + (STROKE.x0 - OFF - vb.x) * k0,
          y: l.top - h.top + (STROKE.top - vb.y) * k0,
          w: MARK_W * k0,
          h: STROKE_H * k0,
        };
        dropBy = Math.max(0, h.height - navRect.y);
      } else navRect = { x: margin, y: 20, w: MARK_W * 0.044, h: STROKE_H * 0.044 };
      if (!wide.matches) layoutNarrow(s);
    };

    // Phones compose the stage from what is on it, not from fixed fractions: the words of the
    // tallest beat on top, then the chain, then the one card in view, with the count at the foot.
    // So a long line, a large text setting or a short screen never pushes the chain into the
    // words (beats are absolutely placed, so their height is known before they show).
    let CAPS_H = 110;
    const layoutNarrow = (s: DOMRect) => {
      let textBottom = 0;
      for (const b of beats)
        textBottom = Math.max(textBottom, b.getBoundingClientRect().bottom - s.top);
      // Room for the names, which stand on two lines over the chain.
      const top0 = textBottom + 28;
      CAPS_H = Math.max(96, caps[0]?.getBoundingClientRect().height ?? 96) + 16;
      const floor = stageH - 40;
      const avail = Math.max(0, floor - top0);
      const chainH = Math.max(88, Math.min(stageH * 0.24, avail - CAPS_H - 30));
      const slack = Math.max(0, avail - chainH - 30 - CAPS_H);
      const w = stageW - 2 * margin;
      sceneRect = { x: margin, y: top0 + slack * 0.42, w, h: chainH };
      // The ribbon's beat ends on a button, so its names keep a little more air above them; the
      // ribbon stands in the middle of the room left under it, so the stage doesn't leave with an
      // empty lower half.
      const ribbonH = Math.max(chainH, Math.min(stageH * 0.3, avail - 16));
      narrowRibbon = {
        x: margin,
        y: top0 + 16 + Math.max(0, avail - 16 - ribbonH) * 0.5,
        w,
        h: ribbonH,
      };
    };

    // Live state.
    // p: the scene's progress; raw: the scroll's (they differ by the hero's lead).
    const state = { p: 0, raw: 0 };
    // The scene's scroll length, in px (the held hero counters raw of it).
    let span = 1;
    let lent = false;
    let heroOn = false;
    const idle = { t: 0, amp: 0, px: -1, py: -1, pull: [0, 0, 0, 0, 0] };
    // The link under the pointer or focus (-1: none), and the one the plate lights in turn.
    let hot = -1;
    let pointed = -1;
    let cycleFrom = -1;
    let active = -1;
    let lastReadout = "";
    // When each window last opened (ticker seconds), for the ring it sends out.
    const opened = [-9, -9, -9, -9, -9];
    const wasOpen = [false, false, false, false, false];
    const RIPPLE = 0.9;
    // The last camera (view origin in mark units, pixels per unit), for the pointer.
    const cam = { vx: 0, vy: 0, k: 1 };

    const arrive = (el: HTMLElement, a: number) => {
      const next = a.toFixed(3);
      if (el.style.getPropertyValue("--a") !== next) el.style.setProperty("--a", next);
    };

    const apply = () => {
      const p = state.p;
      const rest = restAt(p);
      const plate = plateAt(p);
      const isWide = wide.matches;

      // ── Strokes: the mark deals out, the pairs close, the idle wave and the pointer. ──
      const gaps = gapsAt(p).map((g, k) => {
        const wave = idle.amp * rest * 0.02 * Math.sin(idle.t * 0.6 - k * 0.85);
        return g + wave - idle.pull[k] * rest * (isMobile() ? 0.5 : 1);
      });
      const base = [0];
      for (const g of gaps) base.push(base[base.length - 1] + g * OFF);
      // The mark parts into three apart strokes, and the row carries on to the right: strokes
      // 4–6 slide the last part of their gap into place as they fade up, one after another.
      const xs: number[] = [];
      const fanA: number[] = [];
      base.forEach((b, i) => {
        const d = fanT(i, p);
        if (i < 3) xs.push(MARK[i] + (b - MARK[i]) * d);
        else xs.push(xs[i - 1] + lerp(0.7, 1, d) * (b - base[i - 1]));
        fanA.push(i < 3 ? 1 : d);
      });

      // The ribbon: the chain unfurls outward from both ends, each stroke sliding the last part
      // of an offset into place as it fades up, one after another toward the edges.
      const right: number[] = [];
      const left: number[] = [];
      const shownR: number[] = [];
      const ribbonOn = p > P.ribbon[0];
      if (ribbonOn) {
        let r = xs[5];
        let l = xs[0];
        for (let j = 1; j <= RIBBON; j++) {
          const d = ribbonT(j, p);
          const g = 1 + idle.amp * rest * 0.02 * Math.sin(idle.t * 0.6 + j * 0.85);
          r += OFF * g;
          l -= OFF * g;
          right.push(r - (1 - d) * 0.6 * OFF);
          left.push(l + (1 - d) * 0.6 * OFF);
          shownR.push(d);
        }
      }

      // ── Camera: from the header's mark to a close-up of it, then to the stage slot. ──
      // The mark first drops straight down out of the bar, so it never grows over the word
      // beside it, then grows some thirty times over: at an even rate (each bit of scroll scales
      // it by the same factor) and about the point the two frames share, so it opens out from
      // under the header instead of flying across the page.
      const nav: Rect = {
        ...navRect,
        y: navRect.y + dropBy * easeDeal(clamp01((p - P.drop[0]) / (P.drop[1] - P.drop[0]))),
      };
      const close: Rect = { x: margin, y: stageH * 0.15, w: stageW - 2 * margin, h: stageH * 0.68 };
      const grow = Math.min(close.w / nav.w, close.h / nav.h);
      const zt = smooth(P.zoom[0], P.zoom[1], p);
      const zu = grow > 1.01 ? (Math.pow(grow, zt) - 1) / (grow - 1) : zt;
      // The plate is the climax: on wide screens the chain comes a little closer.
      // On phones the chain steps in from the margins, so it stands with air around it.
      // The plate gives the cards their room: the chain a step smaller and higher, the row
      // under it, nothing else on the stage but the line and its words.
      const plateRect: Rect = isWide
        ? { x: margin, y: stageH * 0.285, w: stageW - 2 * margin, h: stageH * 0.36 }
        : { ...sceneRect, x: sceneRect.x + sceneRect.w * 0.07, w: sceneRect.w * 0.86 };
      const ribbon: Rect = isWide
        ? { x: margin, y: stageH * 0.38, w: stageW - 2 * margin, h: stageH * 0.42 }
        : narrowRibbon;
      const zoomed = lerpRect(nav, close, zu);
      // Once the pairs start to close, the chain steps up and in a little on a wide screen, so
      // the cards arriving under it have their room.
      const closeRect: Rect = isWide
        ? {
            x: sceneRect.x + sceneRect.w * 0.07,
            y: sceneRect.y - stageH * 0.035,
            w: sceneRect.w * 0.86,
            h: sceneRect.h * 0.86,
          }
        : sceneRect;
      const staged = lerpRect(
        lerpRect(zoomed, sceneRect, smooth(P.fan[0], P.fan[1], p)),
        closeRect,
        smooth(P.close0 - 0.04, P.close0 + 0.01, p),
      );
      const plated = lerpRect(staged, plateRect, smooth(P.done - 0.04, P.done + 0.02, p));
      const rect = lerpRect(plated, ribbon, smooth(P.ribbon[0], P.ribbon[1], p));
      // A stroke still fading up only pulls the frame as far as it has arrived.
      let minX = Math.min(...xs);
      let maxX = xs[0] + W;
      xs.forEach((x, i) => (maxX = Math.max(maxX, lerp(maxX, x + W, Math.sqrt(fanA[i])))));
      // Phones follow the pair that is closing, strokes large and the chain running past the
      // edges, then pull back to the whole chain for the plate.
      const follow = isWide
        ? 0
        : smooth(P.close0 - 0.05, P.close0, p) * (1 - smooth(P.done - 0.03, P.done + 0.01, p));
      if (follow > 0) {
        let sum = 0;
        for (let kk = 0; kk < N - 1; kk++) sum += closeT(kk, p);
        const f = Math.min(N - 2, Math.max(0, sum - 0.5));
        const k0 = Math.floor(f);
        const k1 = Math.min(N - 2, k0 + 1);
        const mid = (kk: number) => (xs[kk] + xs[kk + 1] + W) / 2;
        const fx = lerp(mid(k0), mid(k1), f - k0);
        const half = OFF + W / 2 + 40;
        minX = lerp(minX, fx - half, follow);
        maxX = lerp(maxX, fx + half, follow);
      }
      const top = STROKE.top - NAME_ROOM * smooth(0.02, 0.12, p);
      const bottom = STROKE.bottom;
      const worldW = maxX - minX;
      const worldH = bottom - top;
      const k = Math.min(rect.w / worldW, rect.h / worldH);
      const vx = (minX + maxX) / 2 - (rect.x + rect.w / 2) / k;
      const vy = (top + bottom) / 2 - (rect.y + rect.h / 2) / k;
      cam.vx = vx;
      cam.vy = vy;
      cam.k = k;
      lastChain.xs = xs.slice();
      lastChain.vx = vx;
      lastChain.vy = vy;
      lastChain.k = k;
      lastChain.p = p;
      // The ribbon's first stroke on each side, which cuts a window into each end of the six.
      lastChain.edges = ribbonOn ? [left[0], right[0]] : [];
      const sx = (x: number) => (x - vx) * k;
      const sy = (y: number) => (y - vy) * k;

      // ── Draw: layer A on the canvas, layer B beside it, B composited with xor. ──
      const c = ctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = "source-over";
      c.globalAlpha = 1;
      c.clearRect(0, 0, canvas.width, canvas.height);
      ctxB.setTransform(1, 0, 0, 1, 0, 0);
      ctxB.clearRect(0, 0, layerB.width, layerB.height);
      const fill = (x: number, index: number, color: string, alpha = 1) => {
        const g = (index & 1) === 0 ? c : ctxB;
        g.globalAlpha = alpha;
        g.fillStyle = color;
        g.setTransform(k * dpr, 0, 0, k * dpr, (x - vx) * k * dpr, -vy * k * dpr);
        g.fill(strokePath);
      };
      // Ribbon first, so a stroke still under the chain stays hidden by its own layer.
      for (let j = RIBBON; j >= 1; j--) {
        if (!ribbonOn) break;
        const v = Math.round(lerp(118, 12, Math.pow(Math.min(1, (j - 1) / 7), 0.8)));
        const tone = `rgb(${v},${v},${v})`;
        fill(right[j - 1], 5 + j, tone, shownR[j - 1]);
        fill(left[j - 1], -j, tone, shownR[j - 1]);
      }
      // At the very top the header shows the mark itself (crisper than the canvas can at 3x).
      if (p > 0 || (monument && state.raw > 0)) xs.forEach((x, i) => fill(x, i, PAPER, fanA[i]));
      // Over the monument the canvas takes the mark once the hero has drawn it in Paper itself.
      if (monument) {
        const up = smooth(HERO_LEAD * 0.96, HERO_LEAD, state.raw).toFixed(3);
        if (canvas.style.opacity !== up) canvas.style.opacity = up;
      }
      c.globalAlpha = 1;
      ctxB.globalAlpha = 1;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = "xor";
      // Before the first measure the stage can be 0×0, and drawing an empty canvas throws.
      if (layerB.width && layerB.height) c.drawImage(layerB, 0, 0);

      c.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Which link is lit: the one under the pointer or focus, else the one that just opened,
      // else (the plate at rest) each in turn.
      const closing = p >= P.close0 && p < P.done;
      if (p >= P.done && p < PLATE_END) {
        if (cycleFrom < 0) cycleFrom = idle.t;
      } else cycleFrom = -1;
      const capIdx = capIndex(p);
      const lead = hot >= 0 ? hot : pointed;
      active =
        plate < 0.5 || p < P.close0
          ? -1
          : lead >= 0 && p >= P.done
            ? lead
            : closing
              ? capIdx
              : Math.floor((idle.t - cycleFrom) / CYCLE) % (N - 1);

      // Cards: wide screens set the five links in a row under the chain, in the order of their
      // windows and about as wide as the chain; narrow screens show the one in play. No wires:
      // the order and the light say which window holds which link. Each card's chip (the card
      // before it) steps in as its window opens. The plate lights every link at once; one under
      // the pointer or focus takes the light.
      const allOn = p >= P.done && plate > 0.5 && lead < 0;
      const chainBottom = sy(STROKE.bottom);
      const capY = chainBottom + (isWide ? 44 : 26);
      const centerX = sx((minX + maxX) / 2);
      // The row is as wide as the chain, or as five readable cards need, within the grid.
      const chainW = sx(maxX) - sx(minX);
      const half = Math.min((stageW - 2 * margin) / 2, Math.max(chainW, 5 * 250 + 4 * 16) / 2);
      const rowL = Math.max(margin, centerX - half);
      const rowR = Math.min(stageW - margin, centerX + half);
      const colW = (rowR - rowL + 16) / (N - 1);
      const cardW = Math.min(300, Math.max(150, colW - 16));
      const capW = `${cardW.toFixed(0)}px`;
      c.globalCompositeOperation = "xor";
      c.strokeStyle = PAPER;
      c.lineWidth = 1;
      caps.forEach((el, kk) => {
        const on = smooth(0.55, 1, closeT(kk, p)) * plate;
        const shown = isWide ? on : on * (kk === active ? 1 : 0);
        arrive(el, shown);
        el.style.pointerEvents = shown > 0.5 ? "auto" : "none";
        el.classList.toggle("is-on", kk === active || allOn);
        const colX = isWide
          ? Math.round(rowL + kk * colW)
          : Math.round((stageW - el.offsetWidth) / 2);
        gsap.set(el, { x: colX, y: capY });
        if (isWide && el.style.getPropertyValue("--cap-w") !== capW)
          el.style.setProperty("--cap-w", capW);
        const chip = chips[kk];
        if (chip) {
          const next = smooth(0.7, 1, closeT(kk, p)).toFixed(3);
          if (chip.style.getPropertyValue("--f") !== next) chip.style.setProperty("--f", next);
        }
        // A link opens: the window sends out one ring, through the strokes.
        const w = windowCenter(xs, kk);
        if (!w) return;
        const isOpen = closeT(kk, p) > 0.9;
        if (isOpen && !wasOpen[kk] && state.p > P.close0) opened[kk] = idle.t;
        wasOpen[kk] = isOpen;
        const age = (idle.t - opened[kk]) / RIPPLE;
        if (on < 0.001 || age < 0 || age >= 1) return;
        const e = 1 - Math.pow(1 - age, 3);
        c.globalAlpha = (1 - age) * 0.9;
        c.beginPath();
        c.arc(sx(w.x), sy(w.y), 6 + e * 44 * Math.max(0.6, k * 1.6), 0, Math.PI * 2);
        c.stroke();
      });
      c.globalAlpha = 1;
      c.globalCompositeOperation = "source-over";

      // Module names over each stroke's top cap, as each stroke lands.
      const nameA = smooth(0.1, 0.2, p);
      // A phone's chain is too narrow for a name over each stroke: the six stand in one row over
      // the chain, spread across the stage's width in the strokes' order, and stay while the
      // camera follows a pair (the pair's names lit, the rest dim). All six arrive together.
      const row = !isWide;
      const rowGap = row
        ? Math.max(8, (stageW - 2 * margin - nameW.reduce((a, b) => a + b, 0)) / (N - 1))
        : 0;
      let rowX = margin;
      names.forEach((el, i) => {
        const x = row ? rowX + nameW[i] / 2 : sx(xs[i] + CAP_X);
        if (row) rowX += nameW[i] + rowGap;
        gsap.set(el, {
          x,
          y: row ? sy(STROKE.top) - 14 : sy(STROKE.top - NAME_ROOM * 0.45),
          xPercent: -50,
          yPercent: -50,
          autoAlpha: nameA * smooth(0.55, 1, fanT(i, p)) * smooth(0.85, 1, fanT(N - 1, p)),
        });
        el.classList.toggle("is-dim", !allOn && active >= 0 && i !== active && i !== active + 1);
      });

      // The running count, in the spec sheet's grammar.
      let strokes = 3;
      for (let i = 3; i < N; i++) if (fanT(i, p) > 0.5) strokes++;
      // A window counts once it is open enough to see, between two strokes already dealt.
      let windows = 0;
      for (let kk = 0; kk < N - 1; kk++) {
        const w = windowCenter(xs, kk);
        const dealt = kk + 1 < 3 || fanT(kk + 1, p) > 0.5;
        if (w && dealt && w.open > 0.25 && xs[kk + 1] > xs[kk]) windows++;
      }
      const label = (n: number, [one, many]: readonly string[]) => `${n} ${n === 1 ? one : many}`;
      const text = `${label(strokes, interlock.readout.strokes)} · ${label(windows, interlock.readout.windows)}`;
      if (text !== lastReadout) {
        lastReadout = text;
        readout.textContent = text;
      }
      // It narrates the build and steps aside for the plate, where the cards say it.
      arrive(readout, smooth(0.05, 0.1, p) * (1 - smooth(P.done - 0.03, P.done, p)));

      // The hero leaves as the scene starts; beats arrive in the brand's grammar: a fade and a
      // short slide. One beat at a time, never two over each other.
      const heroA = 1 - smooth(heroOutAt[0], heroOutAt[1], monument ? state.raw : p);
      // The header has its mark back once the canvas copy has grown away from it (it fades in),
      // or the page is back at the top (at once: the canvas copy is gone in the same frame).
      if (!monument && lent !== (p > 0 && p < P.zoom[1])) {
        lent = !lent;
        root.classList.toggle("mark-return", !lent && p > 0);
        root.classList.toggle("mark-lent", lent);
      }
      arrive(heroEl, heroA);
      heroEl.style.visibility = heroA < 0.01 ? "hidden" : "";
      if (held) {
        const hold = `0 ${(heroA > 0 ? state.raw * span : 0).toFixed(1)}px`;
        if (held.style.translate !== hold) held.style.translate = hold;
      }
      if (heroOn !== heroA >= 0.01) {
        heroOn = heroA >= 0.01;
        // Over the header's mark the stage inverts the hero it crosses; over the monument it
        // doesn't (the hero has turned its own mark to Paper, which an inversion would blacken).
        scene.classList.toggle("is-hero", heroOn && !monument);
      }
      const beatA = [
        smooth(0.29, 0.32, p) * (1 - smooth(P.done - 0.035, P.done - 0.01, p)),
        smooth(P.done - 0.02, P.done + 0.01, p) * (1 - smooth(PLATE_END, PLATE_END + 0.02, p)),
        smooth(0.88, 0.92, p),
      ];
      beats.forEach((el, i) => {
        arrive(el, beatA[i]);
        el.style.visibility = beatA[i] < 0.01 ? "hidden" : "";
      });
    };

    const capIndex = (p: number) => {
      let idx = -1;
      for (let kk = 0; kk < N - 1; kk++) if (closeT(kk, p) > 0.55) idx = kk;
      return idx;
    };

    measure();
    apply();
    scene.classList.add("is-live");
    // The beats' heights depend on the face; measure again once it has loaded.
    void document.fonts?.ready.then(() => {
      measure();
      apply();
    });

    const st = ScrollTrigger.create({
      trigger: scene,
      start: "top top",
      end: "bottom bottom",
      invalidateOnRefresh: true,
      onRefresh: (self) => {
        span = Math.max(1, self.end - self.start);
        state.raw = self.progress;
        state.p = toScene(self.progress);
        measure();
        apply();
      },
      onUpdate: (self) => {
        state.raw = self.progress;
        state.p = toScene(self.progress);
        apply();
      },
    });
    span = Math.max(1, st.end - st.start);
    state.raw = st.progress;
    state.p = toScene(st.progress);

    // Idle: the wave and the plate's turn-taking while the chain rests, and the pointer's pull.
    const touch = isTouch();
    let visible = true;
    const io = new IntersectionObserver((es) => (visible = es[0].isIntersecting), { threshold: 0 });
    io.observe(stage);
    const tick = (time: number) => {
      idle.t = time;
      const rest = restAt(state.p);
      const rippling = opened.some((t0) => time - t0 < RIPPLE);
      if (!visible || (rest < 0.001 && !rippling)) return;
      idle.amp += (1 - idle.amp) * 0.02;
      // The window nearest the pointer is the one it points at (wide screens, on the plate).
      pointed = -1;
      if (!touch && idle.px >= 0 && state.p >= P.done && state.p < PLATE_END) {
        let best = 70;
        for (let kk = 0; kk < N - 1; kk++) {
          const x = (windowX(kk) - cam.vx) * cam.k;
          const y = (STROKE.windowY - cam.vy) * cam.k;
          const d = Math.hypot(idle.px - x, idle.py - y);
          if (d < best) {
            best = d;
            pointed = kk;
          }
        }
      }
      const lit = hot >= 0 ? hot : pointed >= 0 ? pointed : active;
      for (let kk = 0; kk < N - 1; kk++) {
        const target = kk === lit ? (hot >= 0 || pointed >= 0 ? 0.24 : 0.1) : 0;
        idle.pull[kk] += (target - idle.pull[kk]) * 0.08;
      }
      apply();
    };
    // Window centers at the resting chain (the pointer test needs no exact geometry).
    const windowX = (kk: number) => (kk + 1) * OFF + (W - OFF) / 2;
    gsap.ticker.add(tick);
    const move = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      idle.px = e.clientX - r.left;
      idle.py = e.clientY - r.top;
    };
    const leave = () => {
      idle.px = -1;
    };
    if (!touch) {
      addEventListener("pointermove", move, { passive: true });
      document.addEventListener("pointerleave", leave);
    }

    // Captions and the chain answer each other. A focused caption first brings the scene to the
    // plate, where every caption is on screen (never a focus on something invisible).
    const off = new AbortController();
    caps.forEach((el, kk) => {
      const opt = { signal: off.signal };
      el.addEventListener("pointerenter", () => (hot = kk), opt);
      el.addEventListener("pointerleave", () => (hot = -1), opt);
      el.addEventListener(
        "focusin",
        () => {
          if (state.p < P.done + 0.02 || state.p > PLATE_END - 0.02)
            jumpTo(st.start + (st.end - st.start) * toRaw(P.done + 0.05));
          hot = kk;
        },
        opt,
      );
      el.addEventListener("focusout", () => (hot = -1), opt);
    });

    return () => {
      off.abort();
      st.kill();
      introDone.kill();
      root.classList.remove("intro");
      io.disconnect();
      gsap.ticker.remove(tick);
      removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
      scene.classList.remove("is-live", "is-hero");
      canvas.style.removeProperty("opacity");
      root.classList.remove("mark-lent", "mark-return");
      heroEl.style.removeProperty("--a");
      held?.style.removeProperty("translate");
      heroEl.style.visibility = "";
      beats.forEach((el) => (el.style.visibility = ""));
    };
  });
}
