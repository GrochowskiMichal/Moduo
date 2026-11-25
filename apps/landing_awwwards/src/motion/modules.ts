// Six modules, one window (components/home/ModulesIndex.astro, DESIGN.md §21): one held stage,
// one scroll, continuing the scene above it.
//
//   take    the scene's stage lets go at its last frame; it's held where it is while the six
//           strokes it drew are laid over it to the pixel (motion/interlock.ts lastChain), then
//           its words and the ribbon fade and the six are ours
//   land    the title (six kinds of work, spread over ten apps) comes in where the scene's last
//           line stood; the six strokes glide down into
//           the title bar of one window, which opens out of them; the first stroke stays lit
//   pass    the modules come through the window one at a time: each swept in behind a 45° edge
//           that wipes the last, its picture playing its moment, its stroke lit in the bar, its
//           words at the stage's foot with the apps it replaces struck out, the bar counting
//           them up to ten
//   answer  six modules, one window, and the keys that reach every module: all six lit
//
// The story is timed in beats q, one per 100svh of scroll (the section is 750svh and starts a
// screen early, under the scene's last frame). Under reduced motion none of this runs: the
// section is a list.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { ease, onPage, prefersReducedMotion } from "../engine";
import { STROKE, STROKE_H } from "../lib/stroke";
import { lastChain } from "./interlock";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, p: number) => {
  const t = clamp01((p - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const OFF = STROKE.offset;

export function startModules() {
  onPage(() => {
    const root = document.querySelector<HTMLElement>("[data-mods]");
    if (!root || prefersReducedMotion() || !document.documentElement.classList.contains("motion"))
      return;
    const stage = root.querySelector<HTMLElement>("[data-mods-stage]")!;
    const scene = document.querySelector<HTMLElement>("[data-scene]");
    const sceneStage = scene?.querySelector<HTMLElement>("[data-stage]") ?? null;
    const canvas = scene?.querySelector<HTMLCanvasElement>("[data-canvas]") ?? null;
    const head = root.querySelector<HTMLElement>("[data-mods-head]")!;
    const title = head.querySelector<HTMLElement>(".mods__title")!;
    const win = root.querySelector<HTMLElement>("[data-mods-win]")!;
    const slot = root.querySelector<HTMLElement>("[data-mods-slot]")!;
    const where = root.querySelector<HTMLElement>("[data-mods-where]")!;
    const items = [...root.querySelectorAll<HTMLElement>("[data-mods-item]")];
    const caps = items.map((el) => el.querySelector<HTMLElement>("[data-mods-cap]")!);
    const panes = items.map((el) => el.querySelector<HTMLElement>("[data-mods-pane]")!);
    // The apps each module takes over, counted up to ten as they come through.
    const took = items.map((el) => el.querySelectorAll(".mods__was s").length);
    const chain = root.querySelector<SVGSVGElement>("[data-mods-chain]")!;
    const strokes = [...chain.querySelectorAll<SVGPathElement>("[data-mods-s]")];
    const clips = [...chain.querySelectorAll<SVGPathElement>("[data-mods-clip]")];
    const wins = [...chain.querySelectorAll<SVGPathElement>("[data-mods-w]")];
    const edges = [...chain.querySelectorAll<SVGPathElement>("[data-mods-edge]")];
    const N = strokes.length;
    const M = items.length; // the six, then the keys
    const fg =
      getComputedStyle(document.documentElement).getPropertyValue("--c-fg").trim() || "#fafafa";
    const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const [on, off] = [hex(fg.length === 7 ? fg : "#fafafa"), hex("#333333")];

    // Each module comes in at E[j]: the first as the window opens, the rest three quarters of a
    // beat apart; the answer and the keys hold for a beat at the end.
    const BEAT = 0.75;
    const E = Array.from({ length: M + 1 }, (_, j) => (j === 0 ? 0.92 : 1 + j * BEAT));
    const U = E[M - 1] + 1;

    // ── Where the chain starts (the scene's last frame) and where it lands (the bar). ──
    let W = 0;
    let H = 0;
    let land = { x: 0, y: 0, s: 1 };
    const measure = () => {
      const r = stage.getBoundingClientRect();
      W = r.width;
      H = r.height;
      chain.setAttribute("viewBox", `0 0 ${W.toFixed(1)} ${H.toFixed(1)}`);
      const b = slot.getBoundingClientRect();
      const s = b.height / STROKE_H;
      land = { x: b.left - r.left, y: b.top - r.top - STROKE.top * s, s };
      shots.forEach((sh) => sh.measure());
    };
    /** The scene's chain on screen now: each stroke's left edge, its top, and its scale. */
    const taken = () => {
      // Only the scene's last frame hands over (a jump straight past it finds the chain in the bar).
      if (!canvas || !lastChain.k || lastChain.p < 0.99 || lastChain.xs.length < N) return null;
      const c = canvas.getBoundingClientRect();
      const k = lastChain.k;
      return {
        xs: lastChain.xs.map((x) => c.left + (x - lastChain.vx) * k),
        edges: lastChain.edges.map((x) => c.left + (x - lastChain.vx) * k),
        y: c.top - lastChain.vy * k,
        s: k,
      };
    };
    let from: ReturnType<typeof taken> = null;

    // A band between two 45° lines, x + y = lo and x + y = hi, in a pane's pixels.
    const band = (lo: number, hi: number) =>
      `polygon(${lo + 4000}px -4000px, ${hi + 4000}px -4000px, ${hi - 4000}px 4000px, ${lo - 4000}px 4000px)`;

    let shown = -1;
    let held = false;
    const draw = (p: number) => {
      const q = p * U;

      // ── Take: hold the scene's last frame, ours over it, then let it fade. ──
      const hold = q > 0 && q < U;
      if (hold !== held && scene) {
        held = hold;
        scene.classList.toggle("is-held", hold);
      }
      if (q < 0.3) from = taken();
      const fade = smooth(0.02, 0.18, q);
      if (sceneStage) {
        sceneStage.style.opacity = (1 - fade).toFixed(3);
        sceneStage.style.visibility = fade >= 1 ? "hidden" : "";
      }
      chain.style.visibility = q > 0 ? "visible" : "hidden";

      // ── The chain: from the scene's pixels down into the bar, log scale, the strokes closing
      // to the mark's offset as they go. ──
      const f = smooth(0.26, 0.78, q);
      const s0 = from?.s ?? land.s;
      const s = Math.exp(lerp(Math.log(s0), Math.log(land.s), f));
      const g = Math.abs(s0 - land.s) < 1e-6 ? f : (s0 - s) / (s0 - land.s);
      const y = lerp(from?.y ?? land.y, land.y, g);
      const lit = (i: number) => {
        // Every stroke is lit as the chain arrives, all but the first dim as the window opens,
        // then the one whose module is in the window; with the keys, all six again.
        let b = 1 - smooth(0.62, 0.86, q);
        for (let j = 0; j < M; j++) {
          const a =
            smooth(E[j] - 0.08, E[j] + 0.04, q) * (1 - smooth(E[j + 1] - 0.08, E[j + 1] + 0.04, q));
          if (j === i || j === N) b = Math.max(b, a);
        }
        return b;
      };
      // The ribbon's windows in the chain's two ends, where the scene left them, closing as it goes.
      edges.forEach((e, n) => {
        const ex = from?.edges[n];
        e.style.visibility = ex === undefined || fade >= 1 ? "hidden" : "visible";
        if (ex !== undefined)
          e.setAttribute(
            "transform",
            `translate(${ex.toFixed(2)} ${(from?.y ?? 0).toFixed(2)}) scale(${(from?.s ?? 1).toFixed(5)})`,
          );
        e.style.opacity = (1 - fade).toFixed(3);
      });
      for (let i = 0; i < N; i++) {
        const x = lerp(from?.xs[i] ?? land.x + i * OFF * land.s, land.x + i * OFF * land.s, g);
        const tr = `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${s.toFixed(5)})`;
        strokes[i].setAttribute("transform", tr);
        clips[i].setAttribute("transform", tr);
        if (i < N - 1) wins[i].setAttribute("transform", tr);
        const b = lit(i);
        strokes[i].style.fill =
          `rgb(${off.map((v, c) => Math.round(lerp(v, on[c], b))).join(",")})`;
      }

      // ── The title takes the place of the scene's last line; the window opens out of its bar. ──
      title.style.opacity = smooth(0.2, 0.32, q).toFixed(3);
      const open = smooth(0.5, 0.9, q);
      win.style.opacity = smooth(0.46, 0.6, q).toFixed(3);
      win.style.clipPath = `inset(0 0 ${((1 - open) * 100).toFixed(2)}% 0 round var(--r-xl))`;

      // ── The modules through the window: each pane swept in behind a 45° edge that wipes the last.
      let now = -1;
      panes.forEach((pane, j) => {
        const pw = pane.offsetWidth;
        const ph = pane.offsetHeight;
        const span = pw + ph + 40;
        const front = smooth(E[j] - 0.12, E[j] + 0.1, q);
        const back = j + 1 < M ? smooth(E[j + 1] - 0.12, E[j + 1] + 0.1, q) : 0;
        const vis = front > 0 && back < 1;
        pane.style.visibility = vis ? "visible" : "hidden";
        if (vis) pane.style.clipPath = band(lerp(-20, span, back), lerp(-20, span, front));
        const a =
          smooth(E[j] - 0.02, E[j] + 0.06, q) *
          (j + 1 < M ? 1 - smooth(E[j + 1] - 0.08, E[j + 1], q) : 1);
        caps[j].style.opacity = a.toFixed(3);
        // Its apps are struck out just after it arrives.
        caps[j].style.setProperty("--strike", smooth(E[j] + 0.06, E[j] + 0.22, q).toFixed(3));
        caps[j].style.visibility = a > 0.01 ? "visible" : "hidden";
        if (q >= E[j] - 0.05) now = j;
      });
      // The camera closes in on each module's gesture once it's in the window, and its moment
      // plays when the camera gets there; scrolled back before it, the moment waits again.
      shots.forEach((sh, j) => {
        const z = smooth(E[j] + 0.1, E[j] + 0.34, q);
        sh.camera(z);
        if (z > 0.92 && !sh.played) {
          sh.played = true;
          sh.tl.restart();
        } else if (z < 0.05 && sh.played) {
          sh.played = false;
          sh.tl.pause(0);
        }
      });
      if (now !== shown) {
        // The keys' palette types its query as it comes in.
        if (now > shown && now === M - 1)
          panes[now].querySelector("[data-mini]")?.dispatchEvent(new Event("bento:play"));
        shown = now;
        const n = took.slice(0, Math.max(1, now + 1)).reduce((a, b) => a + b, 0);
        where.textContent = `${n} of 10 apps`;
      }
    };

    const shots = panes.map((pane) => shot(pane));

    const st = ScrollTrigger.create({
      trigger: root,
      start: "top top",
      end: "bottom bottom",
      scrub: true,
      invalidateOnRefresh: true,
      onRefresh: (self) => {
        measure();
        draw(self.progress);
      },
      onUpdate: (self) => draw(self.progress),
    });
    measure();
    draw(st.progress);

    return () => {
      st.kill();
      scene?.classList.remove("is-held");
      sceneStage?.removeAttribute("style");
      shots.forEach((sh) => sh.kill());
      [title, win, chain, ...caps, ...panes, ...strokes, ...edges].forEach((el) =>
        el.removeAttribute("style"),
      );
    };
  });
}

// ── Each module's shot: where the camera closes in, and the moment it plays there. ──────────

type Moment = {
  /** What the camera closes in on, and how close it comes (the app's scale). */
  focus: string;
  zoom: number;
  /** What the gesture presses (its key comes up over it, or under it where over would hide
   *  what the press changes). */
  press?: string;
  under?: boolean;
  /** What the app does, after the press. */
  after?: (tl: gsap.core.Timeline, pane: HTMLElement, fx: HTMLElement) => void;
};

const $ = (el: ParentNode, s: string) => el.querySelector<HTMLElement>(s);

/** A small chip the app shows where a control was, in the pane's own layer. */
function chip(fx: HTMLElement, pane: HTMLElement, over: HTMLElement | null, text: string) {
  const el = document.createElement("span");
  el.className = "mods__made";
  el.textContent = text;
  fx.append(el);
  const place = () => {
    if (!over) return;
    const p = pane.getBoundingClientRect();
    const r = over.getBoundingClientRect();
    el.style.left = `${(r.left - p.left).toFixed(1)}px`;
    el.style.top = `${(r.top - p.top + r.height / 2).toFixed(1)}px`;
  };
  return { el, place };
}

const MOMENTS: Record<string, Moment> = {
  // T on the open email: it becomes a task, the email attached.
  email: { focus: ".ef-acts", zoom: 1.85, press: ".ef-totask" },
  // ⏎ on the focus card: the task is done, its minutes kept.
  tasks: {
    focus: ".tf-card",
    zoom: 1.6,
    press: ".tf-actions .ap-btn--primary",
    under: true,
    after(tl, pane) {
      const title = $(pane, ".tf-title");
      if (title) {
        tl.fromTo(title, { opacity: 1 }, { opacity: 0.4, duration: 0.4, ease: ease.out }, 0.75);
        tl.fromTo(
          title,
          { backgroundSize: "0% 2px" },
          { backgroundSize: "100% 2px", duration: 0.45, ease: ease.inOut },
          0.7,
        );
      }
    },
  },
  // ⌘⇧T on the line just typed: it becomes a task, linked to the note.
  notes: {
    focus: ".nf-task.is-plain",
    zoom: 1.6,
    press: ".nf-make",
    after(tl, pane, fx) {
      const make = $(pane, ".nf-make");
      const made = chip(fx, pane, make, "Task");
      tl.call(made.place, [], 0.7);
      tl.fromTo(make, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.2 }, 0.72);
      tl.fromTo(
        made.el,
        { autoAlpha: 0, x: -6 },
        { autoAlpha: 1, x: 0, duration: 0.35, ease: ease.out },
        0.8,
      );
    },
  },
  // Maciej takes Thursday 14:00: the review lands in the week.
  calendar: {
    focus: '[data-t="Invite review"]',
    zoom: 1.3,
    after(tl, pane) {
      const block = $(pane, '[data-t="Invite review"]');
      if (block)
        tl.fromTo(
          block,
          { autoAlpha: 0, y: -18, scale: 0.94 },
          { autoAlpha: 1, y: 0, scale: 1, duration: 0.7, ease: ease.out },
          0.25,
        );
    },
  },
  // Link on the suggestion: the contact joins the project.
  contacts: {
    focus: ".cf-suggest",
    zoom: 1.6,
    press: ".cf-suggest .ap-btn--primary",
    after(tl, pane, fx) {
      const bar = $(pane, ".cf-suggest");
      const made = chip(fx, pane, bar, "Linked to Open alpha");
      tl.call(made.place, [], 0.7);
      tl.fromTo(
        bar,
        { autoAlpha: 1, scaleY: 1 },
        { autoAlpha: 0, scaleY: 0.7, duration: 0.3, ease: "power2.in" },
        0.72,
      );
      tl.fromTo(
        made.el,
        { autoAlpha: 0, y: 4 },
        { autoAlpha: 1, y: 0, duration: 0.4, ease: ease.out },
        0.95,
      );
    },
  },
  // The thread is wrapped up and the answer flagged as the decision.
  chat: {
    focus: ".chf-stream",
    zoom: 1.3,
    after(tl, pane) {
      const parts = [".chf-wrapped", ".chf-decision", ".chf-reacts"]
        .map((s) => $(pane, s))
        .filter(Boolean);
      tl.fromTo(
        parts,
        { autoAlpha: 0, y: 6 },
        { autoAlpha: 1, y: 0, duration: 0.45, ease: ease.out, stagger: 0.35 },
        0.3,
      );
    },
  },
};

function shot(pane: HTMLElement) {
  const cam = $(pane, "[data-mods-cam]");
  const fx = $(pane, ".mods__fx");
  const m = MOMENTS[pane.dataset.modsPane ?? ""];
  const tl = gsap.timeline({ paused: true });
  let view = { s: 1, x: 0, y: 0 };
  let made: HTMLElement[] = [];
  const kill = () => {
    tl.kill();
    made.forEach((el) => el.remove());
    if (cam) cam.style.transform = "";
  };
  if (!cam || !fx || !m) return { tl, played: false, measure() {}, camera() {}, kill };

  const key = $(fx, "[data-mods-key]");
  const toast = $(fx, "[data-mods-toast]");
  const press = m.press ? $(pane, m.press) : null;
  // The key comes up over the control it presses, goes down, and leaves once the app has spoken.
  const placeKey = () => {
    if (!key || !press) return;
    const p = pane.getBoundingClientRect();
    const r = press.getBoundingClientRect();
    // A control the narrow layout hides has no key to show.
    key.style.display = r.width ? "" : "none";
    const x = Math.min(
      p.width - key.offsetWidth - 12,
      Math.max(12, r.right - p.left - key.offsetWidth * 0.35),
    );
    const y = m.under
      ? Math.min(p.height - key.offsetHeight - 12, r.bottom - p.top + 14)
      : Math.max(12, r.top - p.top - key.offsetHeight - 14);
    gsap.set(key, { left: x, top: y });
  };
  if (key && press) {
    tl.call(placeKey, [], 0);
    tl.fromTo(
      key,
      { autoAlpha: 0, y: 12 },
      { autoAlpha: 1, y: 0, duration: 0.4, ease: ease.out },
      0,
    );
    tl.to(key, { y: 4, duration: 0.1, ease: "power1.in", yoyo: true, repeat: 1 }, 0.55);
    tl.to(press, { scale: 0.94, duration: 0.1, ease: "power1.in", yoyo: true, repeat: 1 }, 0.55);
    tl.to(key, { autoAlpha: 0, y: -6, duration: 0.4, ease: ease.out }, 2.1);
  }
  const before = fx.childElementCount;
  m.after?.(tl, pane, fx);
  made = [...fx.children].slice(before) as HTMLElement[];
  if (toast)
    tl.fromTo(
      toast,
      { autoAlpha: 0, y: 14 },
      { autoAlpha: 1, y: 0, duration: 0.5, ease: ease.out },
      1,
    );
  tl.progress(0).pause();

  return {
    tl,
    played: false,
    measure() {
      const target = $(pane, m.focus);
      cam.style.transform = "";
      const pw = pane.clientWidth;
      const ph = pane.clientHeight;
      const c = cam.getBoundingClientRect();
      const r = target?.getBoundingClientRect();
      // A gesture the narrow layout hides keeps the whole app in the frame.
      if (!r || !r.width || !c.width) {
        view = { s: 1, x: 0, y: 0 };
        return;
      }
      // A phone's app is one column with its type already a size up: the camera only pans to it.
      const s = pw < 640 ? 1 : m.zoom;
      const cx = r.left - c.left + r.width / 2;
      const cy = r.top - c.top + r.height / 2;
      const x = Math.min(0, Math.max(pw - c.width * s, pw / 2 - cx * s));
      const y = Math.min(0, Math.max(ph - Math.max(ph, c.height) * s, ph / 2 - cy * s));
      view = { s, x, y };
    },
    camera(z: number) {
      const s = lerp(1, view.s, z);
      cam.style.transform = `translate(${(view.x * z).toFixed(1)}px, ${(view.y * z).toFixed(1)}px) scale(${s.toFixed(4)})`;
    },
    kill,
  };
}
