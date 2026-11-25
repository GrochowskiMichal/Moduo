// The type page (pages/typeface.astro, DESIGN.md §20): one specimen sheet, one camera, one
// scroll, endless.
//
//   turn     the name turns over as metal type is cast, about its d, and reads backwards; then
//            its letters turn over one by one, from the far end, and it reads moduo. Back again
//   rule     the name parts at the d into oud and dom, each keeping a d, a gloss under each
//   weights  down to the home page's line, which runs Light to Bold down five rows and sets a
//            row down at every hundred
//   kreska   down the sheet to the pangram; its marks drop onto their letters, and the camera
//            closes in on ś (the letters round it step back), its kreska the mark's stroke at
//            the size of an accent
//   figures  back out and along to the clock: the visitor's own time, in tabular figures
//   set      down to the set: every character, and on the plate beside it each one drawn in
//            turn with its outline, points and handles, at a weight that drifts Light to Bold;
//            then the scene becomes a poster: the pangram, the clock and the set step out, the
//            plate's glyph grows into the poster's figure, and its words and lockup come in
//   dive     into the name again, and the page around it comes back: the opening frame, so the
//            scroll wraps round to the start without a seam
//
// The story is timed in beats (q), one for every 900svh of scroll; the section is 1700svh, so q
// runs 0 to U. The camera is the drawing's viewBox (the type stays sharp), moved on a log scale.
// The name is redrawn from the two masters whenever its weight moves. Under reduced motion only
// the clock runs: it reads the time once.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { onPage, prefersReducedMotion, setEndless } from "../engine";
import { advance, type FontData, type Glyph, outlines, pathD } from "../lib/typeface";
import { glyphParts } from "../lib/typeface-glyph";

