// The colophon (pages/colophon.astro, DESIGN.md §19): one endless scene, one camera, one scroll.
//
//   read    the credit line is read closer: the camera (the drawing's viewBox, so the type stays
//           sharp) closes in on the d of Oudom, on a log scale so the zoom feels even; the joins
//           between strokes show on the way; a 45° guide lands on the stem's cut
//   one     the stroke lies inside the stem (its top on the stem's cut); the letters fall away
//           around it as the camera pulls back, and the stroke is what is left
//   two     a second stroke slides over it: one window, a link
//   three   a third from the other side: the mark
//   window  a step closer; a 45° band sweeps over the mark and turns it inside out (the strokes
//           to their edges, the two windows, the part nobody drew, solid), and a second sweep
//           turns it back: the buttons' sweep, at the mark's size
//   more    two more: a chain, the five company pages named over their tops; then they go
//   blank   the left steps aside (two apart open nothing); the right lies on the middle and both
//           cancel, leaving the blank, the outline
//   back    the left slides on and fills it: three in one place leave one stroke
//   set     the camera pulls back from the stroke to the line; the letters return around it (the
//           stroke lies exactly in the d's stem again) and the page around the line comes back:
//           the opening frame, with no caption of its own, so the scroll wraps round to the
//           start without a seam
//
// The story is timed in "beats" (q), 1 for every 1050svh of scroll: the section is 1600svh, so q
// runs 0 to U. The window is a pause laid into that timeline (WIN to WIN + DW): everything else
// reads the story's time with the pause taken out (oq), so the beats either side keep their
// timing. The captions crossfade quickly in a band at the stage's foot. Under reduced motion
// nothing runs: the still page shows the story as a strip of figures.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { onPage, prefersReducedMotion, setEndless } from "../engine";

