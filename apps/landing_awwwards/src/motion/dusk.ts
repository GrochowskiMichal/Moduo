// Dusk, the home hero's driver (components/home/Dusk.astro, lib/dusk.ts). One variable, the
// hero's share of the scene's scroll (p, 0 → 1), drives everything that carries the story:
//
//   the plate      "Waves" (lib/waves.ts), flowing at rest, parallaxed a hair by the camera; the
//                  morning's light (dayAt) still lights the window's rim (--sun)
//   the camera     glides between keyframes, one or two a chapter, each framing the part of Home
//                  the chapter is about; it follows the scroll with a little weight (a lerp on the
//                  ticker) and leans a hair toward the pointer
//   the stages     one gesture is one chapter: a wheel push, a swipe or a key glides to the next
//                  chapter's rest, so a big scroll can't skip any (motion/dusk-steps.ts)
//   the words      a chapter's words rise as it starts and leave the way the story moves; the
//                  opening is delivered at reading pace; the hour under each chapter rolls
//                  (motion/dusk-words.ts)
//   the window     the chapter's widget comes forward, the rest step back; a beat plays as each
//                  keyframe is reached (Maciej's email arrives, his card opens, T makes the task,
//                  she takes a slot, the team answers), time-based, so it reads at any scroll
//                  speed; going back sets the states at once
//   the rim        takes the sunrise (--sun), and the breath stills, as the scene (motion/
//                  interlock.ts) takes the mark from the window's bar on the same pixels: the
//                  box [data-light-mark] is placed where that mark stands at the final pose
//
// One clock: the GSAP ticker. Under reduced motion nothing moves: the chapter row is a set of
// tabs that swap the words, the window's state and one still of the waves at once. The waves
// need WebGL; without it the plate's CSS stand-in stays.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { ease, isTouch, isWebKit, onPage, prefersReducedMotion } from "../engine";
import {
  allPose,
  blendAt,
  chapterAt,
  chapterRest,
  CHAPTERS,
  chapterStart,
  dayAt,
  framePose,
  lerpPose,
  NARROW,
  type Pose,
  type Rect,
  restPose,
  SKY_VERT,
  smooth,
  sunAt,
  union,
} from "../lib/dusk";
import { HERO_LEAD } from "../lib/scene";
import { WAVES, WAVES_FRAG, wavesColors } from "../lib/waves";
import { startSteps } from "./dusk-steps";
import { makeWords } from "./dusk-words";

gsap.registerPlugin(ScrollTrigger);

/** How the window leans at rest. */
const LEAN = { rx: 7, ry: -14 };
/** The widget each chapter is about (first: lit; the rest step back when any is named). */
const FOCUS: readonly (readonly string[])[] = [
  [],
  ["mail"],
  ["mail"],
  ["tasks", "mail"],
  ["cal"],
  ["chat"],
  [],
];
/** The mark's artwork inside its svg box: height-limited, centred (lib/brand.ts MARK.tight). */
const MARK_ASPECT = 720 / 545.8;

