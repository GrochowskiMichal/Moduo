// The bentos' pictures (components/bento): each plays its moment once it comes into view, the
// modules' again under the pointer, and a few keep a small motion at rest (the vault's noise
// reshuffles, the import's wires pulse), paused off screen. Every picture's still state is the
// moment's result, so without JS or with reduced motion nothing is missing.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { ease, isTouch, onPage, prefersReducedMotion } from "../engine";

gsap.registerPlugin(ScrollTrigger);

type Build = (el: HTMLElement, tl: gsap.core.Timeline) => void;
const $ = (el: HTMLElement, s: string) => el.querySelector<HTMLElement>(s);
const $$ = (el: HTMLElement, s: string) => [...el.querySelectorAll<HTMLElement>(s)];

/** A key goes down and comes back up. */
const press = (tl: gsap.core.Timeline, keys: Element[] | Element | null, at: number) => {
  if (!keys) return;
  tl.to(
    keys,
    { y: 2, duration: 0.09, ease: "power1.in", yoyo: true, repeat: 1, stagger: 0.05 },
    at,
  );
};

const builds: Record<string, Build> = {
  // T goes down; the task slides out from under the email, the email still attached.
  email(el, tl) {
    press(tl, $(el, "[data-key]"), 0.35);
    tl.from($(el, "[data-made]"), { autoAlpha: 0, y: 28, duration: 0.9, ease: ease.out }, 0.5);
    tl.from($(el, "[data-attach]"), { autoAlpha: 0, x: -8, duration: 0.6, ease: ease.out }, 1);
  },
  // Done ⏎: the minutes the clock kept fly from the pill onto the task in the done list, the next
  // task rises out of Up next into the Now card and its clock starts, and the rows between move up
  // by the one row that left. The sums swap as it happens (each [data-a] gives way to its
  // [data-b]).
  tasks(el, tl) {
    const fly = $(el, "[data-fly]");
    const kept = $(el, "[data-kept]");
    const run = $(el, "[data-run]");
    const swap = (at: number, scope: string) => {
      tl.fromTo(
        $$(el, `${scope} [data-a]`),
        { autoAlpha: 1 },
        { autoAlpha: 0, duration: 0.25, ease: ease.out },
        at,
      );
      tl.from(
        $$(el, `${scope} [data-b]`),
        { autoAlpha: 0, duration: 0.35, ease: ease.out },
        at + 0.1,
      );
    };
    press(tl, $(el, "[data-key]"), 0.8);
    tl.to($(el, "[data-done]"), { scale: 0.96, duration: 0.09, yoyo: true, repeat: 1 }, 0.8);
    if (fly && kept) {
      // The clock's minutes lift out of the pill, which dims behind them.
      tl.to($(el, "[data-mins]"), { opacity: 0.25, duration: 0.3, ease: ease.out }, 1);
      tl.fromTo(
        fly,
        { autoAlpha: 0, scale: 0.7 },
        { autoAlpha: 1, scale: 1, y: -6, duration: 0.3, ease: ease.out },
        1,
      );
      // From where it lifted off to the task's minutes, measured when it sets off.
      const to = (axis: "x" | "y") => () => {
        const a = fly.getBoundingClientRect();
        const b = kept.getBoundingClientRect();
        const at = Number(gsap.getProperty(fly, axis)) || 0;
        return axis === "x"
          ? at + b.left + b.width / 2 - (a.left + a.width / 2)
          : at + b.top + b.height / 2 - (a.top + a.height / 2);
      };
      tl.to(fly, { x: to("x"), duration: 0.9, ease: ease.inOut }, 1.2);
      tl.to(fly, { y: to("y"), duration: 0.8, ease: "power2.in" }, 1.3);
      tl.to(fly, { autoAlpha: 0, scale: 0.9, duration: 0.25, ease: ease.out }, 2.05);
    }
    tl.fromTo(
      $(el, "[data-was]"),
      { autoAlpha: 1 },
      { autoAlpha: 0, y: -10, duration: 0.45, ease: ease.out },
      1.25,
    );
    tl.fromTo(
      $(el, "[data-leaves]"),
      { autoAlpha: 1 },
      { autoAlpha: 0, yPercent: -40, duration: 0.3, ease: ease.out },
      1.3,
    );
    tl.from($(el, "[data-is]"), { autoAlpha: 0, y: 14, duration: 0.7, ease: ease.out }, 1.45);
    if (run) {
      tl.call(
        () => {
          run.dataset.since = String(gsap.ticker.time);
          run.textContent = "0:00";
        },
        [],
        1.45,
      );
    }
    swap(1.35, ".tm-hd");
    swap(1.4, "[data-up]:not(.tm-doneline)");
    tl.from(
      $$(el, "[data-up]"),
      { yPercent: 100, duration: 0.7, ease: ease.inOut, stagger: 0.04 },
      1.4,
    );
    const landed = $(el, "[data-landed]");
    tl.from(landed, { autoAlpha: 0, duration: 0.4, ease: ease.out }, 1.85);
    tl.fromTo(
      landed,
      { backgroundColor: "rgb(238 238 238 / 0.12)" },
      {
        backgroundColor: "rgb(238 238 238 / 0)",
        duration: 1.6,
        ease: "power1.in",
        immediateRender: false,
      },
      1.85,
    );
    swap(2.05, ".tm-doneline");
  },
  // ⌘⇧T: the keys come up and go down, the square becomes the task's circle, the due day arrives.
  notes(el, tl) {
    const box = $(el, "[data-box]");
    tl.from($(el, "[data-keys]"), { autoAlpha: 0, y: 10, duration: 0.5, ease: ease.out }, 0.15);
    press(tl, $$(el, "[data-keys] .ap-kbd"), 0.6);
    if (box) {
      box.classList.add("is-square");
      tl.call(() => box.classList.add("is-square"), [], 0);
      tl.call(() => box.classList.remove("is-square"), [], 0.85);
    }
    tl.from($(el, "[data-chip]"), { autoAlpha: 0, x: -6, duration: 0.5, ease: ease.out }, 1);
  },
  // The week fills in, the now line draws across today, the block that ran out asks.
  calendar(el, tl) {
    tl.from(
      $$(el, "[data-item]"),
      { autoAlpha: 0, y: 8, duration: 0.6, ease: ease.out, stagger: 0.06 },
      0.1,
    );
    tl.from(
      $(el, "[data-now]"),
      { scaleX: 0, transformOrigin: "0 50%", duration: 0.8, ease: ease.out },
      0.4,
    );
    tl.from($(el, "[data-triage]"), { autoAlpha: 0, y: 4, duration: 0.5, ease: ease.out }, 0.9);
  },
  // Maciej's page fills in, row by row; then a new moduo.app address offers to link itself.
  contacts(el, tl) {
    tl.from(
      $$(el, "[data-row]"),
      { autoAlpha: 0, x: -16, duration: 0.7, ease: ease.out, stagger: 0.12 },
      0.15,
    );
    tl.from($(el, "[data-suggest]"), { autoAlpha: 0, y: 14, duration: 0.7, ease: ease.out }, 0.75);
  },

  // The three replies fold into one line; the answer arrives flagged as the decision.
  chat(el, tl) {
    const replies = $(el, "[data-replies]");
    // The replies are out of the layout in the still picture; the fold shows them first.
    gsap.set(replies, { display: "grid" });
    tl.set(replies, { display: "grid" }, 0);
    tl.fromTo(
      replies,
      { autoAlpha: 1, scaleY: 1 },
      { autoAlpha: 0, scaleY: 0.4, transformOrigin: "50% 0", duration: 0.55, ease: ease.inOut },
      1.1,
    );
    tl.set(replies, { display: "none" }, 1.65);
    tl.from($(el, "[data-wrapped]"), { autoAlpha: 0, duration: 0.4, ease: ease.out }, 1.35);
    tl.from($(el, "[data-decision]"), { autoAlpha: 0, y: 10, duration: 0.7, ease: ease.out }, 1.55);
    tl.from($(el, "[data-flag]"), { autoAlpha: 0, x: -6, duration: 0.5, ease: ease.out }, 2);
  },
  // ⌘K: the query types itself, then what it finds comes in, group by group.
  keys(el, tl) {
    const typed = $(el, "[data-typed]");
    if (typed) {
      const word = typed.textContent ?? "";
      tl.call(() => void (typed.textContent = ""), [], 0);
      [...word].forEach((_, i) =>
        tl.call(() => void (typed.textContent = word.slice(0, i + 1)), [], 0.35 + i * 0.12),
      );
    }
    tl.from(
      $$(el, "[data-group]"),
      { autoAlpha: 0, y: 8, duration: 0.5, ease: ease.out, stagger: 0.08 },
      0.95,
    );
  },
  // Each module packs in turn and ticks.
  export(el, tl) {
    $$(el, "[data-row]").forEach((row, i) => {
      tl.from(
        $(row, "[data-fill]"),
        { scaleX: 0, duration: 0.55, ease: ease.inOut },
        0.15 + i * 0.22,
      );
      tl.from(
        $(row, "[data-ok]"),
        { autoAlpha: 0, scale: 0.4, duration: 0.35, ease: ease.out },
        0.6 + i * 0.22,
      );
    });
  },
  // The old key is struck through and stamped.
  revoke(el, tl) {
    tl.from($(el, "[data-strike]"), { scaleX: 0, duration: 0.6, ease: ease.inOut }, 0.5);
    tl.from(
      $(el, "[data-badge]"),
      { autoAlpha: 0, scale: 0.8, duration: 0.4, ease: ease.out },
      0.95,
    );
  },
  // Everything goes, one module after another.
  leave(el, tl) {
    tl.from(
      $$(el, "[data-gone]"),
      { autoAlpha: 0, x: -8, duration: 0.45, ease: ease.out, stagger: 0.1 },
      0.3,
    );
  },
};

