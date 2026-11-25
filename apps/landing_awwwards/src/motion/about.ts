// About us. The hero's day chart answers the pointer (or a tap) with the column's numbers,
// sweeps in hour by hour on arrival and then shows where "now" is on our clock, moved each minute.
// Under it the centre line of the agent's read draws down and each row's lines arrive. The story's
// git graph keeps one pen: every lane draws down to the same line on the screen (PEN), and
// nodes, commit dots and branch names arrive as the pen reaches them, while the first commits
// type themselves out and the silent days count by. The readouts and "now" are state, so they
// also run under reduced motion; everything that moves for its own sake does not.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

import { ease, isMobile, onPage, prefersReducedMotion } from "../engine";

gsap.registerPlugin(ScrollTrigger, SplitText);

/** The clock our commits keep. */
const ZONE = "Europe/Warsaw";
/** Where on the screen the graph's pen is: lanes are drawn down to here. Low on the screen, so
 *  what you're reading is always already written. */
const PEN = "top 85%";
const PEN_END = "bottom 85%";
/** One caret on the page: it sits on the last letter typed anywhere, and leaves when typing stops. */
let caret: HTMLElement | undefined;
let caretOff: gsap.core.Tween | undefined;

type Row = { label: string; values: number[] };

/** Splits a commit message into letters, hidden, and types it out on `tl` at `at`, a block caret
 *  on the last letter typed. Returns the split (to revert) and how long the typing takes. */
function typer(el: HTMLElement, cps: number, max: number, tl: gsap.core.Timeline, at: number) {
  const split = SplitText.create(el, {
    type: "words,chars",
    charsClass: "st__chr",
    tag: "span",
    aria: "auto",
  });
  const chars = split.chars as HTMLElement[];
  gsap.set(chars, { opacity: 0 });
  const st = { n: 0 };
  const duration = Math.min(chars.length / cps, max);
  let shown = 0;
  tl.to(
    st,
    {
      n: chars.length,
      duration,
      ease: "none",
      onUpdate() {
        const k = Math.round(st.n);
        for (; shown < k; shown++) chars[shown].style.opacity = "1";
        caret?.classList.remove("is-at");
        caret = chars[Math.max(0, k - 1)];
        caret.classList.add("is-at");
        caretOff?.kill();
        caretOff = gsap.delayedCall(0.5, () => caret?.classList.remove("is-at"));
      },
    },
    at,
  );
  return { split, duration };
}

