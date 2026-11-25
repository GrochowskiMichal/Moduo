// The login page's driver (pages/login.astro). The specimen: lib/specimen.ts casts Moduo's mark
// as a solid, and this reads each cell out as a glyph on a canvas, 30 frames a second like
// footage, on the GSAP ticker and paused off screen. One number, u (where the cycle of sway and
// spin is), carries the pose; the visitor's drag turns it further and lets it come back round,
// and a valid address in the form pulls it to the nearest front and lowers the threshold so the whole mark lights ("LOCKED"). Continuing lights
// it fully, then hands the address to the app. Under reduced motion nothing turns by itself:
// one frame, drawn again when you drag or type.
import { gsap } from "gsap";

import { login } from "../../data/site";
import { onPage, prefersReducedMotion } from "../../engine";
import { MARK } from "../../lib/brand";
import {
  cast,
  distanceField,
  EMPTY,
  FACE,
  type Field,
  FPS,
  frontOf,
  type Grid,
  hash,
  HOLD,
  MARK_BOX,
  readout,
  SPIN_AT,
  THR,
  turn,
  TURN_S,
} from "../../lib/specimen";
import { EMAIL_RE } from "../../lib/waitlist";

/** Field pixels per mark unit, the field's margin, and the solid's depth (110 mark units). */
const K = 0.5;
const PAD = 20;
const DEPTH = 110 * K;
/** Letters cut out of the lit boxes: the name's, a zero, and the stroke's slash. */
const GLYPHS = "0OMDUXS#=/";
const G = GLYPHS.length;
/** Brightness steps of the lit boxes, and of the small marks under the threshold. */
const LEVELS = 6;
const MARKS = 4;
/** The first frame: turned a little, the first spin some six seconds in. Under reduced motion,
 *  the one frame: turned enough to show the depth. */
const START = 0.4;
const STILL = 0.2;
const TAU = 2 * Math.PI;
const wholeTurn = (a: number) => Math.round(a / TAU) * TAU;

let field: Field | null = null;
/** The mark's distance field, rasterized once from the artwork (lib/brand.ts). */
function markField(): Field {
  if (field) return field;
  const w = Math.round(MARK_BOX.w * K) + 2 * PAD;
  const h = Math.round(MARK_BOX.h * K) + 2 * PAD;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.translate(PAD, PAD);
  x.scale(K, K);
  x.translate(-MARK_BOX.x, -MARK_BOX.y);
  x.fill(new Path2D(MARK.d), "evenodd");
  const px = x.getImageData(0, 0, w, h).data;
  const inside = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) inside[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
  field = distanceField(inside, w, h);
  return field;
}

type Atlas = { canvas: HTMLCanvasElement; tw: number; th: number };

/** Every tile a cell can show, drawn once per cell size: lit boxes by level and letter, then
 *  the small marks. The letters are cut out, so the ground shows through them. */
function buildAtlas(cellW: number, cellH: number, dpr: number, ink: string): Atlas {
  const tw = Math.round(cellW * dpr);
  const th = Math.round(cellH * dpr);
  const gap = Math.max(1, Math.round(dpr));
  const canvas = document.createElement("canvas");
  canvas.width = tw * G;
  canvas.height = th * (LEVELS + 1);
  const x = canvas.getContext("2d")!;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.font = `600 ${Math.round(th * 0.72)}px "Geist Mono", ui-monospace, monospace`;
  const bw = tw - gap;
  const bh = th - gap;
  for (let l = 0; l < LEVELS; l++) {
    for (let g = 0; g < G; g++) {
      const ox = g * tw;
      const oy = l * th;
      x.globalCompositeOperation = "source-over";
      x.globalAlpha = 0.3 + 0.7 * (l / (LEVELS - 1));
      x.fillStyle = ink;
      x.beginPath();
      x.roundRect(ox, oy, bw, bh, Math.min(2 * dpr, bw / 4));
      x.fill();
      x.globalCompositeOperation = "destination-out";
      x.globalAlpha = 1;
      x.fillText(GLYPHS[g], ox + bw / 2, oy + bh / 2 + th * 0.04);
    }
  }
  x.globalCompositeOperation = "source-over";
  x.fillStyle = ink;
  const oy = LEVELS * th;
  for (let m = 0; m < MARKS; m++) {
    const ox = m * tw;
    const cx = ox + bw / 2;
    const cy = oy + bh / 2;
    // A dot, two small squares, then a dim box: the walls and the dark side, quieter than any
    // lit cell.
    x.globalAlpha = 0.26 + 0.06 * m;
    if (m < 3) {
      const s = Math.round((m + 1) * dpr);
      x.fillRect(Math.round(cx - s / 2), Math.round(cy - s / 2), s, s);
    } else {
      x.beginPath();
      x.roundRect(ox + bw * 0.22, oy + bh * 0.22, bw * 0.56, bh * 0.56, dpr);
      x.fill();
    }
  }
  x.globalAlpha = 1;
  return { canvas, tw, th };
}

