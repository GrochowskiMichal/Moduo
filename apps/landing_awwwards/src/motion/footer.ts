import { footer } from "../data/site";
// The footer, carried over from the production landing: the wordmark plate draws itself once in
// view, then sweeps mod → duo → both; pointing at a letter shows its build and its word. The
// extruded mark leans away from the pointer.
import { onPage, prefersReducedMotion, scrollToTarget } from "../engine";

type Show = keyof typeof footer.meaning | null;

const SVG = "http://www.w3.org/2000/svg";
const LAYERS = 14;

export function startFooter() {
  onPage(() => {
    const cleanups: (() => void)[] = [];
    const reduce = prefersReducedMotion();

    const top = document.querySelector<HTMLElement>("[data-ft-top]");
    if (top) {
      const toTop = () => scrollToTarget(0);
      top.addEventListener("click", toTop);
      cleanups.push(() => top.removeEventListener("click", toTop));
    }

    const plate = document.querySelector<HTMLElement>("[data-ft-plate]");
    const word = plate?.querySelector<SVGSVGElement>(".ft-word");
    if (plate && word) cleanups.push(initPlate(plate, word, reduce));

    const ext = document.querySelector<SVGSVGElement>("[data-ft-ext]");
    const layers = ext?.querySelector<SVGGElement>("[data-ft-layers]");
    if (ext && layers) cleanups.push(initMark(ext, layers, reduce));

    return () => cleanups.forEach((c) => c());
  });
}

function initPlate(plate: HTMLElement, word: SVGSVGElement, reduce: boolean) {
  const letters = [...plate.querySelectorAll<SVGGElement>(".ft-l")];
  const legend = plate.querySelector<HTMLElement>("[data-ft-legend]");
  const timers: number[] = [];
  let io: IntersectionObserver | null = null;

  const show = (state: Show) => {
    if (state) plate.setAttribute("data-show", state);
    else plate.removeAttribute("data-show");
    if (!legend) return;
    legend.classList.toggle("is-on", !!state);
    legend.textContent = state ? footer.meaning[state] : footer.legend;
  };

  const sweep = () => {
    const seq: [Show, number][] = [
      ["mod", 1900],
      ["duo", 1900],
      ["both", 2600],
      [null, 0],
    ];
    let i = 0;
    const step = () => {
      if (plate.classList.contains("is-hovering")) return;
      show(seq[i][0]);
      i += 1;
      if (i < seq.length) timers.push(window.setTimeout(step, seq[i - 1][1]));
    };
    step();
  };

  if (reduce || !("IntersectionObserver" in window)) {
    plate.classList.add("is-drawn");
  } else {
    io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        io?.disconnect();
        plate.classList.add("is-drawn");
        // once the last letter has flooded (the outline draws, then the fill)
        timers.push(window.setTimeout(sweep, 3400));
      },
      // Start drawing as the plate comes in, so it's whole by the time the page ends.
      { threshold: 0.12 },
    );
    io.observe(plate);
  }

  const enter = (l: SVGGElement) => () => {
    plate.classList.add("is-hovering");
    letters.forEach((o) => o.classList.toggle("is-hot", o === l));
    show(l.getAttribute("data-g") as Show);
  };
  const enters = letters.map((l) => {
    const fn = enter(l);
    l.addEventListener("pointerenter", fn);
    return () => l.removeEventListener("pointerenter", fn);
  });
  const leaveWord = () => {
    plate.classList.remove("is-hovering");
    letters.forEach((o) => o.classList.remove("is-hot"));
    show(null);
  };
  word.addEventListener("pointerleave", leaveWord);

  return () => {
    io?.disconnect();
    timers.forEach(clearTimeout);
    enters.forEach((off) => off());
    word.removeEventListener("pointerleave", leaveWord);
  };
}

function initMark(ext: SVGSVGElement, layersEl: SVGGElement, reduce: boolean) {
  const readout = document.querySelector<HTMLElement>("[data-ft-depth]");
  const rest = { x: 9, y: -7 };
  const cur = { ...rest };
  const goal = { ...rest };
  let raf = 0;
  let near = false;

  layersEl.replaceChildren();
  const uses = Array.from({ length: LAYERS }, (_, n) => {
    const u = document.createElementNS(SVG, "use");
    u.setAttribute("href", "#ft-mark");
    if (n === 0) u.setAttribute("class", "is-back");
    if (n === LAYERS - 1) u.setAttribute("class", "is-front");
    layersEl.appendChild(u);
    return u;
  });

  const paint = () => {
    const half = (LAYERS - 1) / 2;
    raf = 0;
    cur.x += (goal.x - cur.x) * 0.14;
    cur.y += (goal.y - cur.y) * 0.14;
    uses.forEach((u, k) => {
      u.setAttribute(
        "transform",
        `translate(${((half - k) * cur.x).toFixed(2)} ${((half - k) * cur.y).toFixed(2)})`,
      );
    });
    if (readout) readout.textContent = `Depth ${Math.round(Math.hypot(cur.x, cur.y) * 1.2)}`;
    if (Math.abs(goal.x - cur.x) > 0.05 || Math.abs(goal.y - cur.y) > 0.05)
      raf = requestAnimationFrame(paint);
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(paint);
  };
  paint();
  if (reduce) return () => {};

  const io = new IntersectionObserver((entries) => {
    near = entries[0].isIntersecting;
  });
  io.observe(ext.closest(".ft") ?? ext);
  const clamp = (v: number) => Math.max(-14, Math.min(14, v));
  const move = (e: PointerEvent) => {
    if (!near) return;
    const r = ext.getBoundingClientRect();
    goal.x = clamp((-(e.clientX - (r.left + r.width / 2)) / innerWidth) * 26);
    goal.y = clamp((-(e.clientY - (r.top + r.height / 2)) / innerHeight) * 26);
    kick();
  };
  const home = () => {
    goal.x = rest.x;
    goal.y = rest.y;
    kick();
  };
  addEventListener("pointermove", move, { passive: true });
  document.documentElement.addEventListener("pointerleave", home);

  return () => {
    io.disconnect();
    cancelAnimationFrame(raf);
    removeEventListener("pointermove", move);
    document.documentElement.removeEventListener("pointerleave", home);
  };
}
