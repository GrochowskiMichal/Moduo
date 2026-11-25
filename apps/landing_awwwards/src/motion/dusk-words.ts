// Dusk's words (components/home/Dusk.astro), on the one clock, for motion/dusk.ts.
//
//   the lines     a chapter's words rise out of their line's clip one after another, the grey
//                 second thought a beat behind the Paper line, and leave the way the story
//                 moves: up going forward, down going back, so scrolling either way reads as
//                 one direction of travel. A change mid-flight takes every word from where it
//                 stands, so a fast scroll never stacks two chapters or snaps one back.
//   the opening   delivered at reading pace: its words rise as one shape, held dim, then a light
//                 passes over them in the order they are read, pausing at the commas. The two
//                 sentences of what Moduo is under it paint with the HTML on arrival (the first
//                 screen's largest text, LCP); coming back to the opening, they follow the line
//   the hour      under each chapter; a figure that changes rolls to the next like a clock's,
//                 the ones that stay hold still, and the module's name swaps in its own slot
//
// Desktop words also sharpen out of a slight blur as they rise (a phone skips it: its frames
// go to the waves). Under reduced motion none of this runs: the chapters swap at once (CSS).
import { gsap } from "gsap";

import { ease } from "../engine";

type When = {
  el: HTMLElement;
  time: string;
  figs: HTMLElement[];
  dot: HTMLElement;
  mod: HTMLElement;
};
type Chapter = {
  paper: HTMLElement[];
  grey: HTMLElement[];
  subs: HTMLElement[];
  when: When | null;
};

/** How far a word waiting or gone sits from its line: clear of the clip's descender room. */
const OFF = 115;
/** The opening's words, held dim before the light reaches them. */
const DIM = 0.26;

const seen = (el: HTMLElement) => Number(gsap.getProperty(el, "opacity")) > 0.02;

/** The hour's figures, each in a clip of its own (the markup has the hour as one text). */
function figures(time: HTMLElement): HTMLElement[] {
  const chars = [...(time.textContent ?? "")];
  time.textContent = "";
  return chars.map((c) => {
    const clip = document.createElement("span");
    clip.className = "dusk__c";
    const fig = document.createElement("span");
    fig.className = "dusk__ci";
    fig.dataset.c = c;
    fig.textContent = c;
    clip.append(fig);
    time.append(clip);
    return fig;
  });
}

/** Two figures stacked in one clip, the one on top seen first. */
const reel = (pair: string[]) =>
  pair.map((c) => {
    const s = document.createElement("span");
    s.textContent = c;
    return s;
  });