export function startLogin() {
  onPage(() => {
    const root = document.querySelector<HTMLElement>('[data-pg="login"]');
    const spec = root?.querySelector<HTMLElement>("[data-spec]");
    const cv = spec?.querySelector<HTMLCanvasElement>(".spec__cv");
    const form = root?.querySelector<HTMLFormElement>("[data-li-form]");
    const ctx = cv?.getContext("2d");
    if (!root || !spec || !cv || !form || !ctx) return;
    const input = form.querySelector<HTMLInputElement>('input[name="email"]')!;
    const msg = form.querySelector<HTMLElement>(".li__msg")!;
    const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const hud = {
      cycle: spec.querySelector<HTMLElement>('[data-hud="cycle"]'),
      what: spec.querySelector<HTMLElement>('[data-hud="what"]'),
      frame: spec.querySelector<HTMLElement>('[data-hud="frame"]'),
      thr: spec.querySelector<HTMLElement>('[data-hud="thr"]'),
      grid: spec.querySelector<HTMLElement>('[data-hud="grid"]'),
      pose: spec.querySelector<HTMLElement>('[data-hud="pose"]'),
    };
    const reduce = prefersReducedMotion();
    const ink = getComputedStyle(spec).color || "#fafafa";
    const F = markField();

    // Layout, refreshed on resize.
    let W = 1;
    let H = 1;
    let dpr = 1;
    let gx0 = 0;
    let gy0 = 0;
    const g: Grid = { cols: 1, rows: 1, cellW: 9, cellH: 11, ox: 0, oy: 0, scale: 1 };
    let lum = new Float32Array(1);
    let kind = new Uint8Array(1);
    let glyph = new Uint8Array(1);
    let shown = new Int16Array(1);
    let atlas: Atlas | null = null;
    // Dust in the ground, drifting up.
    const dust = Array.from({ length: 64 }, (_, i) => ({
      x: hash(i, 1),
      y: hash(i, 2),
      vx: (hash(i, 3) - 0.5) * 0.002,
      vy: -0.001 - hash(i, 4) * 0.003,
      a: 0.08 + hash(i, 5) * 0.32,
      s: hash(i, 6) < 0.85 ? 1 : 2,
      f: 0.3 + hash(i, 7) * 0.9,
      ph: hash(i, 8) * 6.3,
    }));

    const measure = () => {
      const r = cv.getBoundingClientRect();
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      const cellW = Math.max(6, Math.min(10, Math.round(W / 78)));
      const cellH = Math.round(cellW * 1.25);
      const cols = Math.floor(W / cellW);
      const rows = Math.floor(H / cellH);
      gx0 = Math.round((W - cols * cellW) / 2);
      gy0 = Math.round((H - rows * cellH) / 2);
      // A short band (phones) keeps the mark clear of the readout above it.
      const band = H < 520;
      const scale = Math.min(
        (W * 0.78) / (MARK_BOX.w * K),
        (H * (band ? 0.58 : 0.56)) / (MARK_BOX.h * K),
      );
      const oy = H * (band ? 0.58 : 0.5);
      Object.assign(g, { cols, rows, cellW, cellH, ox: W / 2 - gx0, oy: oy - gy0, scale });
      const n = cols * rows;
      if (lum.length !== n) {
        lum = new Float32Array(n);
        kind = new Uint8Array(n);
        glyph = new Uint8Array(n);
        shown = new Int16Array(n).fill(-1);
        for (let k = 0; k < n; k++) glyph[k] = (hash(k, 11) * G) | 0;
      }
      atlas = buildAtlas(cellW, cellH, dpr, ink);
    };

    // Live state: the turn, the drag's carry, the pull to the front, the last flash, the
    // first frames' development, and a stir from typing.
    const st = {
      u: reduce ? STILL : START,
      drag: 0,
      dvel: 0,
      lock: 0,
      flash: 0,
      intro: reduce ? 1 : 0,
      kick: 0,
    };
    let locked = false;
    let dragging = false;
    let frame = 0;
    let clock = 0;
    const said: Record<string, string> = {};
    const put = (key: keyof typeof hud, text: string) => {
      const el = hud[key];
      if (!el || said[key] === text) return;
      said[key] = text;
      el.textContent = text;
    };

    const draw = () => {
      if (!atlas) return;
      const yaw = turn(st.u) + st.drag;
      const pitch =
        (0.08 + (reduce ? 0 : 0.03 * Math.sin((clock * 2 * Math.PI) / 19))) * (1 - 0.6 * st.lock);
      const pose = { yaw, pitch };
      cast(F, DEPTH, pose, g, lum, kind);
      // The threshold: high while the footage develops, lower as the mark locks, lowest as it
      // hands you over (every cell of the solid lit).
      const thr = Math.max(
        0.06,
        THR + (1.02 - THR) * (1 - st.intro) - 0.2 * st.lock - 0.4 * st.flash,
      );

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = ink;
      for (const p of dust) {
        const tw = 0.55 + 0.45 * Math.sin(clock * p.f + p.ph);
        ctx.globalAlpha = p.a * tw * st.intro;
        const s = Math.round(p.s * dpr);
        ctx.fillRect(Math.round(p.x * W * dpr), Math.round(p.y * H * dpr), s, s);
      }
      ctx.globalAlpha = 1;

      const { canvas: A, tw, th } = atlas;
      const reroll = !reduce;
      let drawn = 0;
      let moved = 0;
      for (let k = 0; k < kind.length; k++) {
        if (kind[k] === EMPTY) {
          shown[k] = -1;
          continue;
        }
        // Each cell keeps its letter for HOLD frames, on its own phase; typing stirs more.
        if (reroll) {
          const due = (frame + ((hash(k, 7) * HOLD) | 0)) % HOLD === 0 && hash(k, frame) < 0.3;
          if (due || hash(k, frame + 7919) < st.kick * 0.08)
            glyph[k] = (hash(k, frame * 31 + 5) * G) | 0;
        }
        const L = lum[k];
        // Walls stay small marks unless the whole solid lights on the way out.
        const lit = kind[k] === FACE ? L >= thr : L >= thr + 0.34 * (1 - st.flash);
        const tile = lit
          ? Math.min(LEVELS - 1, (((L - thr) / (1.0001 - thr)) * LEVELS) | 0) * G + glyph[k]
          : LEVELS * G + Math.min(MARKS - 1, ((L / thr) * MARKS) | 0);
        drawn++;
        if (tile !== shown[k]) moved++;
        shown[k] = tile;
        const i = k % g.cols;
        const j = (k / g.cols) | 0;
        ctx.drawImage(
          A,
          (tile % G) * tw,
          ((tile / G) | 0) * th,
          tw,
          th,
          Math.round((gx0 + i * g.cellW) * dpr),
          Math.round((gy0 + j * g.cellH) * dpr),
          tw,
          th,
        );
      }

      const lines = readout({
        phase:
          st.lock > 0.95
            ? "locked"
            : dragging || Math.abs(st.dvel) > 0.8
              ? "drag"
              : st.u - Math.floor(st.u) >= SPIN_AT
                ? "spin"
                : "sway",
        at: st.u,
        thr,
        move: drawn ? moved / drawn : 0,
        cols: g.cols,
        rows: g.rows,
        yaw,
        pitch,
      });
      put("cycle", lines.cycle);
      put("what", lines.what);
      put("frame", lines.frame);
      put("thr", lines.thr);
      put("grid", lines.grid);
      put("pose", lines.pose);
    };

    measure();
    draw();
    spec.classList.add("is-live");
    // The letters are Geist Mono: cut the tiles again once it has loaded.
    void document.fonts?.load(`600 12px "Geist Mono"`).then(() => {
      measure();
      draw();
    });
    const ro = new ResizeObserver(() => {
      measure();
      draw();
    });
    ro.observe(spec);

    let visible = true;
    const io = new IntersectionObserver((es) => (visible = es[0].isIntersecting), { threshold: 0 });
    io.observe(spec);
    let acc = 0;
    const tick = (_time: number, deltaMs: number) => {
      if (!visible) return;
      const dt = Math.min(deltaMs / 1000, 0.1);
      clock += dt;
      for (const p of dust) {
        p.x = (p.x + p.vx * dt + 1) % 1;
        p.y = (p.y + p.vy * dt + 1) % 1;
      }
      st.lock += ((locked ? 1 : 0) - st.lock) * (1 - Math.exp(-dt * 2.4));
      st.kick *= Math.exp(-dt * 3);
      if (!dragging) {
        st.u += (dt * (1 - st.lock)) / TURN_S;
        // A drag's turn carries, then comes back round to the cycle's own front.
        st.drag += st.dvel * dt;
        st.dvel *= Math.exp(-dt / 0.9);
        if (Math.abs(st.dvel) < 0.8)
          st.drag += (wholeTurn(st.drag) - st.drag) * (1 - Math.exp(-dt * 0.8));
        // Locked: pulled to the nearest front, where the mark reads the right way round.
        if (st.lock > 0.01) st.u += (frontOf(st.u) - st.u) * (1 - Math.exp(-dt * 2)) * st.lock;
      }
      // The footage advances in whole frames.
      acc += dt;
      if (acc < 1 / FPS - 0.004) return;
      acc = Math.min(acc - 1 / FPS, 1 / FPS);
      frame++;
      draw();
    };
    if (!reduce) {
      gsap.ticker.add(tick);
      gsap.to(st, { intro: 1, duration: 1.8, ease: "power2.out", delay: 0.15 });
    }

    // Drag to turn: the pointer carries the turn, and lets go with its speed.
    const off = new AbortController();
    const opt = { signal: off.signal };
    let lastX = 0;
    let lastT = 0;
    let dragV = 0;
    spec.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button !== 0) return;
        dragging = true;
        spec.setPointerCapture(e.pointerId);
        spec.classList.add("is-dragging");
        lastX = e.clientX;
        lastT = performance.now();
        dragV = 0;
        st.dvel = 0;
      },
      opt,
    );
    spec.addEventListener(
      "pointermove",
      (e) => {
        if (!dragging) return;
        const now = performance.now();
        const da = ((e.clientX - lastX) / W) * TAU * 0.45;
        const v = da / Math.max(0.008, (now - lastT) / 1000);
        dragV = dragV * 0.6 + v * 0.4;
        st.drag += da;
        st.kick = Math.min(1, st.kick + Math.abs(da) * 0.6);
        lastX = e.clientX;
        lastT = now;
        if (reduce) draw();
      },
      opt,
    );
    const release = () => {
      if (!dragging) return;
      dragging = false;
      spec.classList.remove("is-dragging");
      // A drag that ended still carries; one that stopped before letting go doesn't.
      if (!reduce && performance.now() - lastT < 80) st.dvel = Math.max(-5, Math.min(5, dragV));
    };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      spec.addEventListener(type, release, opt);

    // The form: a valid address locks the specimen; continuing lights it and hands over.
    const setLocked = (on: boolean) => {
      if (locked === on) return;
      locked = on;
      if (reduce) {
        st.lock = on ? 1 : 0;
        st.u = on ? frontOf(st.u) : STILL;
        if (on) st.drag = wholeTurn(st.drag);
        draw();
      }
    };
    const setState = (state: "idle" | "error" | "going", text?: string) => {
      form.dataset.state = state;
      msg.textContent = text ?? msg.dataset.note ?? "";
      input.setAttribute("aria-invalid", state === "error" ? "true" : "false");
      btn.disabled = state === "going";
      btn.setAttribute("aria-busy", state === "going" ? "true" : "false");
    };
    input.addEventListener(
      "input",
      () => {
        setLocked(EMAIL_RE.test(input.value.trim()));
        st.kick = 1;
        if (form.dataset.state === "error") setState("idle");
      },
      opt,
    );
    form.addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        const email = input.value.trim().toLowerCase();
        if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
          setState("error", email ? login.errors.invalid : login.errors.empty);
          input.focus();
          return;
        }
        const url = new URL(form.action);
        url.searchParams.set("email", email);
        setState("going", login.going);
        setLocked(true);
        if (reduce) return location.assign(url.href);
        gsap.to(st, {
          flash: 1,
          duration: 0.45,
          ease: "power2.in",
          onComplete: () => location.assign(url.href),
        });
      },
      opt,
    );
    // Back from the app (the page restored from the cache): ready again.
    addEventListener(
      "pageshow",
      (e) => {
        if (!e.persisted) return;
        gsap.killTweensOf(st, "flash");
        st.flash = 0;
        setState("idle");
        setLocked(EMAIL_RE.test(input.value.trim()));
      },
      opt,
    );

    return () => {
      off.abort();
      ro.disconnect();
      io.disconnect();
      gsap.ticker.remove(tick);
      gsap.killTweensOf(st);
      spec.classList.remove("is-live", "is-dragging");
    };
  });
}