export function startAbout() {
  onPage(() => {
    const root = document.querySelector<HTMLElement>("[data-about]");
    if (!root) return;
    const reduce = prefersReducedMotion();
    const cleanups: (() => void)[] = [];
    const off = new AbortController();
    const ctx = gsap.context(() => {});

    // ── The day: the readout under the pointer or a tap. ──
    root.querySelectorAll<HTMLElement>("[data-sc]").forEach((fig) => {
      const area = fig.querySelector<HTMLElement>("[data-sc-area]")!;
      const hot = fig.querySelector<HTMLElement>("[data-sc-hot]")!;
      const read = fig.querySelector<HTMLElement>("[data-sc-read]")!;
      const cols = JSON.parse(fig.dataset.cols ?? "[]") as string[];
      const rows = JSON.parse(fig.dataset.rows ?? "[]") as Row[];
      const show = (e: PointerEvent) => {
        const r = area.getBoundingClientRect();
        const i = Math.max(
          0,
          Math.min(cols.length - 1, Math.floor(((e.clientX - r.left) / r.width) * cols.length)),
        );
        hot.style.translate = `${((i + 0.5) / cols.length) * r.width}px 0`;
        read.textContent = `${cols[i]} · ${rows.map((row) => `${row.label} ${row.values[i]}`).join(" · ")}`;
        fig.classList.add("is-reading");
      };
      const hide = () => {
        fig.classList.remove("is-reading");
        read.textContent = "";
      };
      area.addEventListener("pointermove", show, { signal: off.signal });
      area.addEventListener("pointerdown", show, { signal: off.signal });
      area.addEventListener("pointerleave", hide, { signal: off.signal });

      // "Now" on our clock, moved each minute.
      const now = fig.querySelector<HTMLElement>("[data-sc-now]");
      if (now) {
        const place = () => {
          const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone: ZONE,
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          }).formatToParts(new Date());
          const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
          const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
          const at = (h + m / 60) / 24;
          now.style.left = `${at * 100}%`;
          now.classList.toggle("is-late", at > 0.8);
        };
        place();
        const minute = gsap.delayedCall(60, function tick() {
          place();
          minute.restart(true);
        });
        cleanups.push(() => minute.kill());
        if (reduce) now.style.opacity = "1";
      }

      // The arrival: the day sweeps in from midnight, like a clock hand: the hero's at once, a
      // later one when it scrolls up.
      if (!reduce) {
        const svg = area.querySelector("svg")!;
        ctx.add(() => {
          const tl = gsap.timeline(
            now
              ? { delay: 0.1 }
              : { scrollTrigger: { trigger: fig, start: "top 92%", once: true } },
          );
          tl.fromTo(
            svg,
            { clipPath: "inset(-10% 100% -10% 0)" },
            {
              clipPath: "inset(-10% 0% -10% 0)",
              duration: isMobile() ? 0.7 : 1.2,
              ease: "power1.inOut",
            },
          );
          if (now)
            tl.fromTo(now, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: ease.out }, "-=0.2");
          // The named values arrive once their strokes have.
          tl.fromTo(
            fig.querySelectorAll(".sc__peak"),
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: 0.5, stagger: 0.08, ease: ease.out },
            now ? "<" : "-=0.2",
          );
        });
      }
    });

    // ── 11 May on a phone: the night's first commits, and the rest on a tap. ──
    const more = root.querySelector<HTMLButtonElement>("[data-st-more]");
    const nightList = root.querySelector<HTMLElement>("[data-st-night]");
    if (more && nightList) {
      more.hidden = false;
      more.addEventListener(
        "click",
        () => {
          nightList.classList.add("is-open");
          more.setAttribute("aria-expanded", "true");
          more.hidden = true;
          nightList.focus({ preventScroll: true });
          ScrollTrigger.refresh();
        },
        { signal: off.signal },
      );
    }

    if (reduce) {
      return () => {
        off.abort();
        ctx.revert();
        cleanups.forEach((c) => c());
      };
    }

    ctx.add(() => {
      // ── The graph: lanes draw down to the pen, forks and merges cross at it, nodes land on it. ──
      root.querySelectorAll<HTMLElement>("[data-st-lane]").forEach((lane) => {
        gsap.fromTo(
          lane,
          { clipPath: "inset(0% 0% 100% 0%)" },
          {
            clipPath: "inset(0% 0% 0% 0%)",
            ease: "none",
            scrollTrigger: { trigger: lane, start: PEN, end: PEN_END, scrub: 0.3 },
          },
        );
      });
      root.querySelectorAll<SVGSVGElement>("[data-st-path]").forEach((svg) => {
        gsap.fromTo(
          svg.querySelector("path"),
          { strokeDashoffset: 1 },
          {
            strokeDashoffset: 0,
            ease: "none",
            scrollTrigger: { trigger: svg, start: PEN, end: PEN_END, scrub: 0.3 },
          },
        );
      });
      root.querySelectorAll<HTMLElement>("[data-st-node]").forEach((node) => {
        gsap.fromTo(
          node,
          { scale: 0 },
          {
            scale: 1,
            duration: 0.5,
            ease: ease.out,
            scrollTrigger: { trigger: node, start: PEN, toggleActions: "play none none reverse" },
          },
        );
      });

      root.querySelectorAll<HTMLElement>("[data-st-tag]").forEach((tag) => {
        gsap.fromTo(
          tag,
          { autoAlpha: 0 },
          {
            autoAlpha: 1,
            duration: 0.6,
            ease: ease.out,
            scrollTrigger: { trigger: tag, start: PEN, toggleActions: "play none none reverse" },
          },
        );
      });

      // ── The first commits: each message types itself as its row comes up the screen, and its
      // dot lands on Mike's lane when the pen gets there. ──
      root.querySelectorAll<HTMLElement>("[data-st-commit]").forEach((row) => {
        const dot = row.querySelector<HTMLElement>("[data-st-dot]")!;
        const msg = row.querySelector<HTMLElement>("[data-st-type]")!;
        const tl = gsap.timeline({
          scrollTrigger: { trigger: row, start: "top bottom", once: true },
        });
        const { split } = typer(msg, 40, 0.6, tl, 0.15);
        cleanups.push(() => split.revert());
        gsap.fromTo(
          dot,
          { scale: 0 },
          {
            scale: 1,
            duration: 0.4,
            ease: ease.out,
            scrollTrigger: { trigger: row, start: PEN, toggleActions: "play none none reverse" },
          },
        );
      });

      // ── The gap: one dash a day lights up down the lane, and the count keeps up with it. ──
      const gap = root.querySelector<HTMLElement>("[data-st-gap]");
      if (gap) {
        const lit = gap.querySelector<HTMLElement>("[data-st-days]")!;
        const count = gap.querySelector<HTMLElement>("[data-st-count]")!;
        const days = Number(count.textContent);
        const state = { p: 0 };
        const draw = () => {
          lit.style.clipPath = `inset(0 0 ${((1 - state.p) * 100).toFixed(2)}% 0)`;
          count.textContent = String(Math.max(1, Math.round(state.p * days)));
        };
        draw();
        gsap.to(state, {
          p: 1,
          ease: "none",
          onUpdate: draw,
          scrollTrigger: { trigger: gap, start: PEN, end: PEN_END, scrub: 0.3 },
        });
      }

      // ── What it wrote: the centre line draws down to the pen, a node lands on each row and the
      // row's two lines arrive from the centre outward. ──
      const wr = root.querySelector<HTMLElement>("[data-wr]");
      if (wr) {
        const spine = wr.querySelector<HTMLElement>("[data-wr-spine]")!;
        gsap.fromTo(
          spine,
          { clipPath: "inset(0% 0% 100% 0%)" },
          {
            clipPath: "inset(0% 0% 0% 0%)",
            ease: "none",
            scrollTrigger: { trigger: spine, start: PEN, end: PEN_END, scrub: 0.3 },
          },
        );
        wr.querySelectorAll<HTMLElement>("[data-wr-node]").forEach((node) => {
          gsap.fromTo(
            node,
            { scale: 0 },
            {
              scale: 1,
              duration: 0.5,
              ease: ease.out,
              scrollTrigger: { trigger: node, start: PEN, toggleActions: "play none none reverse" },
            },
          );
        });
        wr.querySelectorAll<HTMLElement>("[data-wr-item]").forEach((item) => {
          const out = item.closest(".is-mike") ? -16 : 16;
          gsap.fromTo(
            item,
            { autoAlpha: 0, x: -out },
            {
              autoAlpha: 1,
              x: 0,
              duration: 0.8,
              ease: ease.out,
              scrollTrigger: { trigger: item, start: "top 90%", once: true },
            },
          );
        });
      }

      // ── 11 May: the night's commits land one after another, as fast as they did. ──
      const nightLog = root.querySelector<HTMLElement>("[data-st-night]");
      if (nightLog) {
        gsap.fromTo(
          nightLog.children,
          { autoAlpha: 0, x: -10 },
          {
            autoAlpha: 1,
            x: 0,
            duration: 0.4,
            ease: ease.out,
            stagger: 0.035,
            scrollTrigger: { trigger: nightLog, start: "top 85%", once: true },
          },
        );
      }
    });

    return () => {
      off.abort();
      ctx.revert();
      cleanups.forEach((c) => c());
    };
  });
}
