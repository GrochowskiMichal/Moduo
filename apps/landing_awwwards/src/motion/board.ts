// Home, the page you arrange (components/home/Board.astro). One model, the widgets' spots on the
// grid, drives everything: a widget moves by its name and resizes by its corner, the ones in its
// way part downwards to make room and come back when it moves on (each step is worked out from
// the layout as it was when the hand went down), and every change plays as a FLIP: each card
// slides and grows from where it was to where it lands, its content held at its new size inside.
// Layouts set the whole board at once; the shelf adds a widget into the first free spot. On first
// sight a hand shows it once: a widget added, pulled bigger, two layouts. Live details tick on
// the one clock while the board is on screen. Reduced motion: no hand, no ticking, every change
// instant.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { ease, onPage, prefersReducedMotion } from "../engine";

type Spot = [string, number, number, number, number];
type Item = { id: string; x: number; y: number; w: number; h: number };
interface Config {
  layouts: Record<string, { d: Spot[]; m: Spot[] }>;
  sizes: Record<string, [number, number]>;
  names: Record<string, string>;
}
type Face = { x: number; y: number; sx: number; sy: number };

const R = 12; // the card's radius, kept round while it scales
const MAX_H = 4;
const hit = (a: Item, b: Item) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const toItems = (spots: Spot[]): Item[] => spots.map(([id, x, y, w, h]) => ({ id, x, y, w, h }));
const bottom = (items: Item[]) => items.reduce((m, i) => Math.max(m, i.y + i.h), 0);