gsap.registerPlugin(ScrollTrigger);

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, p: number) => {
  const t = clamp01((p - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type View = { x: number; y: number; w: number; h: number };
type Box = [number, number, number, number];
type Data = {
  glyphs: Record<string, Glyph>;
  head: { g: string; xL: number; xB: number }[];
  t0: number;
  boxW: number;
  mid: number;
  part: number;
  line: {
    glyphs: { g: string; xL: number; xB: number }[];
    s: number;
    x: number;
    y0: number;
    pitch: number;
  };
  wall: { x: number; cell: number; y: number; pitch: number; per: number; ws: number };
  plate: {
    readY: number;
    sheet: { x: number; y: number; k: number };
    poster: { x: number; y: number; k: number };
  };
  boxes: {
    pangram: Box;
    sacute: Box;
    clock: Box;
    figures: Box;
    glyphs: Box;
    plate: Box;
    sheet: Box;
    halves: Box;
    stack: Box;
  };
};
/** The set, fetched as the page starts: every glyph's outlines and the characters in order. */
type GlyphSet = { glyphs: Record<string, Glyph>; chars: [number, string][] };

export function startTypeface() {
  onPage(() => {
    const root = document.querySelector<HTMLElement>("[data-tf]");
    if (!root) return;
    const cleanups: (() => void)[] = [];
    const reduce = prefersReducedMotion();
    const tick = clock(root);
    if (reduce) tick();
    else story(root, tick, cleanups);
    return () => cleanups.forEach((c) => c());
  });
}

/** The clock's figures: hours and minutes, and the seconds small. Returns a tick that redraws
 *  them only when the second changes. */
function clock(root: HTMLElement) {
  const figs = [...root.querySelectorAll<SVGUseElement>("[data-tf-fig]")];
  const secs = [...root.querySelectorAll<SVGUseElement>("[data-tf-sec]")];
  let shown = "";
  return () => {
    const d = new Date();
    const s = [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, "0"))
      .join("");
    if (s === shown) return;
    shown = s;
    [...figs, ...secs].forEach((u, i) => u.setAttribute("href", `#tf-fig-${s[i]}`));
  };
}

/** Between two views: the width on a log scale, the centre moving as the width does, so a zoom
 *  closes in (or pulls back) at an even pace and lands exactly. */
function between(a: View, b: View, z: number): View {
  const w = Math.exp(lerp(Math.log(a.w), Math.log(b.w), z));
  const f = Math.abs(a.w - b.w) < 1e-6 ? z : (a.w - w) / (a.w - b.w);
  const cx = lerp(a.x + a.w / 2, b.x + b.w / 2, f);
  const cy = lerp(a.y + a.h / 2, b.y + b.h / 2, f);
  const h = lerp(a.h, b.h, f);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function story(root: HTMLElement, tickClock: () => void, cleanups: (() => void)[]) {
  const svg = root.querySelector<SVGSVGElement>("[data-tf-svg]");
  if (!svg) return;
  const stage = root.querySelector<HTMLElement>(".tf__stage")!;
  const one = root.querySelector<HTMLElement>(".tf__one")!;
  const quiet = [...root.querySelectorAll<HTMLElement>(".tf__kicker, .tf__lead, .tf__spec")];
  const cue = root.querySelector<HTMLElement>("[data-tf-cue]");
  const beats = [...root.querySelectorAll<HTMLElement>("[data-tf-beat]")];
  // The name's five letters, then dom's own d, lying on the first until the name parts.
  const letters = [...svg.querySelectorAll<SVGGElement>("[data-tf-l]")];
  const parts = letters.map((g) => g.querySelector<SVGPathElement>("path")!);
  const halvesG = svg.querySelector<SVGGElement>("[data-tf-halves]")!;
  const halves = [...svg.querySelectorAll<SVGTextElement>("[data-tf-half]")];
  const headG = svg.querySelector<SVGGElement>("[data-tf-head]")!;
  const stackG = svg.querySelector<SVGGElement>("[data-tf-stack]")!;
  const steps = [...svg.querySelectorAll<SVGGElement>("[data-tf-step]")];
  const live = svg.querySelector<SVGPathElement>("[data-tf-live]")!;
  const slot = svg.querySelector<SVGRectElement>("[data-tf-slot]")!;
  const posterG = svg.querySelector<SVGGElement>("[data-tf-poster]")!;
  // The poster's words and lockup, in the order they come in: the head, then the foot.
  const posterText = [
    ...svg.querySelectorAll<SVGElement>(".tf__phead text, .tf__lockup, .tf__pfoot text"),
  ];
  const guides = svg.querySelector<SVGGElement>("[data-tf-guides]")!;
  const wght = root.querySelector<HTMLElement>("[data-tf-wght]");
  const rowsG = svg.querySelector<SVGGElement>("[data-tf-rows]")!;
  const row = (id: string) => svg.querySelector<SVGElement>(`[data-tf-row="${id}"]`)!;
  const rowEls = {
    pangram: row("pangram"),
    clock: row("clock"),
    glyphs: row("glyphs"),
  };
  const wall = svg.querySelector<SVGGElement>("[data-tf-wall]")!;
  const plateG = svg.querySelector<SVGGElement>("[data-tf-plate]")!;
  const marks = [...svg.querySelectorAll<SVGPathElement>("[data-tf-mark]")];
  // The pangram's letters but the ś, which step back while the camera is close on it.
  const others = [...svg.querySelectorAll<SVGGElement>('[data-tf-letter=""]')];
  const D = JSON.parse(svg.dataset.tf!) as Data;
  const font = { glyphs: D.glyphs } as FontData;
  // Letter i of the drawing is the name's letter LI[i]: dom's d is the name's d.
  const LI = [0, 1, 2, 3, 4, 2];
  const G = D.head.map((l) => D.glyphs[l.g]);

  // ── The name at weight t: where each letter stands, and its outlines. ──
  const xAt = (i: number, t: number) => lerp(D.head[i].xL, D.head[i].xB, t);
  const wAt = (i: number, t: number) => advance(G[i], t);
  const widthAt = (t: number) => xAt(4, t) + wAt(4, t);
  // The home page's line at weight t, as one path in its own units (the live row's transform
  // places it).
  let liveT = -1;
  const drawLive = (t: number) => {
    if (Math.abs(t - liveT) < 0.002) return;
    liveT = t;
    live.setAttribute(
      "d",
      D.line.glyphs
        .map((g) => pathD(outlines(font, g.g, t, lerp(g.xL, g.xB, t), 0), D.line.s, D.line.x, 0))
        .join(""),
    );
  };
  let drawnT = -1;
  const redraw = (t: number) => {
    if (Math.abs(t - drawnT) < 0.0008) return;
    drawnT = t;
    parts.forEach((p, i) => p.setAttribute("d", pathD(outlines(font, D.head[LI[i]].g, t))));
  };

  // ── The camera's stops, in the drawing's units, fitted to the stage's shape. ──
  let aspect = 1;
  const fit = ([x0, y0, x1, y1]: Box, room = 0.42, ax = 0.5): View => {
    // Room under the subject for the words, which sit at the stage's foot, and a little over it
    // for the header. `ax` places a subject narrower than the frame: 0.5 centres it.
    let [x, y, w, h] = [x0, y0 - (y1 - y0) * 0.08, x1 - x0, (y1 - y0) * (1.08 + room)];
    if (w / h < aspect) {
      const nw = h * aspect;
      x -= (nw - w) * ax;
      w = nw;
    } else {
      const nh = w / aspect;
      // On a tall screen the subject and its room sit in the middle; on a wide one, a little high.
      y -= (nh - h) * (room > 0 && aspect > 1 ? 0.35 : 0.5);
      h = nh;
    }
    return { x, y, w, h };
  };
  const PAD = 240;
  const grow = ([x0, y0, x1, y1]: Box, k: number): Box => {
    const [cx, cy, hw, hh] = [
      (x0 + x1) / 2,
      (y0 + y1) / 2,
      ((x1 - x0) / 2) * k,
      ((y1 - y0) / 2) * k,
    ];
    return [cx - hw, cy - hh, cx + hw, cy + hh];
  };
  let start: View;
  let keys: [number, View][] = [];
  const measure = () => {
    const s = stage.getBoundingClientRect();
    aspect = s.width / s.height;
    // The start: the drawing laid exactly over the h1.
    const r = one.getBoundingClientRect();
    const px = r.width / D.boxW;
    start = {
      x: -(r.left - s.left) / px,
      y: D.mid - (r.top + r.height / 2 - s.top) / px,
      w: s.width / px,
      h: s.height / px,
    };
    const t0 = D.t0;
    // The name, and the name turned over about its d, in one frame that holds while it turns.
    const cd = xAt(2, t0) + wAt(2, t0) / 2;
    const turnV = fit([
      Math.min(0, 2 * cd - widthAt(t0)) - PAD,
      -760 - PAD * 0.5,
      Math.max(widthAt(t0), 2 * cd) + PAD,
      20 + PAD * 0.5,
    ]);
    const halvesV = fit(D.boxes.halves, 0.5);
    // The home page's line at its five weights; on a tall screen its left part, the rows running
    // off the frame's right edge.
    const [lx0, ly0, lx1, ly1] = D.boxes.stack;
    const Lv =
      aspect > 1
        ? fit(grow([lx0, -760, lx1, ly1], 1.1), 0.36, 0.5)
        : fit([lx0 - 80, ly0, lx0 + (lx1 - lx0) * 0.42, ly1], 0.5, 0);
    const P = fit(grow(D.boxes.pangram, 1.08));
    // The ś, close: the kreska on its letter, right of the words on a wide screen.
    const K = fit(grow(D.boxes.sacute, 1.15), 0.42, aspect > 1.2 ? 0.62 : 0.5);
    // The clock and the app's numbers beside it; on a tall screen the clock alone, as wide as it.
    const C = fit(grow(aspect > 1 ? D.boxes.clock : D.boxes.figures, 1.15));
    // The set and its plate; on a tall screen the plate alone, as wide as the frame.
    const Gv =
      aspect > 1
        ? fit(grow(D.boxes.glyphs, 1.06), 0.42, aspect > 1.2 ? 0.7 : 0.5)
        : fit(grow(D.boxes.plate, 1.08), 0.5);
    // The whole sheet: on a wide screen it stands right of the words, as tall as the frame; on a
    // tall one it's as wide as the frame, over them.
    const S =
      aspect > 1.2
        ? fit(grow(D.boxes.sheet, 1.02), 0.04, 0.5)
        : fit(grow(D.boxes.sheet, 1.02), 0.04);
    keys = [
      [0.06, turnV],
      [0.36, turnV],
      [0.43, halvesV],
      [0.5, halvesV],
      [0.6, Lv],
      [0.72, Lv],
      [0.8, P],
      [0.84, P],
      [0.9, K],
      [0.97, K],
      [1.07, C],
      [1.15, C],
      [1.24, Gv],
      [1.42, Gv],
      [1.55, S],
      [1.72, S],
      [1.86, start],
    ];
  };
  measure();

  // ── The story's time line. ──
  const U = 1700 / 900;
  // The live row's weight: Light, to Bold as the camera holds on the rows.
  const liveAt = (q: number) => smooth(0.6, 0.71, q);
  // The turn, as metal type is cast: the whole name turns over about its d (it reads backwards,
  // the d a b), then each letter turns over where it stands, from the far end, and it reads
  // moduo. Back the same way, each letter, then the name.
  const wordTurn = (q: number) => Math.PI * (smooth(0.07, 0.14, q) - smooth(0.31, 0.355, q));
  const ownTurn = (i: number, q: number) => {
    const a = 0.145 + (4 - i) * 0.012;
    const b = 0.255 + i * 0.009;
    return Math.PI * (smooth(a, a + 0.05, q) - smooth(b, b + 0.04, q));
  };
  const camera = (q: number): View => {
    if (q <= keys[0][0]) return between(start, keys[0][1], smooth(0.012, 0.06, q));
    for (let i = 1; i < keys.length; i++) {
      const [pb, vb] = keys[i];
      const [pa, va] = keys[i - 1];
      if (q <= pb) return between(va, vb, smooth(pa, pb, q));
    }
    return keys[keys.length - 1][1];
  };
  // Each caption's span.
  const SPANS: [number, number][] = [
    [0.05, 0.36],
    [0.36, 0.55],
    [0.55, 0.72],
    [0.72, 1.0],
    [1.0, 1.17],
    [1.17, 1.5],
  ];

  let breath = 0;
  let last = 0;
  const draw = (p: number) => {
    last = p;
    const q = p * U;
    // The name breathes a few units of weight while it's on screen, the h1 with it, so the two
    // still lie exactly over each other at the hand-over.
    const t = clamp01(D.t0 + breath);
    redraw(t);
    one.style.fontWeight = (300 + 400 * t).toFixed(1);
    const v = camera(q);
    svg.setAttribute(
      "viewBox",
      `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.w.toFixed(2)} ${v.h.toFixed(2)}`,
    );
    // The hand-over from the h1 to the drawing that lies exactly over it, and back at the end. A
    // swap, not a crossfade: two copies of one word half see-through would read grey.
    const take = q > 0.004 && q < U - 0.004 ? 1 : 0;
    svg.style.opacity = String(take);
    one.style.opacity = String(1 - take);
    const away = 1 - smooth(0.01, 0.05, q) + smooth(1.82, 1.86, q);
    // The band behind the words is off over the name at the start and the end, and over the
    // poster, which carries no words.
    stage.style.setProperty(
      "--band",
      (smooth(0.02, 0.05, q) * (1 - smooth(1.48, 1.52, q))).toFixed(3),
    );
    quiet.forEach((el) => (el.style.opacity = away.toFixed(3)));
    if (cue)
      cue.style.opacity = (1 - smooth(0, 0.02, q) + smooth(U - 0.025, U - 0.005, q)).toFixed(3);

    // The letters: turned over about the d and each about itself, and parted at the d.
    const cd = xAt(2, t) + wAt(2, t) / 2;
    const word = Math.cos(wordTurn(q));
    const part = smooth(0.38, 0.44, q) * (1 - smooth(0.5, 0.55, q));
    const shift = (D.part / 2) * part;
    letters.forEach((g, i) => {
      const li = LI[i];
      const w = wAt(li, t);
      const c = cd + (xAt(li, t) + w / 2 - cd) * word;
      const sx = word * Math.cos(ownTurn(li, q));
      const dx = i < 3 ? -shift : shift;
      g.setAttribute(
        "transform",
        `translate(${(c - (w / 2) * sx + dx).toFixed(2)} 0) scale(${sx.toFixed(4)} 1)`,
      );
    });
    letters[5].style.visibility = part > 0.001 ? "visible" : "hidden";
    // The glosses ride with their words, in once the words are apart.
    halvesG.style.opacity = (smooth(0.43, 0.46, q) * (1 - smooth(0.49, 0.51, q))).toFixed(3);
    halves.forEach((h, i) =>
      h.setAttribute(
        "transform",
        `translate(${((i ? 1 : -1) * (shift - D.part / 2)).toFixed(1)} 0)`,
      ),
    );

    // The home page's line: the live row comes out from under the row last set down, a hundred
    // bolder by the time it has moved one row down, where it's set down too; and on to Bold.
    const lw = liveAt(q);
    const k = Math.min(3, Math.floor(lw * 4));
    const yk = D.line.y0 + k * D.line.pitch;
    if (q > 0.5 && q < 0.76) drawLive(lw);
    live.setAttribute("transform", `translate(0 ${(yk + (lw * 4 - k) * D.line.pitch).toFixed(1)})`);
    slot.setAttribute("y", (yk + 235 * D.line.s).toFixed(1));
    slot.setAttribute("height", (2 * D.line.pitch).toFixed(1));
    live.style.visibility = q < 0.74 ? "visible" : "hidden";
    steps.forEach((g, i) => (g.style.visibility = lw * 4 >= i - 0.001 ? "visible" : "hidden"));
    if (wght) wght.textContent = String(Math.round(300 + 400 * lw));

    // The sheet's rows come in as the camera reads down to them, and go as it dives to the name.
    const out = 1 - smooth(1.74, 1.81, q);
    rowsG.style.opacity = (smooth(0.73, 0.79, q) * out).toFixed(3);
    // The row being read is lit; the others wait, dimmed. As the poster forms, the name and the
    // line light again, the plate glides up under them, and the pangram, the clock and the set
    // step out.
    const allAt = (i: number) => smooth(1.46 + i * 0.03, 1.52 + i * 0.03, q);
    const gone = 1 - smooth(1.42, 1.48, q);
    const po = smooth(1.42, 1.55, q);
    const [a, b] = [D.plate.sheet, D.plate.poster];
    plateG.setAttribute(
      "transform",
      `translate(${lerp(a.x, b.x, po).toFixed(1)} ${lerp(a.y, b.y, po).toFixed(1)}) scale(${lerp(a.k, b.k, po).toFixed(4)})`,
    );
    const dim = (on: number, i = 0) => (0.14 + 0.86 * Math.max(on, allAt(i))).toFixed(3);
    headG.style.opacity = dim(1 - smooth(0.73, 0.79, q));
    stackG.style.opacity = (
      smooth(0.54, 0.58, q) *
      out *
      Number(dim(1 - smooth(0.73, 0.79, q), 1))
    ).toFixed(3);
    // The plate leaves its guides behind as it grows into the poster's glyph; then the poster's
    // words come in, the head first, a few at a time.
    guides.style.opacity = (1 - smooth(1.42, 1.47, q)).toFixed(3);
    posterG.style.opacity = out.toFixed(3);
    posterText.forEach((el, i) => {
      const a0 = 1.55 + i * 0.008;
      el.style.opacity = smooth(a0, a0 + 0.04, q).toFixed(3);
    });
    const lit = (on: number) => 0.14 + 0.86 * on;
    rowEls.pangram.style.opacity = (lit(1 - smooth(0.99, 1.05, q)) * gone).toFixed(3);
    rowEls.clock.style.opacity = (
      lit(smooth(0.98, 1.05, q) * (1 - smooth(1.16, 1.22, q))) * gone
    ).toFixed(3);
    rowEls.glyphs.style.opacity = dim(smooth(1.16, 1.22, q), 2);
    wall.style.opacity = gone.toFixed(3);
    // Close on the ś, the letters round it step back too, each whole, with its mark.
    const solo = 1 - 0.86 * smooth(0.86, 0.9, q) * (1 - smooth(0.97, 1.01, q));
    others.forEach((el) => (el.style.opacity = solo.toFixed(3)));
    marks.forEach((m, i) => {
      const a = 0.75 + i * 0.008;
      const d = 1 - smooth(a, a + 0.04, q);
      m.setAttribute("transform", `translate(0 ${(-260 * d).toFixed(1)})`);
      m.style.opacity = (1 - d).toFixed(3);
    });

    // The words: one beat at a time, quick fades, back to back.
    beats.forEach((b, i) => {
      const [a0, a1] = SPANS[i];
      const a = smooth(a0, a0 + 0.008, q) * (1 - smooth(a1 - 0.008, a1, q));
      b.style.opacity = a.toFixed(3);
      b.style.visibility = a > 0.01 ? "visible" : "hidden";
    });
  };

  // ── The plate: every character in turn, drawn with its curves. Each one's outline draws in, its
  // points and handles come up, its strokes fill under a 45° edge, it holds, and a second edge
  // wipes it for the next. The weight drifts Light to Bold under it all the while. ──
  const plate = plateOf(svg, D);
  let set: GlyphSet | null = null;
  fetch("/typeface-glyphs.json", { priority: "low" } as RequestInit)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: GlyphSet | null) => {
      if (j) set = j;
    })
    .catch(() => {});
  let elapsed = 0;

  const st = ScrollTrigger.create({
    trigger: root,
    start: "top top",
    end: "bottom bottom",
    // No scrub lag: Lenis already smooths, and a lagging scrub would replay the story at the wrap.
    scrub: true,
    invalidateOnRefresh: true,
    onRefresh: (self) => {
      measure();
      draw(self.progress);
    },
    onUpdate: (self) => draw(self.progress),
  });
  tickClock();
  draw(st.progress);
  setEndless(true);
  // The idle: the name breathes a few units of weight while it's on screen; the clock runs while
  // the sheet is, and the plate draws while the set is near.
  // The breath eases in and out, so it never jumps (at the wrap, the name comes back still).
  let amp = 0;
  const idle = (time: number, deltaMs: number) => {
    if (!ScrollTrigger.isInViewport(root)) return;
    const q = last * U;
    tickClock();
    if (set && q > 1.1 && q < 1.81) {
      elapsed += Math.min(deltaMs, 100) / 1000;
      plate(set, elapsed, 0.5 - 0.5 * Math.cos(elapsed * 0.45));
    }
    amp += ((q < 0.72 ? 1 : 0) - amp) * 0.04;
    if (amp < 0.001 && breath === 0) return;
    breath = amp < 0.001 ? 0 : amp * Math.sin(time * 0.7) * 0.05;
    draw(last);
  };
  gsap.ticker.add(idle);
  cleanups.push(() => {
    gsap.ticker.remove(idle);
    setEndless(false);
    st.kill();
    [
      svg,
      one,
      headG,
      halvesG,
      stackG,
      live,
      posterG,
      ...steps,
      ...posterText,
      guides,
      rowsG,
      ...Object.values(rowEls),
      wall,
      ...quiet,
      ...beats,
      ...marks,
      ...others,
      ...letters,
      stage,
      ...(cue ? [cue] : []),
    ].forEach((el) => el.removeAttribute("style"));
  });
}

/** The plate's drawing. Returns a draw for the set at a time (seconds on the plate) and a weight. */
function plateOf(svg: SVGSVGElement, D: Data) {
  const q = <T extends Element>(sel: string) => svg.querySelector<T>(sel)!;
  const el = {
    fill: q<SVGPathElement>("[data-tf-fill]"),
    seam: q<SVGPathElement>("[data-tf-seam]"),
    wire: q<SVGPathElement>("[data-tf-wire]"),
    hdl: q<SVGPathElement>("[data-tf-hdl]"),
    off: q<SVGPathElement>("[data-tf-off]"),
    on: q<SVGPathElement>("[data-tf-on]"),
    adv: q<SVGPathElement>("[data-tf-adv]"),
    read: q<SVGTextElement>("[data-tf-read]"),
    pread: q<SVGTextElement>("[data-tf-pread]"),
    inClip: q<SVGPathElement>("[data-tf-in]"),
    outClip: q<SVGPathElement>("[data-tf-out]"),
    lit: q<SVGRectElement>("[data-tf-lit]"),
    litch: q<SVGTextElement>("[data-tf-litch]"),
  };
  // The band between two 45° lines, x + y = lo and x + y = hi, in the plate's units; the glyph's
  // box runs from about -1650 to 1100 along them.
  const band = (lo: number, hi: number) =>
    `M${(lo + 9000).toFixed(1)} -9000L${(hi + 9000).toFixed(1)} -9000L${(hi - 9000).toFixed(1)} 9000L${(lo - 9000).toFixed(1)} 9000Z`;
  const along = (v: number) => lerp(-1650, 1100, v);
  const [ASC, DESC] = [740, -210];
  const DUR = 1.8;
  const hex = (u: number) => `U+${u.toString(16).toUpperCase().padStart(4, "0")}`;
  // The dashes are drawn on the sheet, never typed (DESIGN.md §20): their cell and readout show none.
  const shown = (u: number) => (u === 0x2013 || u === 0x2014 ? "" : String.fromCodePoint(u));
  let font: FontData | null = null;
  let at = -1;
  let drawnT = -1;
  return (set: GlyphSet, time: number, t: number) => {
    font ??= { glyphs: set.glyphs } as FontData;
    const n = set.chars.length;
    // Start on the g, drawn, as the still plate has it.
    const g0 = Math.max(
      0,
      set.chars.findIndex(([u]) => u === 0x67),
    );
    const k = (g0 + Math.floor(time / DUR + 0.6)) % n;
    const s = (time / DUR + 0.6) % 1;
    const [u, name] = set.chars[k];
    if (k !== at || Math.abs(t - drawnT) > 0.004) {
      const p = glyphParts(font, name, t);
      el.fill.setAttribute("d", p.fill);
      el.seam.setAttribute("d", p.edge);
      el.wire.setAttribute("d", p.edge);
      el.hdl.setAttribute("d", p.handles);
      el.off.setAttribute("d", p.offs);
      el.on.setAttribute("d", p.ons);
      el.adv.setAttribute(
        "d",
        `M${p.ox.toFixed(1)} ${-ASC - 60}V${-DESC + 60}M${(p.ox + p.adv).toFixed(1)} ${-ASC - 60}V${-DESC + 60}`,
      );
      const ch = shown(u);
      el.read.textContent = `${ch}${ch ? "   " : ""}${hex(u)}   ${p.strokes} ${p.strokes === 1 ? "stroke" : "strokes"}   ${Math.round(p.adv)} wide   weight ${Math.round(300 + 400 * t)}`;
      el.pread.textContent = el.read.textContent;
      if (k !== at) {
        const { x, cell, y, pitch, per, ws } = D.wall;
        const [col, r] = [k % per, Math.floor(k / per)];
        el.lit.setAttribute("x", (x + col * cell).toFixed(1));
        el.lit.setAttribute("y", (y + r * pitch - ws * 0.95).toFixed(1));
        el.litch.setAttribute("x", (x + (col + 0.5) * cell).toFixed(1));
        el.litch.setAttribute("y", (y + r * pitch).toFixed(1));
        el.litch.textContent = ch;
      }
      at = k;
      drawnT = t;
    }
    // The outline draws in; the points and handles come up with it; the strokes fill behind a
    // 45° edge; a second edge wipes the glyph at the end of its time.
    el.wire.style.strokeDashoffset = (1 - smooth(0, 0.3, s)).toFixed(4);
    const pts = smooth(0.06, 0.24, s).toFixed(3);
    [el.hdl, el.off, el.on].forEach((e) => (e.style.opacity = pts));
    el.inClip.setAttribute("d", band(-9000, along(smooth(0.22, 0.5, s))));
    el.outClip.setAttribute("d", band(along(smooth(0.86, 1, s)), 9000));
  };
}