export function startDusk() {
  onPage(({ intro, firstLoad }) => {
    const hero = document.querySelector<HTMLElement>("[data-dusk]");
    if (!hero) return;
    const reduce = prefersReducedMotion();
    const dk = hero.querySelector<HTMLElement>("[data-dk]")!;
    const plate = hero.querySelector<HTMLElement>("[data-plate]")!;
    const cam = hero.querySelector<HTMLElement>("[data-cam]")!;
    const float = hero.querySelector<HTMLElement>("[data-float]")!;
    const canvas = hero.querySelector<HTMLCanvasElement>("[data-sky]")!;
    const chs = [...hero.querySelectorAll<HTMLElement>("[data-ch]")];
    const steps = [...hero.querySelectorAll<HTMLButtonElement>("[data-go]")];
    const count = hero.querySelector<HTMLElement>("[data-count]")!;
    const markBox = hero.querySelector<HTMLElement>("[data-light-mark]")!;
    const barMark = hero.querySelector<SVGSVGElement>(".ap__mark")!;
    const widgets = new Map(
      [...dk.querySelectorAll<HTMLElement>("[data-w]")].map((w) => [w.dataset.w!, w]),
    );
    const $ = <T extends HTMLElement = HTMLElement>(q: string) => dk.querySelector<T>(q)!;
    const prop = (name: string) => $(`[data-prop="${name}"]`);
    const fly = prop("fly");
    const keyset = prop("keyset");
    const key = prop("key");
    const cur = prop("cur");
    const card = prop("card");
    const acur = prop("acur");
    const annaRow = $("[data-anna]");
    const who = $("[data-who]");
    const newn = $("[data-newn]");
    const ring = $<HTMLElement>("[data-ring]");
    const ringN = $("[data-ringn]");
    const born = $("[data-born]");
    const offers = [1, 2, 3].map((n) => $(`[data-offer="${n}"]`));
    const narrow = matchMedia(NARROW);
    const touch = isTouch();
    // Safari (WebKit): the camera's layer stays 3D throughout, and the words rise without blur.
    // Its compositor rebuilt the window's layer each time the transform dropped to 2D and back
    // (every chapter, and on every frame the breath crossed flat during a glide), and an
    // animated blur over text re-rendered the words each frame: both flickered.
    const webkit = isWebKit();
    hero.classList.toggle("is-webkit", webkit);
    const playIntro =
      firstLoad && !reduce && !!(window as Window & { __mIntro?: boolean }).__mIntro;
    const words = reduce ? null : makeWords(chs, !narrow.matches && !touch && !webkit);
    // On a first visit the words wait for the window to stand up (the intro, below).
    let wordsOn = !playIntro;
    let stages: ReturnType<typeof startSteps> | null = null;
    /** The words show the chapter on screen, or on a step the chapter it is headed for (they
     *  lead, the camera follows), so a glide past several chapters never flashes the ones
     *  between. */
    const showWords = () => {
      const head = stages?.heading() ?? -1;
      if (wordsOn) words?.show(head >= 0 ? head : chapter);
    };
    const sky = makeSky(canvas, plate);

    // ── Layout: everything the camera needs, measured on refresh, never per frame. ──
    /** Offsets up to `anc`, which ignore transforms: the window's own pixels. */
    const rectIn = (el: HTMLElement, anc: HTMLElement): Rect => {
      let x = 0;
      let y = 0;
      let e: HTMLElement | null = el;
      while (e && e !== anc) {
        x += e.offsetLeft;
        y += e.offsetTop;
        e = e.offsetParent as HTMLElement | null;
      }
      return { x, y, w: el.offsetWidth, h: el.offsetHeight };
    };
    const P = { w: 1, h: 1 };
    /** How much larger than seen the window is laid out (Dusk.astro --k). */
    let K = 1;
    const W = { left: 0, top: 0, w: 1, h: 1 };
    // The dashboard inside the camera's box (the window's rim and bar sit above it).
    let dkAt: Rect = { x: 0, y: 0, w: 1, h: 1 };
    let cardAt: Rect = { x: 0, y: 0, w: 1, h: 1 };
    /** Where the contact card opens, in the board's pixels: under Maciej's row (its chips open),
     *  lined up with her name, so it never covers the row it came from. */
    const cardPos = { x: 0, y: 0 };
    let markAt: Rect = { x: 0, y: 0, w: 1, h: 1 };
    const inCam = (el: HTMLElement): Rect => {
      const r = rectIn(el, dk);
      return { x: r.x + dkAt.x, y: r.y + dkAt.y, w: r.w, h: r.h };
    };
    // Keyframes: where each sits in the hero's progress and what it frames.
    type Spec = null | "all" | (() => Rect[]);
    const KEYS: { at: number; spec: Spec }[] = [
      { at: chapterStart(0), spec: null },
      { at: chapterStart(1), spec: () => [inCam($(".dk-mail .dk-wh")), inCam($('[data-m="3"]'))] },
      { at: chapterStart(2), spec: () => [inCam($(".dk-mail .dk-wh")), inCam(annaRow), cardAt] },
      { at: chapterStart(3), spec: () => [inCam($(".dk-mail .dk-wh")), inCam(annaRow)] },
      { at: chapterStart(3) + 0.5 / CHAPTERS, spec: () => [inCam(widgets.get("tasks")!)] },
      // The whole day with its date on a wide plate; a phone's tall plate would shrink a whole
      // day past reading, so it frames the afternoon the slots are in.
      {
        at: chapterStart(4),
        spec: () => {
          const cal = inCam(widgets.get("cal")!);
          if (!narrow.matches) return [cal];
          // The afternoon, across the widget's full width, so the hour labels stay in frame.
          const day = union([inCam($('[data-ev="review"]')), inCam(offers[2])]);
          return [{ x: cal.x, y: day.y, w: cal.w, h: day.h }];
        },
      },
      { at: chapterStart(5), spec: () => [inCam($(".dk-chat .dk-wh")), inCam($(".dk-composer"))] },
      { at: chapterStart(6), spec: "all" },
    ];
    const ATS = KEYS.map((k) => k.at);
    let poses: Pose[] = [];
    const poseFor = (spec: Spec): Pose => {
      if (!spec) return restPose(P, W, LEAN);
      if (spec === "all") return allPose(P, W, narrow.matches ? 0.03 : 0.04);
      // The closest a close-up comes, as seen (the layout is --k times the size it is seen at).
      return framePose(union(spec()), P, W, (narrow.matches ? 2.6 : 2.1) / K);
    };
    const placeCard = () => gsap.set(card, cardPos);
    /** The story's states change the board's layout (Maciej's row arrives, his chips open, a
     *  message lands), so every keyframe is measured as the story ends: all states on, with no
     *  transitions, then the board is put back exactly as it was in the same frame. */
    const DONE = [
      "m-new",
      "c-id",
      "t-key",
      "t-made",
      "offers",
      "booked",
      "c-you",
      "c-typing",
      "c-sent",
      "reacted",
    ];
    const asDone = <T>(fn: () => T): T => {
      const was = dk.className;
      dk.classList.add("is-measure", ...DONE);
      void dk.offsetHeight;
      const out = fn();
      dk.className = was;
      dk.classList.add("is-measure");
      void dk.offsetHeight;
      dk.classList.remove("is-measure");
      return out;
    };
    const measure = () => {
      K = parseFloat(getComputedStyle(plate).getPropertyValue("--k")) || 1;
      P.w = plate.clientWidth;
      P.h = plate.clientHeight;
      W.left = cam.offsetLeft;
      W.top = cam.offsetTop;
      W.w = cam.offsetWidth;
      W.h = cam.offsetHeight;
      dkAt = rectIn(dk, cam);
      // The mark in the bar (an svg, which has no offsets): measured with the camera at rest,
      // and the float too (on a first visit the intro has it 70 px low and tipped back, which
      // put the scene's mark a bar's height under the window's own).
      const saved = cam.style.transform;
      const savedFloat = float.style.transform;
      cam.style.transform = "none";
      float.style.transform = "none";
      const c = cam.getBoundingClientRect();
      const m = barMark.getBoundingClientRect();
      cam.style.transform = saved;
      float.style.transform = savedFloat;
      const artH = m.height;
      const artW = artH * MARK_ASPECT;
      markAt = { x: m.left - c.left + (m.width - artW) / 2, y: m.top - c.top, w: artW, h: artH };
      poses = asDone(() => {
        const row = rectIn(annaRow, dk);
        const a = rectIn(who, dk);
        // The card's edge on the row's own (its avatar column), so no cut word of the rows
        // under it shows at its left; its arrow on her name.
        cardPos.x = row.x;
        card.style.setProperty("--arrow", `${Math.round(a.x - row.x + Math.min(a.w * 0.3, 28))}px`);
        cardPos.y = row.y + row.h + Math.round(row.h * 0.06);
        cardAt = {
          x: cardPos.x + dkAt.x,
          y: cardPos.y + dkAt.y,
          w: card.offsetWidth,
          h: card.offsetHeight,
        };
        return KEYS.map((k) => poseFor(k.spec));
      });
      placeCard();
      // The room Maciej's email takes in the list, as it lands (without his chips): the list
      // glides down by it (dusk/InboxWidget.astro), a transform, not a layout move.
      {
        const was = dk.className;
        dk.classList.add("is-measure", "m-new");
        dk.classList.remove("c-id", "t-key");
        const h = annaRow.offsetHeight;
        dk.className = was;
        dk.classList.add("is-measure");
        void dk.offsetHeight;
        dk.classList.remove("is-measure");
        dk.style.setProperty("--anna-h", `${h}px`);
      }
      // Where the scene finds the mark: at the final pose, in the hero's pixels.
      const end = poses[poses.length - 1];
      const px = plate.offsetLeft + W.left + end.x + markAt.x * end.s;
      const py = plate.offsetTop + W.top + end.y + markAt.y * end.s;
      markBox.style.left = `${px.toFixed(2)}px`;
      markBox.style.top = `${py.toFixed(2)}px`;
      markBox.style.width = `${(markAt.w * end.s).toFixed(2)}px`;
      sky.size();
    };

    // ── The story: chapters, states and beats. ──
    const cls = (...c: string[]) => c.forEach((k) => dk.classList.add(k));
    const uncls = (...c: string[]) => c.forEach((k) => dk.classList.remove(k));
    /** Props still up when the scroll moves on fade out, either way (a contact card cut away in
     *  one frame read as a glitch); on load, or under reduced motion, they go at once. */
    let soft = false;
    const hide = (...els: HTMLElement[]) =>
      soft
        ? gsap.to(els, { autoAlpha: 0, duration: 0.55, ease: ease.out, overwrite: true })
        : gsap.set(els, { autoAlpha: 0 });
    const setRing = (done: number, all: number) => {
      ring.style.strokeDashoffset = String(62.8 * (1 - done / all));
      ringN.textContent = `${done} of ${all}`;
    };
    const at = (r: Rect) => ({ x: r.x + r.w * 0.6, y: r.y + r.h * 0.55 });
    /** Each keyframe's finished state, set at once (going back, or past it in one jump). */
    const STATE: Record<number, (done: boolean) => void> = {
      1: (d) => {
        dk.classList.toggle("m-new", d);
        uncls("m-glow");
        newn.textContent = d ? "4 new" : "3 new";
      },
      2: (d) => {
        dk.classList.toggle("c-id", d);
        uncls("m-hover", "c-card");
        hide(cur, card);
      },
      3: (d) => {
        dk.classList.toggle("t-key", d);
        hide(keyset);
      },
      4: (d) => {
        dk.classList.toggle("t-made", d);
        setRing(1, d ? 6 : 5);
        hide(fly);
      },
      5: (d) => {
        dk.classList.toggle("offers", d);
        dk.classList.toggle("booked", d);
        offers.forEach((o) => o.classList.remove("is-hot"));
        hide(acur);
      },
      6: (d) => {
        ["c-you", "c-typing", "c-sent", "reacted"].forEach((k) => dk.classList.toggle(k, d));
        uncls("c-gap");
      },
      7: () => {},
    };
    /** Each keyframe's beat, played forward in time. */
    const BEAT: Record<number, () => gsap.core.Timeline> = {
      1: () => {
        const tl = gsap.timeline();
        tl.call(
          () => {
            cls("m-new", "m-glow");
            newn.textContent = "4 new";
          },
          undefined,
          0.5,
        );
        tl.call(() => uncls("m-glow"), undefined, 3.6);
        return tl;
      },
      2: () => {
        placeCard();
        const a = rectIn(who, dk);
        const tl = gsap.timeline({ delay: 0.7 });
        tl.set(cur, { x: a.x + a.w * 1.8, y: a.y + a.h * 3 })
          .to(cur, { autoAlpha: 1, duration: 0.4 })
          .to(
            cur,
            { x: a.x + a.w * 0.62, y: a.y + a.h * 0.9, duration: 1.2, ease: "power2.inOut" },
            "<",
          )
          .call(() => cls("m-hover"))
          .to(cur, { scale: 0.86, duration: 0.12 }, "+=0.35")
          .to(cur, { scale: 1, duration: 0.25 })
          .call(() => cls("c-id", "c-card"))
          .fromTo(
            card,
            { autoAlpha: 0, scale: 0.96, y: "-=6" },
            { autoAlpha: 1, scale: 1, y: "+=6", duration: 0.9, ease: ease.out },
            "<",
          )
          .add(() => {
            card.querySelectorAll<HTMLElement>("[data-n]").forEach((n, i) => {
              const o = { v: 0 };
              gsap.to(o, {
                v: +n.dataset.n!,
                duration: 1.4,
                delay: 0.2 + i * 0.12,
                ease: "power2.out",
                onUpdate: () => (n.textContent = String(Math.round(o.v))),
              });
            });
          }, "<")
          .to(cur, { autoAlpha: 0, x: "+=24", y: "+=40", duration: 0.7 }, "+=0.9");
        return tl;
      },
      3: () => {
        const a = rectIn(annaRow, dk);
        const tl = gsap.timeline({ delay: 0.6 });
        tl.set(keyset, { x: a.x + a.w * 0.45, y: a.y + a.h * 0.08, scale: 0.9 })
          .to(keyset, { autoAlpha: 1, scale: 1, duration: 0.6, ease: ease.out })
          .to(key, { scale: 0.86, y: "0.12em", duration: 0.14, ease: "power2.in" }, "+=0.6")
          .to(key, { scale: 1, y: 0, duration: 0.45, ease: ease.out })
          .call(() => cls("t-key"))
          .to(keyset, { autoAlpha: 0, duration: 0.4 }, "+=1.6");
        return tl;
      },
      4: () => {
        hide(keyset);
        const a = rectIn(annaRow, dk);
        const b = rectIn(born, dk);
        const tl = gsap.timeline({ delay: 0.3 });
        tl.set(fly, { x: a.x, y: a.y + a.h * 0.3, width: Math.min(a.w, b.w), autoAlpha: 1 })
          .to(fly, { x: b.x, y: b.y, width: b.w, duration: 1.6, ease: "power2.inOut" })
          .call(
            () => {
              cls("t-made");
              setRing(1, 6);
            },
            undefined,
            "-=0.2",
          )
          .to(fly, { autoAlpha: 0, duration: 0.5 });
        return tl;
      },
      5: () => {
        const o1 = rectIn(offers[0], dk);
        const o2 = rectIn(offers[1], dk);
        const c = rectIn(widgets.get("cal")!, dk);
        const tl = gsap.timeline();
        tl.call(() => cls("offers"), undefined, 0.5)
          .set(acur, { x: c.x + c.w * 0.95, y: c.y + c.h * 0.92 }, 1.4)
          .to(acur, { autoAlpha: 1, duration: 0.5 })
          .to(acur, { ...at(o1), duration: 1.4, ease: "power2.inOut" }, "<")
          .call(() => offers[0].classList.add("is-hot"))
          .call(() => offers[0].classList.remove("is-hot"), undefined, "+=0.9")
          .to(acur, { ...at(o2), duration: 1.1, ease: "power2.inOut" }, "<")
          .call(() => offers[1].classList.add("is-hot"))
          .to(acur, { scale: 0.88, duration: 0.12 }, "+=0.7")
          .to(acur, { scale: 1, duration: 0.25 })
          .call(() => cls("booked"))
          .to(acur, { autoAlpha: 0, x: "+=30", y: "+=24", duration: 0.8 }, "+=1.2");
        return tl;
      },
      6: () => {
        const tl = gsap.timeline();
        tl.call(() => cls("c-you"), undefined, 0.5)
          .call(() => cls("c-typing"), undefined, 1.9)
          .call(() => cls("c-gap"), undefined, 3.9)
          .call(() => cls("c-sent"), undefined, 4.1)
          .call(() => cls("reacted"), undefined, 5.3)
          .call(() => uncls("c-gap"), undefined, 5.5);
        return tl;
      },
      7: () => gsap.timeline(),
    };

    let chapter = -1;
    /** The count beside the row: the chapter, or the one under the pointer by name. */
    const showCount = (hot = -1) => {
      count.textContent =
        hot >= 0
          ? `${hot + 1} · ${steps[hot].getAttribute("aria-label")}`
          : `${chapter + 1} / ${CHAPTERS}`;
    };
    const setChapter = (i: number) => {
      if (i === chapter) return;
      chapter = i;
      chs.forEach((c, k) => {
        c.classList.toggle("is-on", k === i);
        c.classList.toggle("is-past", k < i);
        if (k > 0) c.setAttribute("aria-hidden", String(k !== i));
      });
      const lit = FOCUS[i];
      widgets.forEach((w, k) => {
        w.classList.toggle("is-focus", lit[0] === k);
        w.classList.toggle("is-dim", lit.length > 0 && !lit.includes(k));
      });
      steps.forEach((b, k) =>
        k === i ? b.setAttribute("aria-current", "step") : b.removeAttribute("aria-current"),
      );
      showCount();
      showWords();
    };
    const off = new AbortController();
    const opt = { signal: off.signal };
    steps.forEach((b, k) => {
      b.addEventListener("pointerenter", () => showCount(k), opt);
      b.addEventListener("focus", () => showCount(k), opt);
      b.addEventListener("pointerleave", () => showCount(), opt);
      b.addEventListener("blur", () => showCount(), opt);
    });

    // ── Reduced motion: the chapters as tabs. Each swaps the words, sets the window's state as
    // it stands at the end of that chapter, and draws the sky once at that hour. ──
    if (reduce) {
      const show = (i: number) => {
        setChapter(i);
        for (let j = 1; j < KEYS.length; j++) STATE[j](KEYS[j].at < chapterStart(i + 1) - 1e-6);
        const day = dayAt((i + 0.6) / CHAPTERS);
        hero.style.setProperty("--sun", sunAt(day).toFixed(3));
        sky.size();
        sky.draw(12, 0, 0);
      };
      steps.forEach((b) => b.addEventListener("click", () => show(Number(b.dataset.go)), opt));
      show(0);
      return () => {
        off.abort();
        sky.lose();
        hero.style.removeProperty("--sun");
      };
    }

    // ── The camera: the scroll sets its target, the ticker glides to it. ──
    const state = { p: 0, raw: 0, day: 0 };
    const target: Pose = { s: 1, x: 0, y: 0, ...LEAN };
    const now: Pose = { s: 1, x: 0, y: 0, ...LEAN };
    const aim = { x: 0, y: 0 };
    const lag = { x: 0, y: 0 };
    /** When the scroll last crossed a keyframe going forward (ticker seconds). The move to it
     *  is the scroll's, but it also completes in time (KEY_GLIDE): a visitor who stops just past
     *  a keyframe still sees the camera arrive where that keyframe's beat plays, instead of
     *  watching the beat happen off the frame's edge. Going back, or on load, it is complete. */
    let keyTime = -1e9;
    const KEY_GLIDE = 1.5;
    const glideDone = () => smooth((gsap.ticker.time - keyTime) / KEY_GLIDE);
    const retarget = () => {
      const { k, t } = blendAt(state.p, ATS);
      const to = k === 0 ? poses[0] : lerpPose(poses[k - 1], poses[k], Math.max(t, glideDone()));
      Object.assign(target, to);
    };
    /** 1 while the scene is about to take the mark: the window holds exactly still. */
    const handoff = () => smooth((state.p - chapterStart(CHAPTERS - 1)) / 0.06);
    /** The ticker's frame ratio, bounded: before its first tick it is not a number, and a tab
     *  coming back from the background reports a long frame. */
    const ratio = () => {
      const r = gsap.ticker.deltaRatio();
      return Number.isFinite(r) && r > 0 ? Math.min(r, 4) : 1;
    };
    const applyCam = (snap = false) => {
      const r = ratio();
      const k = snap ? 1 : 1 - Math.pow(0.91, r);
      const kp = snap ? 1 : 1 - Math.pow(0.94, r);
      const still = 1 - handoff();
      lag.x += (aim.x - lag.x) * kp;
      lag.y += (aim.y - lag.y) * kp;
      for (const key of ["s", "x", "y", "rx", "ry"] as const) {
        const d = target[key] - now[key];
        now[key] = Math.abs(d) < 1e-4 ? target[key] : now[key] + d * k;
      }
      // How leaned the pose is (1 at rest, 0 on a close-up or the whole window). A leaned window
      // tilts toward the pointer and breathes in 3D; a flat one only drifts in 2D, because any
      // 3D in its transform makes Chrome raster the window at a lower scale and the camera's
      // close-ups go soft (a hair of rotation left from the lean was enough).
      const lean = Math.min(
        1,
        (Math.abs(now.rx) + Math.abs(now.ry)) / (Math.abs(LEAN.rx) + Math.abs(LEAN.ry)),
      );
      const t = gsap.ticker.time;
      const breath = Math.sin(t * 0.5) * 4 * (0.35 + 0.65 * lean) * still;
      const ry = now.ry + lag.x * 2.4 * still * lean;
      const rx = now.rx - (lag.y * 1.6 + Math.sin(t * 0.37) * 0.5) * still * lean;
      const x = now.x - lag.x * 10 * still * (1 - lean);
      const y = now.y - lag.y * 6 * still * (1 - lean) + breath;
      const flat = !webkit && Math.abs(rx) < 0.01 && Math.abs(ry) < 0.01;
      gsap.set(cam, {
        scale: now.s,
        x,
        y,
        rotationX: flat ? 0 : rx,
        // In Safari a hair of turn is always left, so the transform never collapses to 2D.
        rotationY: flat ? 0 : webkit && Math.abs(ry) < 0.01 ? 0.01 : ry,
        force3D: !flat,
        transformOrigin: "0 0",
      });
    };

    let keyAt = 0;
    let primed = false;
    let beat: gsap.core.Timeline | null = null;
    const setKey = (k: number) => {
      const first = !primed;
      primed = true;
      if (k === keyAt) return;
      const forward = k > keyAt;
      keyAt = k;
      keyTime = forward && !first ? gsap.ticker.time : -1e9;
      beat?.kill();
      beat = null;
      gsap.killTweensOf([fly, keyset, key, cur, acur, card]);
      soft = !first;
      for (let j = 1; j < KEYS.length; j++) STATE[j](forward ? j < k : j <= k);
      soft = false;
      if (forward) beat = BEAT[k]();
      else if (k === 2) {
        placeCard();
        gsap.to(card, { autoAlpha: 1, scale: 1, duration: 0.6, ease: ease.out, overwrite: true });
        cls("c-card");
      }
    };

    // ── Scroll → p; one ticker for the glide, the sky, the breath and the clocks. ──
    const onProgress = (raw: number) => {
      state.raw = raw;
      state.p = Math.min(1, Math.max(0, raw / HERO_LEAD));
      setChapter(chapterAt(state.p).i);
      showWords();
      setKey(blendAt(state.p, ATS).k);
      retarget();
    };
    const scene = hero.closest<HTMLElement>("[data-scene]") ?? hero;
    const st = ScrollTrigger.create({
      trigger: scene,
      start: "top top",
      end: "bottom bottom",
      invalidateOnRefresh: true,
      refreshPriority: 1,
      onRefresh: (self) => {
        measure();
        onProgress(self.progress);
        applyCam(true);
      },
      onUpdate: (self) => onProgress(self.progress),
    });
    const onRefreshInit = () => measure();
    ScrollTrigger.addEventListener("refreshInit", onRefreshInit);
    measure();
    onProgress(st.progress);
    applyCam(true);
    void document.fonts?.ready.then(() => {
      measure();
      retarget();
      applyCam(true);
    });

    let visible = true;
    const io = new IntersectionObserver((es) => (visible = es[0].isIntersecting), { threshold: 0 });
    io.observe(plate);
    const move = (e: PointerEvent) => {
      aim.x = e.clientX / innerWidth - 0.5;
      aim.y = e.clientY / innerHeight - 0.5;
    };
    const leave = () => {
      aim.x = 0;
      aim.y = 0;
    };
    if (!touch) {
      addEventListener("pointermove", move, { passive: true });
      document.addEventListener("pointerleave", leave);
    }
    let lastSun = "";
    // The waves are slow: they draw every second tick (30 fps), every third on a phone, which
    // reads the same and frees the frame; the window and the camera keep the full rate.
    let beatN = 0;
    const tick = (time: number) => {
      // The hero has gone once the scene has the mark: nothing to draw.
      if (!visible || state.raw > HERO_LEAD + 0.03) return;
      if (gsap.ticker.time - keyTime < KEY_GLIDE + 0.1) retarget();
      applyCam();
      state.day += (dayAt(state.p) - state.day) * (1 - Math.pow(0.9, ratio()));
      const sun = sunAt(state.day).toFixed(3);
      if (sun !== lastSun) {
        lastSun = sun;
        hero.style.setProperty("--sun", sun);
      }
      beatN = (beatN + 1) % (narrow.matches ? 3 : 2);
      if (beatN === 0) sky.draw(time, (now.x / P.w) * -0.06, (now.y / P.h) * 0.06);
    };
    gsap.ticker.add(tick);

    // One gesture, one chapter (motion/dusk-steps.ts): each rests where its camera has landed.
    const heroY = (p: number) => st.start + p * HERO_LEAD * (st.end - st.start);
    stages = startSteps(
      () => Array.from({ length: CHAPTERS }, (_, i) => heroY(chapterRest(i, ATS))),
      () => heroY(1),
      (y) => chapterAt((y - st.start) / (HERO_LEAD * (st.end - st.start) || 1)).i,
      (k) => wordsOn && words?.show(k),
    );
    // The chapter buttons glide straight to their chapter's rest.
    steps.forEach((b) => b.addEventListener("click", () => stages?.go(Number(b.dataset.go)), opt));

    // ── Intro: the window stands up out of the dark and the sky comes up; the lines rise. ──
    let introTl: gsap.core.Timeline | null = null;
    if (playIntro) {
      gsap.set(float, { autoAlpha: 0, y: 70, rotationX: 12 });
      gsap.set(canvas, { opacity: 0 });
      introTl = gsap
        .timeline({ paused: true })
        .to(canvas, { opacity: 1, duration: 1.6, ease: ease.out }, 0)
        .to(float, { autoAlpha: 1, duration: 1.0, ease: ease.out }, 0.1)
        .to(
          float,
          { y: 0, rotationX: 0, duration: 1.9, ease: ease.out, clearProps: "transform" },
          0.1,
        )
        .add(() => {
          hero.classList.add("is-up");
          wordsOn = true;
          words?.show(chapter);
        }, 0.15);
      intro.add(() => void introTl?.play(), 0);
    } else {
      hero.classList.add("is-up");
      gsap.fromTo(float, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6, ease: ease.out });
    }

    return () => {
      off.abort();
      stages?.stop();
      st.kill();
      ScrollTrigger.removeEventListener("refreshInit", onRefreshInit);
      io.disconnect();
      gsap.ticker.remove(tick);
      beat?.kill();
      introTl?.kill();
      words?.kill();
      removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
      sky.lose();
      hero.classList.remove("is-up", "is-webkit");
      hero.style.removeProperty("--sun");
    };
  });
}