/** Cards in the way step down, and whatever they then cover steps down after them. */
function pushDown(items: Item[], fixed: Item): Item[] {
  const placed: Item[] = [{ ...fixed }];
  const rest = items
    .filter((i) => i.id !== fixed.id)
    .map((i) => ({ ...i }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  for (const it of rest) {
    while (placed.some((p) => hit(p, it))) it.y++;
    placed.push(it);
  }
  return placed;
}

/** Cards in the way go to the nearest free spot (the app's greedy nearest-free); the rest stay. */
function nearest(items: Item[], fixed: Item, cols: number): Item[] {
  const others = items.filter((i) => i.id !== fixed.id).map((i) => ({ ...i }));
  const placed: Item[] = [{ ...fixed }, ...others.filter((i) => !hit(i, fixed))];
  const moving = others.filter((i) => hit(i, fixed)).sort((a, b) => a.y - b.y || a.x - b.x);
  const limit = bottom([...items, fixed]) + 4;
  for (const it of moving) {
    let best: Item | null = null;
    let cost = Infinity;
    for (let y = 0; y <= limit; y++) {
      for (let x = 0; x + it.w <= cols; x++) {
        const probe = { ...it, x, y };
        if (placed.some((p) => hit(p, probe))) continue;
        const c = travel(it, probe);
        if (c < cost) {
          cost = c;
          best = probe;
        }
      }
    }
    placed.push(best ?? { ...it, y: limit });
  }
  return placed;
}

// A step down costs more than a step along the row, so cards part sideways when they can.
const travel = (a: Item, b: Item) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y) * 1.6;

/**
 * The fixed widget keeps its spot and the others make room, whichever way moves them least:
 * stepping down together, or each to its nearest free spot. A board that grows costs extra.
 */
function settle(items: Item[], fixed: Item, cols: number): Item[] {
  const was = new Map(items.map((i) => [i.id, i]));
  const cost = (out: Item[]) =>
    out.reduce((sum, i) => sum + (i.id === fixed.id ? 0 : travel(was.get(i.id)!, i)), 0) +
    Math.max(0, bottom(out) - bottom(items)) * 2;
  const a = pushDown(items, fixed);
  const b = nearest(items, fixed, cols);
  return cost(b) < cost(a) ? b : a;
}

function firstFree(items: Item[], w: number, h: number, cols: number): { x: number; y: number } {
  for (let y = 0; y < bottom(items) + 1; y++) {
    for (let x = 0; x + w <= cols; x++) {
      const probe = { id: "", x, y, w, h };
      if (!items.some((i) => hit(i, probe))) return { x, y };
    }
  }
  return { x: 0, y: bottom(items) };
}

const hhmm = (d: Date, timeZone?: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(d);

export function startBoard() {
  onPage(() => {
    const root = document.querySelector<HTMLElement>("[data-board]");
    const grid = root?.querySelector<HTMLElement>("[data-board-grid]");
    if (!root || !grid) return;
    const board: HTMLElement = grid;
    const win = board.closest<HTMLElement>(".hb__win")!;
    const cfg = JSON.parse(board.dataset.config!) as Config;
    const reduced = prefersReducedMotion();
    const dur = reduced ? 0 : 0.55;
    const phone = matchMedia("(max-width: 999px)");
    const els = new Map<string, HTMLElement>();
    board.querySelectorAll<HTMLElement>("[data-wg]").forEach((el) => els.set(el.dataset.wg!, el));
    const shelf = new Map<string, HTMLElement>();
    root
      .querySelectorAll<HTMLElement>("[data-shelf]")
      .forEach((li) => shelf.set(li.dataset.shelf!, li));
    const slot = board.querySelector<HTMLElement>("[data-board-slot]")!;
    const readout = board.querySelector<HTMLElement>("[data-board-readout]")!;
    const sizeLabel = root.querySelector<HTMLElement>("[data-board-size]");
    const live = root.querySelector<HTMLElement>("[data-board-live]")!;
    const empty = root.querySelector<HTMLElement>("[data-board-empty]")!;
    const hand = root.querySelector<SVGElement>("[data-board-hand]")!;
    const presets = [...root.querySelectorAll<HTMLButtonElement>("[data-preset]")];
    const offs: Array<() => void> = [];
    const on = <K extends keyof HTMLElementEventMap>(
      t: EventTarget,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      t.addEventListener(type, fn as EventListener, opts);
      offs.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };

    let cols = phone.matches ? 4 : 8;
    let preset = "monday";
    let minRows = 0;
    let items: Item[] = [];
    const faces = new Map<string, Face>();
    const tweens = new Map<string, gsap.core.Tween>();

    // The CSS still picture gives way to the model: what isn't on this board is hidden first, so
    // nothing flashes into the grid's free cells.
    {
      const first = new Set(cfg.layouts[preset][cols === 8 ? "d" : "m"].map((s) => s[0]));
      els.forEach((el, id) => {
        el.hidden = !first.has(id);
        el.classList.remove("is-off-d", "is-off-m");
      });
      shelf.forEach((li, id) => {
        li.hidden = first.has(id);
        li.classList.remove("is-on-d", "is-on-m");
      });
    }

    const draw = (el: HTMLElement, f: Face) => {
      const inner = el.firstElementChild as HTMLElement;
      const still = f.x === 0 && f.y === 0 && f.sx === 1 && f.sy === 1;
      el.style.transform = still ? "" : `translate(${f.x}px, ${f.y}px) scale(${f.sx}, ${f.sy})`;
      inner.style.transform = f.sx === 1 && f.sy === 1 ? "" : `scale(${1 / f.sx}, ${1 / f.sy})`;
      el.style.borderRadius = f.sx === 1 && f.sy === 1 ? "" : `${R / f.sx}px / ${R / f.sy}px`;
    };
    const face = (id: string) => {
      let f = faces.get(id);
      if (!f) faces.set(id, (f = { x: 0, y: 0, sx: 1, sy: 1 }));
      return f;
    };
    const still = (id: string) => {
      tweens.get(id)?.kill();
      const f = face(id);
      Object.assign(f, { x: 0, y: 0, sx: 1, sy: 1 });
      draw(els.get(id)!, f);
    };
    /** Plays a card from one rect to the one it has now. */
    const flip = (id: string, from: DOMRect, to: DOMRect, d = dur, fade = false, delay = 0) => {
      const el = els.get(id)!;
      const f = face(id);
      tweens.get(id)?.kill();
      Object.assign(f, {
        x: from.left - to.left,
        y: from.top - to.top,
        sx: from.width / Math.max(1, to.width),
        sy: from.height / Math.max(1, to.height),
      });
      if (!d) return still(id);
      draw(el, f);
      if (fade)
        gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: d * 0.6, delay, ease: ease.out });
      tweens.set(
        id,
        gsap.to(f, {
          x: 0,
          y: 0,
          sx: 1,
          sy: 1,
          duration: d,
          delay,
          ease: ease.out,
          onUpdate: () => draw(el, f),
        }),
      );
    };

    const area = (i: Item) => `${i.y + 1} / ${i.x + 1} / span ${i.h} / span ${i.w}`;
    const label = (i: Item) =>
      `${cfg.names[i.id]}, ${i.w} by ${i.h}, column ${i.x + 1}, row ${i.y + 1}`;
    const say = (text: string) => (live.textContent = text);

    /** Lays the model on the grid and plays every change. `held` follows the hand instead. */
    function apply(
      next: Item[],
      opts: { held?: string; from?: Partial<Record<string, DOMRect>>; stagger?: number } = {},
    ) {
      const before = new Map<string, DOMRect>();
      els.forEach((el, id) => {
        if (!el.hidden) before.set(id, el.getBoundingClientRect());
      });
      const ids = new Set(next.map((i) => i.id));
      const rows = Math.max(minRows, bottom(next));
      board.style.setProperty("--rows", String(rows));
      if (sizeLabel) sizeLabel.textContent = `${cols} × ${rows}`;
      // Leaving: lifted out of the grid where it was, it fades, then goes.
      const boardBox = board.getBoundingClientRect();
      els.forEach((el, id) => {
        if (ids.has(id) || el.hidden) return;
        const r = before.get(id)!;
        tweens.get(id)?.kill();
        gsap.killTweensOf(el);
        if (!dur) {
          el.hidden = true;
          return;
        }
        Object.assign(el.style, {
          position: "absolute",
          left: `${r.left - boardBox.left}px`,
          top: `${r.top - boardBox.top}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
          gridArea: "auto",
        });
        gsap.to(el, {
          opacity: 0,
          scale: 0.94,
          duration: 0.22,
          ease: ease.out,
          onComplete: () => {
            el.hidden = true;
            gsap.set(el, { clearProps: "opacity,scale,transform" });
            Object.assign(el.style, { position: "", left: "", top: "", width: "", height: "" });
          },
        });
      });
      for (const i of next) {
        const el = els.get(i.id)!;
        if (el.style.position === "absolute") {
          // It was on its way out and is wanted back.
          gsap.killTweensOf(el);
          gsap.set(el, { clearProps: "opacity,scale,transform" });
          Object.assign(el.style, { position: "", left: "", top: "", width: "", height: "" });
          before.delete(i.id);
        }
        el.hidden = false;
        el.style.gridArea = area(i);
        el.setAttribute("aria-label", label(i));
        if (i.id !== opts.held) {
          tweens.get(i.id)?.kill();
          el.style.transform = "";
          (el.firstElementChild as HTMLElement).style.transform = "";
        }
      }
      shelf.forEach((li, id) => (li.hidden = ids.has(id)));
      empty.hidden = ids.size < els.size;
      // In reading order, so a whole layout settles row by row.
      const order = next.filter((i) => i.id !== opts.held).sort((a, b) => a.y - b.y || a.x - b.x);
      order.forEach((i, n) => {
        const el = els.get(i.id)!;
        const to = el.getBoundingClientRect();
        const from = before.get(i.id) ?? opts.from?.[i.id];
        const delay = (opts.stagger ?? 0) * n;
        if (from) {
          const moved =
            Math.abs(from.left - to.left) +
              Math.abs(from.top - to.top) +
              Math.abs(from.width - to.width) +
              Math.abs(from.height - to.height) >
            1;
          if (moved || !before.has(i.id)) flip(i.id, from, to, dur, !before.has(i.id), delay);
        } else if (dur) {
          // Arriving with a layout: it opens out of its own spot.
          const r = new DOMRect(
            to.left + to.width * 0.04,
            to.top + to.height * 0.04,
            to.width * 0.92,
            to.height * 0.92,
          );
          flip(i.id, r, to, dur, true, delay + 0.08);
        }
      });
      items = next;
      drawMarks();
    }

    function setPreset(id: string, announce = true) {
      preset = id;
      presets.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === id)));
      const next = toItems(cfg.layouts[id][cols === 8 ? "d" : "m"]);
      minRows = bottom(next);
      apply(next, { stagger: 0.035 });
      if (announce)
        say(`${presets.find((b) => b.dataset.preset === id)?.textContent?.trim()} layout`);
    }

    function add(id: string, focus = false) {
      if (items.some((i) => i.id === id)) return;
      const [dw, dh] = cfg.sizes[id];
      const w = cols === 8 ? dw : dw >= 3 ? 4 : 2;
      const h = dh;
      const spot = firstFree(items, w, h, cols);
      const from = shelf.get(id)?.getBoundingClientRect();
      apply([...items, { id, ...spot, w, h }], { from: from ? { [id]: from } : {} });
      say(`${cfg.names[id]} added. ${label(items.find((i) => i.id === id)!)}`);
      if (focus) els.get(id)!.focus({ preventScroll: true });
    }

    function remove(id: string) {
      const it = items.find((i) => i.id === id);
      if (!it) return;
      apply(items.filter((i) => i.id !== id));
      say(`${cfg.names[id]} removed`);
    }

    /** A step from the keys or the hand: the widget takes the spot, the rest make room. */
    function place(target: Item) {
      apply(settle(items, target, cols));
    }

    // ── The marks: a plus at every corner of the grid's cells. ────────────────────────────
    const marks = [...board.querySelectorAll<SVGSVGElement>("[data-board-marks]")];
    let metrics = { left: 0, top: 0, stepX: 0, stepY: 0, gap: 0 };
    function measure() {
      const cs = getComputedStyle(board);
      const box = board.getBoundingClientRect();
      const padL = parseFloat(cs.paddingLeft);
      const padT = parseFloat(cs.paddingTop);
      const gap = parseFloat(cs.columnGap) || 0;
      const colW = (box.width - padL * 2 - gap * (cols - 1)) / cols;
      const rowH = parseFloat(cs.gridTemplateRows.split(" ")[0]) || 0;
      metrics = {
        left: box.left + padL,
        top: box.top + padT,
        stepX: colW + gap,
        stepY: rowH + gap,
        gap,
      };
      return metrics;
    }
    function drawMarks() {
      const m = measure();
      const box = board.getBoundingClientRect();
      const rows = Math.max(minRows, bottom(items));
      let d = "";
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          const x = m.left - box.left + c * m.stepX - m.gap / 2;
          const y = m.top - box.top + r * m.stepY - m.gap / 2;
          d += `M${(x - 3.5).toFixed(1)} ${y.toFixed(1)}h7M${x.toFixed(1)} ${(y - 3.5).toFixed(1)}v7`;
        }
      }
      marks.forEach((svg) => {
        let path = svg.firstElementChild;
        if (!path) {
          path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("stroke", "currentColor");
          path.setAttribute("fill", "none");
          svg.append(path);
        }
        path.setAttribute("d", d);
      });
    }

    // ── Hands on: move by the name, resize by the corner. ───────────────────────────────
    type Drag = {
      mode: "move" | "size";
      id: string;
      el: HTMLElement;
      pid: number;
      base: Item[];
      start: Item;
      gx: number;
      gy: number;
      ox: number;
      oy: number;
      key: string;
      cur: Item;
    };
    let drag: Drag | null = null;

    const showSlot = (i: Item) => {
      slot.style.gridArea = area(i);
      readout.textContent = `${i.w} × ${i.h}`;
    };

    function begin(e: PointerEvent, mode: Drag["mode"], el: HTMLElement) {
      if (e.button !== 0 || drag) return;
      stopDemo();
      const id = el.dataset.wg!;
      const start = items.find((i) => i.id === id);
      if (!start) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const r = el.getBoundingClientRect();
      measure();
      drag = {
        mode,
        id,
        el,
        pid: e.pointerId,
        base: items.map((i) => ({ ...i })),
        start: { ...start },
        gx: e.clientX - r.left,
        gy: e.clientY - r.top,
        ox: r.left,
        oy: r.top,
        key: "",
        cur: { ...start },
      };
      board.classList.add("is-editing");
      el.classList.add("is-active");
      showSlot(start);
      if (mode === "move") follow(e);
    }

    /** The held card stays under the hand while its spot changes beneath it. */
    function follow(e: PointerEvent) {
      if (!drag) return;
      const el = drag.el;
      const f = face(drag.id);
      tweens.get(drag.id)?.kill();
      el.style.transform = "";
      const home = el.getBoundingClientRect();
      Object.assign(f, {
        x: e.clientX - drag.gx - home.left,
        y: e.clientY - drag.gy - home.top,
        sx: 1,
        sy: 1,
      });
      draw(el, f);
    }

    function moveTo(e: PointerEvent) {
      if (!drag || e.pointerId !== drag.pid) return;
      const { stepX, stepY, left, top } = metrics;
      let next: Item;
      if (drag.mode === "move") {
        const x = Math.round((e.clientX - drag.gx - left) / stepX);
        const y = Math.round((e.clientY - drag.gy - top) / stepY);
        next = {
          ...drag.start,
          x: Math.max(0, Math.min(cols - drag.start.w, x)),
          y: Math.max(0, Math.min(bottom(drag.base) + 1, y)),
        };
      } else {
        const w = Math.round((e.clientX - drag.ox + metrics.gap) / stepX);
        const h = Math.round((e.clientY - drag.oy + metrics.gap) / stepY);
        next = {
          ...drag.start,
          w: Math.max(2, Math.min(cols - drag.start.x, w)),
          h: Math.max(1, Math.min(MAX_H, h)),
        };
      }
      const key = `${next.x},${next.y},${next.w},${next.h}`;
      if (key !== drag.key) {
        drag.key = key;
        drag.cur = next;
        apply(settle(drag.base, next, cols), { held: drag.mode === "move" ? drag.id : undefined });
        showSlot(next);
      }
      if (drag.mode === "move") follow(e);
    }

    function end(e: PointerEvent, cancel = false) {
      if (!drag || e.pointerId !== drag.pid) return;
      const d = drag;
      drag = null;
      board.classList.remove("is-editing");
      d.el.classList.remove("is-active");
      apply(cancel ? d.base : settle(items, d.cur, cols));
      say(
        cancel ? `${cfg.names[d.id]} back where it was` : label(items.find((i) => i.id === d.id)!),
      );
    }

    els.forEach((el) => {
      const grab = el.querySelector<HTMLElement>("[data-wg-grab]")!;
      const corner = el.querySelector<HTMLElement>("[data-wg-size]")!;
      on(grab, "pointerdown", (e) => {
        if ((e.target as Element).closest("a, button")) return;
        begin(e, "move", el);
      });
      on(corner, "pointerdown", (e) => begin(e, "size", el));
      for (const t of [grab, corner]) {
        on(t, "pointermove", moveTo);
        on(t, "pointerup", (e) => end(e));
        on(t, "pointercancel", (e) => end(e, true));
      }
      on(el.querySelector("[data-wg-remove]")!, "click", () => {
        stopDemo();
        const id = el.dataset.wg!;
        remove(id);
        shelf.get(id)?.querySelector("button")?.focus({ preventScroll: true });
      });
      on(el, "keydown", (e) => {
        if (e.target !== el) return;
        const it = items.find((i) => i.id === el.dataset.wg);
        if (!it) return;
        const k = e.key;
        if (k === "Enter") {
          el.querySelector<HTMLAnchorElement>("[data-wg-open]")?.click();
          return;
        }
        if (k === "Delete" || k === "Backspace") {
          e.preventDefault();
          stopDemo();
          remove(it.id);
          shelf.get(it.id)?.querySelector("button")?.focus({ preventScroll: true });
          return;
        }
        const dx = k === "ArrowLeft" ? -1 : k === "ArrowRight" ? 1 : 0;
        const dy = k === "ArrowUp" ? -1 : k === "ArrowDown" ? 1 : 0;
        if (!dx && !dy) return;
        e.preventDefault();
        stopDemo();
        const t = e.shiftKey
          ? {
              ...it,
              w: Math.max(2, Math.min(cols - it.x, it.w + dx)),
              h: Math.max(1, Math.min(MAX_H, it.h + dy)),
            }
          : { ...it, x: Math.max(0, Math.min(cols - it.w, it.x + dx)), y: Math.max(0, it.y + dy) };
        place(t);
        say(label(items.find((i) => i.id === it.id)!));
      });
    });
    on(board, "keydown", (e) => {
      if (e.key === "Escape" && drag)
        end(new PointerEvent("pointercancel", { pointerId: drag.pid }), true);
    });
    shelf.forEach((li, id) =>
      on(li.querySelector("button")!, "click", () => {
        stopDemo();
        add(id, true);
      }),
    );
    presets.forEach((b) =>
      on(b, "click", () => {
        stopDemo();
        setPreset(b.dataset.preset!);
      }),
    );
    on(phone, "change", () => {
      cols = phone.matches ? 4 : 8;
      stopDemo();
      dropDrag();
      faces.forEach((_, id) => still(id));
      setPreset(preset, false);
    });
    const dropDrag = () => {
      if (!drag) return;
      board.classList.remove("is-editing");
      drag.el.classList.remove("is-active");
      drag = null;
    };

    // The grid wakes under the pointer.
    on(board, "pointermove", (e) => {
      const b = board.getBoundingClientRect();
      board.style.setProperty("--mx", `${e.clientX - b.left}px`);
      board.style.setProperty("--my", `${e.clientY - b.top}px`);
    });
    const ro = new ResizeObserver(() => drawMarks());
    ro.observe(board);
    offs.push(() => ro.disconnect());

    // ── Live details, on the one clock, only while the board is on screen. ────────────────
    const focusTime = root.querySelector<HTMLElement>("[data-focus-time]");
    const focusArc = root.querySelector<SVGElement>("[data-focus-arc]");
    const here = root.querySelector<HTMLElement>("[data-clock-here]");
    const there = root.querySelector<HTMLElement>("[data-clock-there]");
    const tellTime = () => {
      const now = new Date();
      if (here) here.textContent = hhmm(now);
      if (there) there.textContent = hhmm(now, "Asia/Tokyo");
    };
    tellTime();
    const t0 = gsap.ticker.time;
    let lastSec = -1;
    const tick = () => {
      const s = Math.floor(gsap.ticker.time - t0);
      if (s === lastSec) return;
      lastSec = s;
      const total = 1082 + s; // 18:02 into a 25-minute session
      const run = total % 1500;
      if (focusTime)
        focusTime.textContent = `${Math.floor(run / 60)}:${String(run % 60).padStart(2, "0")}`;
      focusArc?.style.setProperty("--p", String((run / 1500) * 100));
      if (s % 10 === 0) tellTime();
    };
    const loops: gsap.core.Animation[] = [];
    if (!reduced) {
      const dots = root.querySelectorAll("[data-typing] i");
      if (dots.length)
        loops.push(
          gsap.to(dots, {
            opacity: 0.25,
            duration: 0.45,
            ease: ease.inOut,
            stagger: { each: 0.15, repeat: -1, yoyo: true },
          }),
        );
      const caret = root.querySelector("[data-caret]");
      if (caret)
        loops.push(
          gsap.to(caret, { opacity: 0, duration: 0.5, ease: "steps(1)", repeat: -1, yoyo: true }),
        );
      loops.forEach((l) => l.pause());
    }
    let running = false;
    const run = (yes: boolean) => {
      if (reduced || yes === running) return;
      running = yes;
      if (yes) gsap.ticker.add(tick);
      else gsap.ticker.remove(tick);
      loops.forEach((l) => (yes ? l.resume() : l.pause()));
    };
    const st = ScrollTrigger.create({
      trigger: win,
      start: "top bottom",
      end: "bottom top",
      onToggle: (self) => run(self.isActive),
    });

    // ── The hand: shown once, the first time the board is in sight. ────────────────────────
    let demo: gsap.core.Timeline | null = null;
    let touched = false;
    /** The visitor's own hand takes over: the shown one stops for good. */
    function stopDemo() {
      touched = true;
      if (!demo) return;
      demo.kill();
      demo = null;
      gsap.to(hand, { opacity: 0, duration: 0.2 });
      board.classList.remove("is-editing");
    }
    const at = (el: Element | null | undefined, fx = 0.5, fy = 0.5) => {
      const w = win.getBoundingClientRect();
      const r = el?.getBoundingClientRect();
      if (!r) return { x: w.width / 2, y: w.height / 2 };
      return { x: r.left - w.left + r.width * fx, y: r.top - w.top + r.height * fy };
    };
    const press = (tl: gsap.core.Timeline) =>
      tl.to(hand, {
        scale: 0.86,
        duration: 0.12,
        yoyo: true,
        repeat: 1,
        transformOrigin: "20% 15%",
      });
    function playDemo() {
      if (reduced || demo || touched) return;
      const tl = gsap.timeline({ onComplete: () => (demo = null) });
      demo = tl;
      const id = "habits";
      const startAt = at(board, 0.62, 0.92);
      gsap.set(hand, { x: startAt.x, y: startAt.y, opacity: 0 });
      tl.to(hand, { opacity: 1, duration: 0.3 });
      // 1. A widget from the shelf.
      tl.to(hand, {
        x: () => at(shelf.get(id), 0.3, 0.5).x,
        y: () => at(shelf.get(id), 0.3, 0.5).y,
        duration: 0.9,
        ease: ease.inOut,
      });
      press(tl);
      tl.call(() => !touched && add(id));
      // 2. Its corner, pulled down a row: it shows the whole week.
      tl.to(
        hand,
        {
          x: () => at(els.get(id), 1, 1).x - 8,
          y: () => at(els.get(id), 1, 1).y - 8,
          duration: 0.8,
          ease: ease.inOut,
        },
        "+=0.5",
      );
      tl.call(() => {
        const it = items.find((i) => i.id === id);
        if (!it) return;
        measure();
        board.classList.add("is-editing");
        showSlot(it);
      });
      tl.to(hand, { y: () => `+=${metrics.stepY}`, duration: 0.8, ease: ease.inOut });
      tl.call(
        () => {
          const it = items.find((i) => i.id === id);
          if (!it) return;
          const t = { ...it, h: it.h + 1 };
          showSlot(t);
          if (!touched) place(t);
        },
        [],
        "<0.4",
      );
      tl.call(() => board.classList.remove("is-editing"), [], "+=0.35");
      // 3. Two layouts, and back.
      const btn = (p: string) => presets.find((b) => b.dataset.preset === p);
      tl.to(
        hand,
        {
          x: () => at(btn("focus")).x,
          y: () => at(btn("focus")).y,
          duration: 0.9,
          ease: ease.inOut,
        },
        "+=0.4",
      );
      press(tl);
      tl.call(() => !touched && setPreset("focus"));
      tl.to(
        hand,
        {
          x: () => at(btn("monday")).x,
          y: () => at(btn("monday")).y,
          duration: 0.8,
          ease: ease.inOut,
        },
        "+=2.4",
      );
      press(tl);
      tl.call(() => !touched && setPreset("monday"));
      tl.to(hand, { opacity: 0, duration: 0.4 }, "+=0.6");
    }
    const demoTrigger = ScrollTrigger.create({
      trigger: board,
      start: "top 65%",
      once: true,
      onEnter: () => gsap.delayedCall(0.6, playDemo),
    });
    on(win, "pointerdown", (e) => {
      if (e.isTrusted) stopDemo();
    });

    setPreset("monday", false);
    say("");

    return () => {
      offs.forEach((off) => off());
      tweens.forEach((t) => t.kill());
      loops.forEach((l) => l.kill());
      demo?.kill();
      gsap.ticker.remove(tick);
      st.kill();
      demoTrigger.kill();
    };
  });
}
