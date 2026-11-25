// The home hero's frame, apart from its picture (motion/first-light.ts draws that): the layout of
// the clip's frame over the hero's layer and the mark's box on its desk (the scene below grows the
// mark from the box), the spectrum's aim at the app's window and the light its frame takes in, the
// scroll's beats (HERO_LEAD, HERO_BEATS), the intro's look and the pointer.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { ease, isTouch } from "../engine";
import { cover, FAN, FAN_TURN, fanAt, MARK_BOX, NARROW, type Place } from "../lib/first-light";
import { HERO_BEATS, HERO_LEAD } from "../lib/scene";

gsap.registerPlugin(ScrollTrigger);

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (a: number, b: number, p: number) => {
  const t = clamp01((p - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const beat = (k: keyof typeof HERO_BEATS, p: number) =>
  smooth(HERO_BEATS[k][0] * HERO_LEAD, HERO_BEATS[k][1] * HERO_LEAD, p);

/** What the driver is given when it mounts: the hero, and whether to play the intro (a first
 *  visit). */
export type MountCtx = { hero: HTMLElement; playIntro: boolean };

export function createFrame(o: {
  hero: HTMLElement;
  layer: HTMLElement;
  canvas: HTMLCanvasElement;
  box: HTMLElement;
  hwin: HTMLElement | null;
  scene: HTMLElement | null;
  places: { wide: Place; narrow: Place };
  quality: number;
}) {
  const { hero, layer, canvas, box, hwin, scene, places } = o;
  const narrow = matchMedia(NARROW);
  /** The layout: the canvas's size, its resolution, the frame's place on it (CSS px of frame px
   *  0, 0 and CSS px per frame px) and the mark's (CSS px of unit 0, 0 and CSS px per unit). */
  const L = { w: 1, h: 1, scale: 1, fx: 0, fy: 0, fs: 1, ox: 0, oy: 0, k: 1 };
  const S = {
    place: places.wide as Place,
    /** Sharpness: the screen's density up to this, lowered once if frames run long. */
    quality: o.quality,
    /** Where the spectrum is aimed (the mockup's centre) and where the mockup takes it in (its
     *  top edge), in mark units; where the mockup stands on the canvas (CSS px). */
    fanDir: [...FAN.dir] as [number, number],
    stop: 1e4,
    shotTop: -1,
    shotLeft: 0,
    shotW: 1,
    shotH: 1,
  };
  // The last spectrum laid on the window (shine), cleared when the layout moves.
  let lastFan = "";

  // The room's layer may sit higher than the hero (Scene.astro lifts it, --lift): the box is
  // placed in the hero's coordinates, the light in the layer's.
  const placeBox = () => {
    const c = layer.getBoundingClientRect();
    const h = hero.getBoundingClientRect();
    const pl = narrow.matches ? places.narrow : places.wide;
    // The page zooms the frame on phones (--z), so the sun clears the words above it.
    const zoom = parseFloat(getComputedStyle(layer).getPropertyValue("--z")) || 1;
    const fit = cover(Math.max(1, c.width), Math.max(1, c.height), pl, zoom);
    box.style.left = `${(fit.box.x + c.left - h.left).toFixed(1)}px`;
    box.style.top = `${(fit.box.y + c.top - h.top).toFixed(1)}px`;
    box.style.width = `${fit.box.w.toFixed(1)}px`;
    return { pl, fit };
  };
  const unplace = () => {
    box.style.removeProperty("left");
    box.style.removeProperty("top");
    box.style.removeProperty("width");
  };

  const measure = () => {
    // The light is drawn in the canvas's coordinates: everything is measured against it.
    const c = canvas.getBoundingClientRect();
    L.w = Math.max(1, c.width);
    L.h = Math.max(1, c.height);
    L.scale = Math.min(devicePixelRatio || 1, S.quality);
    const cw = Math.round(L.w * L.scale);
    const ch = Math.round(L.h * L.scale);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const placed = placeBox();
    S.place = placed.pl;
    L.fx = placed.fit.ox;
    L.fy = placed.fit.oy;
    L.fs = placed.fit.s;
    L.k = placed.fit.k;
    L.ox = placed.fit.box.x - MARK_BOX.x * L.k;
    L.oy = placed.fit.box.y - MARK_BOX.y * L.k;
    const view = hwin?.getBoundingClientRect();
    if (view && view.width > 0) {
      S.shotTop = view.top - c.top;
      S.shotLeft = view.left - c.left;
      S.shotW = view.width;
      S.shotH = view.height;
      lastFan = "";
      // Aimed at the centre of the part of the window in view: on a phone the window is wider
      // than the screen and runs off its right edge, so its own centre would pull the spectrum
      // off screen.
      const seen = Math.min(view.right, innerWidth) - Math.max(view.left, 0);
      const midX = Math.max(view.left, 0) + (seen > 0 ? seen : view.width) / 2 - c.left;
      const tx = (midX - L.ox) / L.k - FAN.apex[0];
      const ty = (S.shotTop + S.shotH / 2 - L.oy) / L.k - FAN.apex[1];
      const len = Math.hypot(tx, ty) || 1;
      S.fanDir = [tx / len, ty / len];
      S.stop = (S.shotTop - L.oy) / L.k;
      // the frame's own corner radius, so the light it takes in follows its rounded border
      const win = hwin?.querySelector(".ap__win");
      if (win && hwin) hwin.style.setProperty("--win-r", getComputedStyle(win).borderTopLeftRadius);
    } else S.shotTop = -1;
  };

  // The spectrum on the app's window: where it crosses the top edge, laid out as gradients the
  // window draws (components/home/HeroWindow: the edge, the point the frame takes the colors in
  // from), and how strong it is there.
  const shine = (strength: number, turn: number) => {
    if (!hwin || S.shotTop < 0) return;
    const y = (S.shotTop - L.oy) / L.k;
    const { red, violet } = fanAt(y, turn, S.fanDir);
    const xr = L.ox + red * L.k - S.shotLeft;
    const xv = L.ox + violet * L.k - S.shotLeft;
    const key = `${xr.toFixed(1)} ${xv.toFixed(1)} ${strength.toFixed(3)}`;
    if (key === lastFan) return;
    lastFan = key;
    // Red to violet in the order they lie, left to right.
    const lo = Math.min(xr, xv);
    const hi = Math.max(xr, xv);
    const colors = [1, 2, 3, 4, 5, 6].map((i) => `var(--spec-${i})`);
    if (xr > xv) colors.reverse();
    const stops = (to: (x: number) => number, fade: number) => {
      const at = (x: number) => `${to(x).toFixed(2)}%`;
      const mid = colors.map((c, i) => `${c} ${at(lo + ((hi - lo) * i) / 5)}`);
      return [`transparent ${at(lo - fade)}`, ...mid, `transparent ${at(hi + fade)}`].join(", ");
    };
    const edge = (x: number) => (x / S.shotW) * 100;
    hwin.style.setProperty("--fan", `linear-gradient(90deg, ${stops(edge, 4)})`);
    hwin.style.setProperty("--fc", `${edge((lo + hi) / 2).toFixed(2)}%`);
    hwin.style.setProperty("--sl", strength.toFixed(3));
  };

  // Scroll: the stroke opens, the room goes dark, the stone turns Paper (HERO_LEAD), and once
  // the scene has taken the mark (just past it) the hero's own copy goes dark under it. The
  // opening lags the scroll a little (`eased`), so the sides move like something with weight;
  // the dark and the Paper follow the scroll as it is, so the hand-over lands on the pixel.
  const scrolled = { open: 0, eased: 0, out: 0, paper: 0 };
  // Past the lead the room is dark and the scene has the mark: the layer steps out entirely
  // (it is sticky for the whole scene and would otherwise ride over what follows it).
  let away = false;
  const read = (p: number) => {
    scrolled.open = beat("open", p);
    scrolled.out = beat("dark", p);
    scrolled.paper = beat("paper", p) * (1 - smooth(HERO_LEAD, HERO_LEAD + 0.004, p));
    const past = p >= HERO_LEAD + 0.006;
    if (past !== away) {
      away = past;
      layer.classList.toggle("is-gone", past);
    }
  };
  const st = scene
    ? ScrollTrigger.create({
        trigger: scene,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => read(self.progress),
        onRefresh: (self) => {
          read(self.progress);
          measure();
        },
      })
    : null;
  if (st) read(st.progress);
  /** A tick's worth of the opening's lag (snapping shut once the room is out). */
  const settle = (dt: number) => {
    const a = 1 - Math.exp(-dt / 130);
    scrolled.eased += (scrolled.open - scrolled.eased) * a;
    if (Math.abs(scrolled.open - scrolled.eased) < 0.0006 || scrolled.out >= 1)
      scrolled.eased = scrolled.open;
  };

  const kill = () => {
    st?.kill();
    layer.classList.remove("is-gone");
    unplace();
  };
  return { L, S, placeBox, unplace, measure, shine, scrolled, settle, kill };
}

/** The look: one state the intro tweens and every frame reads. The intro plays on a first visit
 *  on a GPU: the room comes up with the mark standing, which folds into one stroke, and the light
 *  runs out of its foot; otherwise it fades in on the folded stroke. */
export function createLook(play: boolean) {
  const look = { expo: 0, part: 0, reach: 0 };
  const intro = gsap.timeline({ paused: true });
  if (play) {
    look.part = 1;
    intro
      .to(look, { expo: 1, duration: 1.0, ease: ease.out }, 0)
      .to(look, { part: 0, duration: 1.5, ease: ease.inOut }, 0.45)
      .to(look, { reach: 1, duration: 1.3, ease: ease.inOut }, 1.4);
  } else {
    look.reach = 1;
    intro.to(look, { expo: 1, duration: 0.7, ease: ease.out }, 0);
  }
  return { look, intro };
}

/** The pointer, eased, as -1..1 across the screen (none on touch). */
export function createPointer() {
  const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
  const touch = isTouch();
  const move = (e: PointerEvent) => {
    ptr.tx = (e.clientX / innerWidth) * 2 - 1;
    ptr.ty = (e.clientY / innerHeight) * 2 - 1;
  };
  if (!touch) addEventListener("pointermove", move, { passive: true });
  const settle = () => {
    ptr.x += (ptr.tx - ptr.x) * 0.045;
    ptr.y += (ptr.ty - ptr.y) * 0.045;
    return Math.abs(ptr.tx - ptr.x) + Math.abs(ptr.ty - ptr.y) > 0.002;
  };
  /** The spectrum's turn: the pointer turns it across Home's tabs; at rest it drifts, slowly. */
  const turnAt = (time: number, out: number) =>
    (ptr.x * FAN_TURN.pointer + Math.sin(time * 0.13) * FAN_TURN.idle) * (1 - out);
  const kill = () => removeEventListener("pointermove", move);
  return { ptr, settle, turnAt, kill };
}