/** The plate's background: "Waves" (lib/waves.ts), one WebGL1 program on the plate's canvas,
 *  a fullscreen triangle, its uniforms fed as the builder packed them, at the device's pixels
 *  capped at 2 (the grain is per pixel). It draws on the hero's ticker, which stops with the tab
 *  and off screen. `draw` marks the plate live on its first frame, which shows the canvas over
 *  the plate's CSS stand-in. Without WebGL every call is a no-op. */
function makeSky(canvas: HTMLCanvasElement, plate: HTMLElement) {
  const none = { size: () => {}, draw: (_t: number, _x: number, _y: number) => {}, lose: () => {} };
  const gl = canvas.getContext("webgl", {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance",
  });
  if (!gl) return none;
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, SKY_VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, WAVES_FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return none;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const u = (name: string) => gl.getUniformLocation(prog, name);
  gl.uniform3fv(u("u_colors"), wavesColors());
  gl.uniform4f(u("u_shape"), ...WAVES.shape);
  gl.uniform4f(u("u_surface"), ...WAVES.surface);
  gl.uniform4f(u("u_finish"), ...WAVES.finish);
  gl.uniform4f(u("u_transform"), ...WAVES.transform);
  gl.uniform4f(u("u_cursor"), ...WAVES.cursor);
  const uScene = u("u_scene");
  const uSpace = u("u_space");
  let live = false;
  return {
    size: () => {
      // A phone draws at half its (capped) pixels, so the grain is one CSS pixel: at full count
      // a throttled phone (software GL) fell to 8 fps, at half it holds 45; a third holds 60
      // but the grain turns to visible blocks.
      const s = Math.min(devicePixelRatio || 1, 2) * (matchMedia(NARROW).matches ? 0.5 : 1);
      const w = Math.max(2, Math.round(plate.clientWidth * s));
      const h = Math.max(2, Math.round(plate.clientHeight * s));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
    },
    /** `ox`, `oy`: the camera's pan as a fraction of the plate, a hair of parallax on the field. */
    draw: (time: number, ox: number, oy: number) => {
      gl.uniform4f(uScene, canvas.width, canvas.height, time * WAVES.timeScale, WAVES.colorCount);
      gl.uniform4f(uSpace, WAVES.offset[0] + ox, WAVES.offset[1] + oy, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!live) {
        live = true;
        plate.classList.add("is-live");
      }
    },
    lose: () => {
      plate.classList.remove("is-live");
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