export function startBento() {
  onPage(() => {
    const minis = [...document.querySelectorAll<HTMLElement>("[data-mini]")];
    if (!minis.length) return;
    const touch = isTouch();
    const off = new AbortController();
    const triggers: ScrollTrigger[] = [];
    const loops: gsap.core.Animation[] = [];
    const reduced = prefersReducedMotion();

    // The light that follows the pointer over a module's card.
    if (!touch) {
      document.querySelectorAll<HTMLElement>("[data-card]").forEach((card) => {
        card.addEventListener(
          "pointermove",
          (e) => {
            const r = card.getBoundingClientRect();
            card.style.setProperty("--px", `${e.clientX - r.left}px`);
            card.style.setProperty("--py", `${e.clientY - r.top}px`);
          },
          { signal: off.signal, passive: true },
        );
      });
    }
    if (reduced) return () => off.abort();

    for (const el of minis) {
      const build = builds[el.dataset.mini ?? ""];
      if (build) {
        const tl = gsap.timeline({ paused: true });
        build(el, tl);
        tl.progress(0);
        // A picture in the modules' one window plays when its module comes through
        // (motion/modules.ts sends bento:play), not as it scrolls into view.
        if (el.closest("[data-mods]")) {
          el.addEventListener("bento:play", () => void tl.restart(), { signal: off.signal });
          continue;
        }
        triggers.push(
          ScrollTrigger.create({
            trigger: el,
            start: "top 80%",
            once: true,
            onEnter: () => void tl.play(0),
          }),
        );
        // A module's card plays its moment again under the pointer.
        const card = el.closest<HTMLElement>("[data-card]");
        if (card && !touch) {
          card.addEventListener(
            "pointerenter",
            () => {
              if (!tl.isActive() && tl.progress() === 1) tl.restart();
            },
            { signal: off.signal },
          );
        }
      }
    }

    // At rest: the vault's noise reshuffles a few characters at a time.
    const noise = document.querySelector<HTMLElement>("[data-noise]");
    if (noise) {
      const glyphs = "K#7:@?IB>/L{Y![%T*;0X&";
      const shuffle = gsap.delayedCall(1.6, function tick() {
        const chars = [...(noise.textContent ?? "")];
        for (let n = 0; n < 3; n++)
          chars[Math.floor(Math.random() * chars.length)] =
            glyphs[Math.floor(Math.random() * glyphs.length)];
        noise.textContent = chars.join("");
        shuffle.restart(true);
      });
      shuffle.pause();
      loops.push(shuffle);
      triggers.push(
        ScrollTrigger.create({
          trigger: noise,
          start: "top bottom",
          end: "bottom top",
          onToggle: (s) => (s.isActive ? shuffle.resume() : shuffle.pause()),
        }),
      );
    }

    // At rest: a pulse runs along each import wire, now and then.
    const pulses = $$(document.body, "[data-pulse]");
    if (pulses.length) {
      const run = gsap.timeline({ repeat: -1, repeatDelay: 2.2, paused: true });
      pulses.forEach((p, i) => {
        const wire = p.parentElement!;
        run.fromTo(
          p,
          { x: 0, autoAlpha: 0 },
          {
            x: () => wire.offsetWidth - p.offsetWidth,
            keyframes: { autoAlpha: [0, 1, 1, 0] },
            duration: 1.4,
            ease: "none",
          },
          i * 0.5,
        );
      });
      loops.push(run);
      triggers.push(
        ScrollTrigger.create({
          trigger: pulses[0].closest("[data-mini]")!,
          start: "top bottom",
          end: "bottom top",
          onToggle: (s) => (s.isActive ? run.play() : run.pause()),
        }),
      );
    }

    // At rest: the Tasks card's clock counts on from when its task rose into the Now card.
    const run = document.querySelector<HTMLElement>("[data-run]");
    if (run) {
      const count = gsap.delayedCall(0.25, function tick() {
        const since = Number(run.dataset.since);
        if (since) {
          const s = Math.max(0, Math.floor(gsap.ticker.time - since));
          run.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
        }
        count.restart(true);
      });
      count.pause();
      loops.push(count);
      triggers.push(
        ScrollTrigger.create({
          trigger: run.closest("[data-mini]")!,
          start: "top bottom",
          end: "bottom top",
          onToggle: (s) => (s.isActive ? count.resume() : count.pause()),
        }),
      );
    }

    return () => {
      off.abort();
      triggers.forEach((t) => t.kill());
      loops.forEach((l) => l.kill());
    };
  });
}