gsap.registerPlugin(ScrollTrigger);

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, p: number) => {
  const t = clamp01((p - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function startColophon() {
  onPage(() => {
    const cleanups: (() => void)[] = [];
    if (!prefersReducedMotion()) story(cleanups);
    return () => cleanups.forEach((c) => c());
  });
}

type View = { x: number; y: number; w: number; h: number };
type Data = {
  view: View;
  stem: { x0: number; x1: number; y0: number; y1: number };
  world: { tx: number; ty: number; k: number };
  chain: number[];
};

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

function story(cleanups: (() => void)[]) {
  const root = document.querySelector<HTMLElement>("[data-cz]");
  const svg = root?.querySelector<SVGSVGElement>("[data-cz-svg]");
  if (!root || !svg) return;
  const stage = root.querySelector<HTMLElement>(".cz__stage")!;
  const one = root.querySelector<HTMLElement>(".cz__one")!;
  const line = svg.querySelector<SVGGElement>("[data-cz-line]")!;
  const sts = [...svg.querySelectorAll<SVGPathElement>("[data-cz-st]")];
  const xg = svg.querySelector<SVGGElement>(".cz__x")!;
  const pagesG = svg.querySelector<SVGGElement>("[data-cz-pages]")!;
  const wins = [...svg.querySelectorAll<SVGPathElement>("[data-cz-win]")];
  const edges = [...svg.querySelectorAll<SVGPathElement>("[data-cz-edge]")];
  const normClip = svg.querySelector<SVGPathElement>("[data-cz-norm]")!;
  const turnClip = svg.querySelector<SVGPathElement>("[data-cz-turn]")!;
  // The band between two 45° lines, x + y = lo and x + y = hi, in the strokes' own units.
  const band = (lo: number, hi: number) =>
    `M${(lo + 9000).toFixed(1)} -9000L${(hi + 9000).toFixed(1)} -9000L${(hi - 9000).toFixed(1)} 9000L${(lo - 9000).toFixed(1)} 9000Z`;
  const quiet = [...root.querySelectorAll<HTMLElement>(".cz__kicker, .cz__two, .cz__device")];
  const cue = root.querySelector<HTMLElement>("[data-cz-cue]");
  const beats = [...root.querySelectorAll<HTMLElement>("[data-cz-beat]")];
  const D = JSON.parse(svg.dataset.cz!) as Data;
  const { tx, ty, k } = D.world;
  const OFF = D.chain[2] - D.chain[1];
  const SW = 331.51;
  // How far the left stroke steps aside for the blank: far enough that it touches nothing.
  const AWAY = 2.3;

  // The camera's stops, in the font's units, fitted to the stage's shape.
  let aspect = 1;
  const fit = (v: View, room = 0.3): View => {
    // Room under the subject for the words, which sit at the stage's foot.
    let { x, y, w, h } = { ...v, h: v.h * (1 + room) };
    if (w / h < aspect) {
      const nw = h * aspect;
      x -= (nw - w) / 2;
      w = nw;
    } else {
      const nh = w / aspect;
      y -= (nh - h) * (room > 0 ? 0.35 : 0.5);
      h = nh;
    }
    return { x, y, w, h };
  };
  /** A box in the strokes' own units, as a view in the font's. */
  const world = (x0: number, y0: number, x1: number, y1: number): View => ({
    x: tx + x0 * k,
    y: ty + y0 * k,
    w: (x1 - x0) * k,
    h: (y1 - y0) * k,
  });
  let keys: [number, View][] = [];
  let windowV: View;
  let threeAt: View;
  const measure = () => {
    const s = stage.getBoundingClientRect();
    aspect = s.width / s.height;
    // The start: the drawing laid exactly over the h1's first sentence.
    const r = one.getBoundingClientRect();
    const px = r.width / (D.view.w - 80);
    const start: View = {
      x: -(r.left - s.left) / px,
      y: -350 - (r.top + r.height / 2 - s.top) / px,
      w: s.width / px,
      h: s.height / px,
    };
    // The stem's top and its 45° cut, filling the screen.
    const sw = D.stem.x1 - D.stem.x0;
    const tw = sw * (aspect > 1 ? 3.2 : 2.2);
    const close: View = {
      x: (D.stem.x0 + D.stem.x1) / 2 - tw / 2,
      y: D.stem.y0 + sw * 0.8 - tw / aspect / 2,
      w: tw,
      h: tw / aspect,
    };
    const strokeV = fit(world(-420, 120, SW + 420, 880));
    const twoV = fit(world(-360, 120, OFF + SW + 360, 880));
    const threeV = fit(world(-OFF - 360, 120, OFF + SW + 360, 880));
    // A step closer to the mark, so its two windows carry the frame.
    windowV = fit(world(-OFF - 170, 170, OFF + SW + 170, 830));
    threeAt = threeV;
    const fiveV = fit(world(-OFF - 300, 80, 3 * OFF + SW + 300, 880));
    const blankV = fit(world(-AWAY * OFF - 300, 120, SW + 380, 880));
    keys = [
      [0.02, start],
      [0.2, close],
      [0.235, close],
      // One pull back, from the stem's top to the stroke, while the rest falls away.
      [0.37, strokeV],
      [0.41, strokeV],
      [0.48, twoV],
      [0.51, twoV],
      [0.59, threeV],
      [0.66, threeV],
      // More than three: out to the chain of five, and back to the mark as the two go.
      [0.74, fiveV],
      [0.84, fiveV],
      [0.9, threeV],
      // The blank: the left steps aside, the right lies on the middle.
      [0.97, blankV],
      [1.06, blankV],
      // Back: in to the one stroke as the left fills the blank.
      [1.14, strokeV],
      [1.16, strokeV],
      // And one pull back to the line, the letters returning around the stroke.
      [1.31, start],
    ];
  };
  measure();

  const camera = (p: number): View => {
    if (p <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [pb, vb] = keys[i];
      const [pa, va] = keys[i - 1];
      if (p <= pb) return between(va, vb, smooth(pa, pb, p));
    }
    return keys[keys.length - 1][1];
  };
  // Where each stroke stands at q, in its own units: [x, opacity]. 0 is the mark's left, 1 the
  // middle, 2 its right, 3 and 4 the chain's two more. The middle comes first, then the right,
  // the left, and the two.
  const strokeAt = (i: number, q: number): [number, number] => {
    const home = D.chain[i];
    let x = home;
    // The mark's three last until the letters are back over them (the middle lies inside the
    // stem, hidden by it, at both ends: nothing morphs, nothing swaps).
    let o = q < 1.24 ? 1 : 0;
    if (i === 1) o *= q >= 0.23 ? 1 : 0;
    else if (i === 2) {
      x = lerp(home + 3.2 * OFF, home, smooth(0.41, 0.48, q));
      // Onto the middle: two in one place cancel.
      x = lerp(x, 0, smooth(0.92, 0.97, q));
      o *= q >= 0.41 ? 1 : 0;
    } else if (i === 0) {
      x = lerp(home - 4 * OFF, home, smooth(0.52, 0.59, q));
      // Aside, far enough to touch nothing; then onto the blank: three in one place leave one.
      x = lerp(x, -AWAY * OFF, smooth(0.88, 0.93, q));
      x = lerp(x, 0, smooth(1.07, 1.13, q));
      o *= q >= 0.52 ? 1 : 0;
    } else {
      // The chain's two: in from the right, one after the other, and out the same way.
      const a = 0.66 + (i - 3) * 0.025;
      x = lerp(home + 4 * OFF, home, smooth(a, a + 0.07, q));
      x = lerp(x, home + 4 * OFF, smooth(0.84 + (4 - i) * 0.015, 0.89 + (4 - i) * 0.015, q));
      o = q >= a && q < 0.92 ? 1 : 0;
    }
    // At rest in the chain the strokes breathe a hair apart and back, so the windows do too.
    if (i !== 1)
      x +=
        breath *
        (i === 0 ? -1 : 1) *
        Math.min(i === 0 ? 1 : i - 1, 3) *
        (1 - smooth(0.82, 0.84, q));
    return [x, o];
  };

  // The story's length in beats (the section's 1450svh over 1050svh), and each caption's span.
  const U = 1600 / 1050;
  // The window's pause: where it starts in the story, and how long it holds.
  const WIN = 0.66;
  const DW = 0.14;
  const SPANS: [number, number][] = [
    [0.04, 0.17],
    [0.17, 0.27],
    [0.27, 0.41],
    [0.41, 0.52],
    [0.52, WIN],
    [WIN, WIN + DW],
    [0.66 + DW, 0.88 + DW],
    [0.88 + DW, 1.06 + DW],
    [1.06 + DW, 1.16 + DW],
  ];

  let breath = 0;
  let last = 0;
  const draw = (p: number) => {
    last = p;
    const q = p * U;
    // The story's time with the window's pause taken out, and how far into the pause we are.
    const oq = q <= WIN ? q : q >= WIN + DW ? q - DW : WIN;
    const w = clamp01((q - WIN) / DW);
    const inWin = q > WIN && q < WIN + DW;
    // A step in to the mark and back out; between, figure and ground swap.
    const v = inWin
      ? between(between(threeAt, windowV, smooth(0.04, 0.4, w)), threeAt, smooth(0.72, 0.98, w))
      : camera(oq);
    // The sweeps: the turned band runs from the line it has passed (back) to the one it's at
    // (front), both moving along the mark's 45° from its top left to its foot.
    const front = lerp(150, 1400, smooth(0.16, 0.42, w));
    const back = lerp(150, 1400, smooth(0.6, 0.86, w));
    turnClip.setAttribute("d", band(back, front));
    normClip.setAttribute("d", band(-9000, back) + band(front, 9000));
    svg.setAttribute(
      "viewBox",
      `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.w.toFixed(2)} ${v.h.toFixed(2)}`,
    );
    // The hand-over from the h1 to the drawing, the page around it going quiet; at the end the
    // drawing hands back to the h1 it lies exactly over, so the wrap to the start has no seam.
    // A swap, not a crossfade: two copies of one line half see-through would read grey.
    const take = q > 0.004 && q < U - 0.004 ? 1 : 0;
    svg.style.opacity = take.toFixed(3);
    one.style.opacity = (1 - take).toFixed(3);
    // The page around the line goes quiet, and comes back once the line is whole again.
    const away = 1 - smooth(0.01, 0.06, oq) + smooth(1.29, 1.33, oq);
    quiet.forEach((el) => (el.style.opacity = away.toFixed(3)));
    if (cue)
      cue.style.opacity = (1 - smooth(0, 0.02, q) + smooth(U - 0.025, U - 0.005, q)).toFixed(3);
    // The letters: their joins show as they grow, and go before they do; back in the line they
    // show once more, and go before the start.
    svg.style.setProperty(
      "--j",
      (
        smooth(0.07, 0.14, oq) * 0.9 * (1 - smooth(0.22, 0.25, oq)) +
        smooth(1.22, 1.27, oq) * 0.6 * (1 - smooth(1.32, 1.35, oq))
      ).toFixed(3),
    );
    // The letters, the stem with them, fall away together as the camera pulls back, and come back
    // around the stroke as it pulls back again.
    line.style.opacity = (1 - smooth(0.25, 0.34, oq) + smooth(1.16, 1.2, oq)).toFixed(3);
    svg.style.setProperty(
      "--g",
      (smooth(0.17, 0.2, oq) * (1 - smooth(0.235, 0.255, oq))).toFixed(3),
    );
    sts.forEach((el, i) => {
      const [x, o] = strokeAt(i, oq);
      if (i < 3) edges[i].setAttribute("transform", `translate(${x.toFixed(2)} 0)`);
      if (i === 0 || i === 2) wins[i / 2].setAttribute("transform", `translate(${x.toFixed(2)} 0)`);
      el.setAttribute("transform", `translate(${x.toFixed(2)} 0)`);
      el.setAttribute("opacity", String(o));
    });
    // The chain's pages: named over their tops once the two have landed.
    pagesG.style.opacity = (smooth(0.73, 0.76, oq) * (1 - smooth(0.82, 0.845, oq))).toFixed(3);
    // The blank: its outline shows as the two lie in one place, and goes as the third fills it.
    xg.style.setProperty(
      "--b",
      (smooth(0.96, 0.975, oq) * (1 - smooth(1.1, 1.125, oq))).toFixed(3),
    );
    // The words: one beat at a time, quick fades, back to back so there's always one on screen.
    beats.forEach((b, i) => {
      const [a0, a1] = SPANS[i];
      const a = smooth(a0, a0 + 0.008, q) * (1 - smooth(a1 - 0.008, a1, q));
      b.style.opacity = a.toFixed(3);
      b.style.visibility = a > 0.01 ? "visible" : "hidden";
    });
  };

  const st = ScrollTrigger.create({
    trigger: root,
    start: "top top",
    end: "bottom bottom",
    // No scrub lag: Lenis already smooths, and a lagging scrub would replay the whole story at
    // the wrap from the end to the start.
    scrub: true,
    invalidateOnRefresh: true,
    onRefresh: (self) => {
      measure();
      draw(self.progress);
    },
    onUpdate: (self) => draw(self.progress),
  });
  draw(st.progress);
  setEndless(true);
  // The idle: while the chain is on screen (two strokes to five), the breath runs on the clock.
  const idle = (time: number) => {
    const q = last * U;
    if (q < 0.46 || q > 0.84 + DW || !ScrollTrigger.isInViewport(root)) return;
    breath = Math.sin(time * 0.6) * 5;
    draw(last);
  };
  gsap.ticker.add(idle);
  cleanups.push(() => {
    gsap.ticker.remove(idle);
    setEndless(false);
    st.kill();
    svg.setAttribute("viewBox", `${D.view.x} ${D.view.y} ${D.view.w} ${D.view.h}`);
    [svg, one, line, xg, pagesG, ...quiet, ...beats, ...(cue ? [cue] : [])].forEach((el) =>
      el.removeAttribute("style"),
    );
    sts.forEach((el) => {
      el.removeAttribute("transform");
      el.setAttribute("opacity", "0");
    });
  });
}