export function makeWords(chEls: HTMLElement[], soft: boolean) {
  const chs: Chapter[] = chEls.map((el) => {
    const w = el.querySelector<HTMLElement>(".dusk__when");
    const time = w?.querySelector<HTMLElement>("[data-time]");
    return {
      paper: [...el.querySelectorAll<HTMLElement>(".dusk__l:not(.is-grey) .dusk__w")],
      grey: [...el.querySelectorAll<HTMLElement>(".dusk__l.is-grey .dusk__w")],
      subs: [...el.querySelectorAll<HTMLElement>(".dusk__s")],
      when:
        w && time
          ? {
              el: w,
              time: time.textContent ?? "",
              figs: figures(time),
              dot: w.querySelector<HTMLElement>(".dusk__dot")!,
              mod: w.querySelector<HTMLElement>(".dusk__mod")!,
            }
          : null,
    };
  });
  const moving = (c: Chapter) => [
    ...c.paper,
    ...c.grey,
    ...(c.when ? [...c.when.figs, c.when.dot, c.when.mod] : []),
  ];
  const subs = chs.flatMap((c) => c.subs);
  const all = [...chs.flatMap(moving), ...subs];
  // Everything waits; the parts of the hour carry their own visibility from here on.
  gsap.set(
    chs.flatMap((c) => (c.when ? [c.when.el, c.when.el.querySelector("[data-time]")!] : [])),
    { opacity: 1 },
  );
  // The sentences are left as painted until the first chapter shown says otherwise.
  gsap.set(chs.flatMap(moving), { yPercent: OFF, opacity: 0 });

  const blurIn = soft ? { filter: "blur(6px)" } : {};
  const blurOut = soft ? { filter: "blur(4px)" } : {};
  const sharp = soft ? { filter: "blur(0px)" } : {};
  let cur = -1;
  let tl: gsap.core.Timeline | null = null;

  /** A figure caught mid-roll goes back to the one figure it stands for. */
  const settle = (fig: HTMLElement) => {
    if (fig.childElementCount) {
      fig.textContent = fig.dataset.c ?? "";
      gsap.set(fig, { yPercent: seen(fig) ? 0 : OFF });
    }
  };

  /** One element's arrival at `at`: from where it stands if it is still seen, else from the
   *  side the story comes from. */
  const rise = (
    el: HTMLElement,
    at: number,
    dir: number,
    o: { to?: number; dur?: number; px?: boolean } = {},
  ) => {
    const to = { opacity: o.to ?? 1, duration: o.dur ?? 1.25, ease: ease.out, ...sharp };
    const pos = o.px ? { y: 0 } : { yPercent: 0 };
    if (seen(el)) tl!.to(el, { ...pos, ...to }, at);
    else
      tl!.fromTo(
        el,
        { ...(o.px ? { y: 14 * dir } : { yPercent: OFF * dir }), opacity: 0, ...blurIn },
        { ...pos, ...to },
        at,
      );
  };

  /** Show chapter i: everything else seen leaves, i's words arrive. */
  const show = (i: number) => {
    if (i === cur) return;
    const dir = cur < 0 || i > cur ? 1 : -1;
    const from = cur;
    cur = i;
    tl?.kill();
    gsap.killTweensOf(all);
    chs.forEach((c) => c.when?.figs.forEach(settle));
    tl = gsap.timeline();
    const next = chs[i];
    if (from < 0) {
      // The first chapter shown: the others wait unseen, nothing leaves; the sentences stay as
      // painted under the opening, or wait with their chapter.
      gsap.set(subs, i === 0 ? { y: 0, opacity: 1 } : { y: 14, opacity: 0 });
    }
    const prevWhen = from >= 0 ? chs[from].when : null;
    // The hour rolls in place when the last one stands where this one will (on a phone the
    // chapters hang from the top, so a chapter a line taller moves its hour down a line).
    const roll =
      !!prevWhen &&
      !!next.when &&
      seen(prevWhen.dot) &&
      Math.abs(prevWhen.el.getBoundingClientRect().top - next.when.el.getBoundingClientRect().top) <
        1;

    // ── Leave: whatever is still seen, from where it stands, the way the story moves. ──
    const goes: HTMLElement[] = [];
    const subsGo: HTMLElement[] = [];
    chs.forEach((c, k) => {
      if (k === i) return;
      goes.push(...[...c.paper, ...c.grey].filter(seen));
      subsGo.push(...c.subs.filter(seen));
      if (!c.when) return;
      if (roll && c.when === prevWhen) {
        // The next hour takes over on the same pixels: this one goes at once, its name leaves.
        tl!.set([...c.when.figs, c.when.dot], { opacity: 0, yPercent: OFF }, 0);
        if (seen(c.when.mod)) goes.push(c.when.mod);
      } else goes.push(...[...c.when.figs, c.when.dot, c.when.mod].filter(seen));
    });
    // Gone soft: the words lift out of their clips on the brand's curve and fade a little ahead
    // of the lift, so the next chapter's words rise into lines already clear.
    if (goes.length) {
      const st = { each: 0.012, from: dir > 0 ? ("start" as const) : ("end" as const) };
      tl.to(
        goes,
        { yPercent: -OFF * dir, ...blurOut, duration: 0.75, ease: ease.out, stagger: st },
        0,
      );
      tl.to(goes, { opacity: 0, duration: 0.38, ease: ease.out, stagger: st }, 0);
    }
    if (subsGo.length)
      tl.to(subsGo, { y: -14 * dir, opacity: 0, duration: 0.45, ease: ease.out, stagger: 0.04 }, 0);
    const t0 = goes.length || subsGo.length ? 0.3 : 0;

    // ── Arrive. ──
    if (i === 0 && next.subs.length) {
      // The opening: the words rise as one shape, dim; the light passes over them as they are
      // read (longer words take longer, a comma or a full stop is a breath); then the sentences.
      // Coming back to it, the light passes quicker: it has been read once.
      const f = from < 0 ? 1 : 0.6;
      let light = t0 + 0.5 * f;
      next.paper.forEach((w, n) => {
        rise(w, t0 + n * 0.055, dir, { to: DIM, dur: 0.9 });
        const word = w.textContent ?? "";
        tl!.to(w, { opacity: 1, duration: 0.8, ease: ease.out }, light);
        light += (0.1 + word.length * 0.022 + (/[,.]$/.test(word) ? 0.16 : 0)) * f;
      });
      if (from >= 0)
        next.subs.forEach((s, n) => rise(s, light - 0.15 + n * 0.14, dir, { dur: 0.95, px: true }));
    } else {
      next.paper.forEach((w, n) => rise(w, t0 + n * 0.06, dir));
      const g0 = t0 + next.paper.length * 0.06 + 0.14;
      next.grey.forEach((w, n) => rise(w, g0 + n * 0.045, dir));
    }

    const w = next.when;
    if (!w) return;
    const w0 = t0 + 0.3;
    if (roll && prevWhen) {
      // Figures that stay are there at once; the rest roll from the last hour's, a beat apart.
      tl.set(w.dot, { opacity: 1, yPercent: 0 }, 0);
      [...w.time].forEach((c, n) => {
        const fig = w.figs[n];
        const was = prevWhen.time[n] ?? c;
        if (was === c) {
          tl!.set(fig, { opacity: 1, yPercent: 0 }, 0);
          return;
        }
        tl!.add(() => fig.replaceChildren(...reel(dir > 0 ? [was, c] : [c, was])), 0);
        tl!.fromTo(
          fig,
          { opacity: 1, yPercent: dir > 0 ? 0 : -50 },
          {
            yPercent: dir > 0 ? -50 : 0,
            duration: 0.85,
            ease: ease.out,
            onComplete: () => settle(fig),
          },
          w0 + n * 0.06,
        );
      });
    } else {
      w.figs.forEach((fig, n) => rise(fig, w0 + n * 0.035, dir, { dur: 0.8 }));
      rise(w.dot, w0 + 0.15, dir, { dur: 0.8 });
    }
    rise(w.mod, w0 + 0.12, dir, { dur: 0.85 });
  };

  return {
    show,
    kill: () => {
      tl?.kill();
      gsap.killTweensOf(all);
    },
  };
}
