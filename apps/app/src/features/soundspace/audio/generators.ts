// Soundspace — one generator per sound. Each builds a small Web Audio patch into
// `out` (steady beds made of noise loops and filters) and, through `schedule`,
// keeps adding the events that make it alive: drops, crackles, chirps, waves,
// cars. Timing, pitch and level are drawn fresh every time, so a sound never
// repeats the way a looped recording does.

import type { PointSoundId } from "../catalog";
import {
  Every,
  filterNode,
  gainNode,
  glide,
  loopSource,
  type NoiseBank,
  type NoiseColor,
  pick,
  playGrain,
  playTone,
  poissonGap,
  rand,
} from "./dsp";

export interface GenEnv {
  ctx: BaseAudioContext;
  bank: NoiseBank;
  /** Everything the sound makes goes here (the voice's level, distance and place follow). */
  out: AudioNode;
}

export interface Generator {
  /** Add the events due between `now` and `until` (audio-clock seconds). */
  schedule(now: number, until: number): void;
  /** Stop every running source at `t` (after the voice has faded out). */
  stop(t: number): void;
}

type Factory = (env: GenEnv) => Generator;

/** Shared bookkeeping: the steady sources to stop, the recurring events to run. */
function patch(env: GenEnv) {
  const sources: AudioScheduledSourceNode[] = [];
  const events: Every[] = [];
  const t0 = env.ctx.currentTime;
  return {
    t0,
    loop(color: NoiseColor, rate = 1) {
      const s = loopSource(env.ctx, env.bank, color, rate);
      sources.push(s);
      return s;
    },
    osc(type: OscillatorType, freq: number) {
      const o = env.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.start();
      sources.push(o);
      return o;
    },
    every(firstIn: number, gap: () => number, fire: (t: number) => void) {
      events.push(new Every(t0 + firstIn, gap, fire));
    },
    done(): Generator {
      return {
        schedule: (now, until) => events.forEach((e) => e.run(now, until)),
        stop: (t) =>
          sources.forEach((s) => {
            try {
              s.stop(t);
            } catch {
              // already stopped
            }
          }),
      };
    },
  };
}

/** Slowly wander a gain between `lo` and `hi` so a steady bed breathes. */
function breathe(
  p: ReturnType<typeof patch>,
  g: GainNode,
  lo: number,
  hi: number,
  every: [number, number],
) {
  p.every(
    0,
    () => rand(every[0], every[1]),
    (t) => glide(g.gain, rand(lo, hi), t, rand(1.5, 4)),
  );
}

// ── Noise colours ───────────────────────────────────────────────────────────

const noise =
  (color: NoiseColor): Factory =>
  (env) => {
    const p = patch(env);
    const g = gainNode(env.ctx, 0.9);
    p.loop(color).connect(g).connect(env.out);
    breathe(p, g, 0.82, 1, [8, 16]);
    return p.done();
  };

// ── Nature ──────────────────────────────────────────────────────────────────

const rainfall: Factory = (env) => {
  const { ctx, bank, out } = env;
  const p = patch(env);
  const bed = gainNode(ctx, 0.55);
  p.loop("pink")
    .connect(filterNode(ctx, "highpass", 450))
    .connect(filterNode(ctx, "lowpass", 7500))
    .connect(bed)
    .connect(out);
  breathe(p, bed, 0.4, 0.65, [4, 9]);
  const bands = [2400, 3800, 5600, 7800].map((f) => {
    const bp = filterNode(ctx, "bandpass", f, 2.5);
    bp.connect(out);
    return bp;
  });
  let density = 18;
  p.every(
    0,
    () => rand(3, 7),
    () => (density = rand(10, 32)),
  );
  const drop = bank.grain(25, 5);
  p.every(
    0,
    () => poissonGap(density),
    (t) => playGrain(ctx, drop, pick(bands), t, rand(0.08, 0.5), rand(0.7, 1.5)),
  );
  return p.done();
};

const stream: Factory = (env) => {
  const { ctx, out } = env;
  const p = patch(env);
  const src = p.loop("white");
  const ranges: [number, number][] = [
    [260, 620],
    [720, 1500],
    [1700, 3400],
  ];
  const bands = ranges.map(([lo, hi]) => {
    const bp = filterNode(ctx, "bandpass", (lo + hi) / 2, 2.2);
    const g = gainNode(ctx, 0.5);
    src.connect(bp).connect(g).connect(out);
    return { bp, g, lo, hi };
  });
  // Babble: the resonances keep moving, like water finding its way over stones.
  p.every(
    0,
    () => rand(0.09, 0.26),
    (t) => {
      for (const b of bands) {
        glide(b.bp.frequency, rand(b.lo, b.hi), t, 0.06);
        glide(b.g.gain, rand(0.25, 0.85), t, 0.08);
      }
    },
  );
  const bubbles = gainNode(ctx, 0.7);
  bubbles.connect(out);
  p.every(
    0.4,
    () => poissonGap(rand(2, 6)),
    (t) => {
      const f = rand(480, 1500);
      playTone(ctx, bubbles, t, {
        freq: f,
        to: f * rand(1.5, 2.2),
        dur: rand(0.04, 0.09),
        level: rand(0.03, 0.12),
        attack: 0.002,
      });
    },
  );
  return p.done();
};

const pines: Factory = (env) => {
  const { ctx, out } = env;
  const p = patch(env);
  const bp = filterNode(ctx, "bandpass", 500, 0.8);
  const body = gainNode(ctx, 0.4);
  p.loop("pink").connect(bp).connect(body).connect(out);
  const hp = filterNode(ctx, "highpass", 2600);
  const needles = gainNode(ctx, 0.05);
  p.loop("white").connect(hp).connect(needles).connect(out);
  // Gusts: a strength picked every few seconds drives pitch, body and the needle hiss.
  p.every(
    0,
    () => rand(1.2, 3.8),
    (t) => {
      const s = Math.pow(Math.random(), 0.8);
      glide(bp.frequency, 280 + s * 760, t, rand(0.8, 1.6));
      glide(body.gain, 0.22 + s * 0.85, t, rand(0.9, 1.8));
      glide(needles.gain, 0.015 + s * s * 0.2, t, rand(0.7, 1.4));
    },
  );
  return p.done();
};

const crickets: Factory = (env) => {
  const { ctx, out } = env;
  const p = patch(env);
  p.loop("brown")
    .connect(filterNode(ctx, "lowpass", 320))
    .connect(gainNode(ctx, 0.06))
    .connect(out);
  const voice = gainNode(ctx, 0.5);
  voice.connect(out);
  for (let i = 0; i < 3; i++) {
    const pitch = rand(4100, 4900);
    const period = rand(0.55, 0.95);
    const pulses = Math.random() < 0.5 ? 3 : 4;
    const level = rand(0.12, 0.3);
    let restUntil = 0;
    p.every(
      rand(0, 1),
      () => period * rand(0.94, 1.06),
      (t) => {
        if (t < restUntil) return;
        if (Math.random() < 0.025) {
          restUntil = t + rand(2, 7);
          return;
        }
        const osc = ctx.createOscillator();
        osc.frequency.value = pitch * rand(0.995, 1.005);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        for (let k = 0; k < pulses; k++) {
          const s = t + k * 0.031;
          g.gain.setValueAtTime(0, s);
          g.gain.linearRampToValueAtTime(level, s + 0.004);
          g.gain.setValueAtTime(level, s + 0.013);
          g.gain.linearRampToValueAtTime(0, s + 0.02);
        }
        osc.connect(g).connect(voice);
        osc.start(t);
        osc.stop(t + pulses * 0.031 + 0.03);
        osc.onended = () => g.disconnect();
      },
    );
  }
  return p.done();
};

const thunder: Factory = (env) => {
  const { ctx, bank, out } = env;
  const p = patch(env);
  p.loop("brown")
    .connect(filterNode(ctx, "lowpass", 220))
    .connect(gainNode(ctx, 0.1))
    .connect(out);
  // A rumble is a few swells of low noise that roll into each other.
  p.every(
    rand(3, 8),
    () => rand(20, 60),
    (t) => {
      const swells = Math.floor(rand(3, 6));
      let at = t;
      for (let i = 0; i < swells; i++) {
        const src = ctx.createBufferSource();
        src.buffer = bank.loop("brown");
        const lp = filterNode(ctx, "lowpass", rand(500, 1100));
        const g = ctx.createGain();
        const peak = rand(0.5, 1.2) * (i === 0 ? 0.7 : 1);
        const attack = rand(0.15, 0.6);
        const decay = rand(1.5, 4);
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(peak, at + attack);
        g.gain.setTargetAtTime(0, at + attack, decay / 3);
        lp.frequency.setValueAtTime(lp.frequency.value, at);
        lp.frequency.setTargetAtTime(150, at + attack, decay / 2);
        src.connect(lp).connect(g).connect(out);
        src.start(at, Math.random() * 6);
        src.stop(at + attack + decay * 2.2);
        src.onended = () => g.disconnect();
        at += rand(0.35, 1.6);
      }
    },
  );
  return p.done();
};

const shore: Factory = (env) => {
  const { ctx, bank, out } = env;
  const p = patch(env);
  const lp = filterNode(ctx, "lowpass", 600);
  const wave = gainNode(ctx, 0.3);
  p.loop("pink").connect(lp);
  p.loop("brown").connect(gainNode(ctx, 0.8)).connect(lp);
  lp.connect(wave).connect(out);
  const rattle = filterNode(ctx, "highpass", 2400);
  rattle.connect(out);
  const pebble = bank.grain(12, 3);
  p.every(
    0.5,
    () => rand(6, 11),
    (t) => {
      const rise = rand(2, 3.6);
      const fall = rand(3, 5);
      const peak = rand(0.75, 1.1);
      wave.gain.cancelScheduledValues(t);
      wave.gain.setTargetAtTime(peak, t, rise / 2.5);
      wave.gain.setTargetAtTime(rand(0.18, 0.3), t + rise, fall / 3);
      lp.frequency.cancelScheduledValues(t);
      lp.frequency.setTargetAtTime(rand(2200, 3200), t, rise / 2.5);
      lp.frequency.setTargetAtTime(rand(500, 800), t + rise, fall / 3);
      // Pebbles dragged back by the wash: dense at first, thinning out.
      const span = rand(2.2, 3.4);
      let at = t + rise * 0.9;
      while (at < t + rise + span) {
        const k = (at - (t + rise)) / span;
        playGrain(ctx, pebble, rattle, at, rand(0.02, 0.1) * (1 - Math.max(0, k)), rand(1.2, 2.6));
        at += poissonGap(70 * (1 - Math.max(0, k)) + 4);
      }
    },
  );
  return p.done();
};

const birds: Factory = (env) => {
  const { ctx, out } = env;
  const p = patch(env);
  p.loop("pink")
    .connect(filterNode(ctx, "bandpass", 650, 0.5))
    .connect(gainNode(ctx, 0.035))
    .connect(out);
  const song = filterNode(ctx, "highpass", 1400);
  song.connect(out);
  const motifs = ["chirps", "whistle", "trill", "warble"] as const;
  const birdsOut = Array.from({ length: 4 }, () => ({
    base: rand(2100, 4300),
    motif: pick(motifs),
    level: rand(0.08, 0.2),
    active: Math.random() < 0.75,
  }));
  for (const b of birdsOut) {
    // Birds come and go: each one sings for a while, then goes quiet.
    p.every(
      rand(15, 40),
      () => rand(18, 55),
      () => (b.active = Math.random() < 0.7),
    );
    p.every(
      rand(0.2, 4),
      () => rand(1.6, 7),
      (t) => {
        if (!b.active) return;
        if (Math.random() < 0.15) b.motif = pick(motifs);
        sing(ctx, song, t, b.base * rand(0.95, 1.05), b.motif, b.level);
      },
    );
  }
  return p.done();
};

function sing(
  ctx: BaseAudioContext,
  dest: AudioNode,
  t: number,
  base: number,
  motif: "chirps" | "whistle" | "trill" | "warble",
  level: number,
) {
  if (motif === "chirps") {
    const n = Math.floor(rand(2, 7));
    for (let i = 0; i < n; i++) {
      const f = base * rand(0.9, 1.1);
      playTone(ctx, dest, t + i * rand(0.08, 0.15), {
        freq: f,
        to: f * rand(1.25, 1.75),
        dur: rand(0.04, 0.075),
        level,
        attack: 0.004,
      });
    }
  } else if (motif === "whistle") {
    const n = Math.floor(rand(2, 4));
    let at = t;
    for (let i = 0; i < n; i++) {
      const dur = rand(0.16, 0.32);
      const from = base * rand(0.8, 1.25);
      const osc = playTone(ctx, dest, at, {
        freq: from,
        to: from * rand(0.82, 1.18),
        dur,
        level: level * 0.9,
        attack: 0.03,
      });
      const vib = ctx.createOscillator();
      const depth = gainNode(ctx, from * 0.012);
      vib.frequency.value = rand(5, 8);
      vib.connect(depth).connect(osc.frequency);
      vib.start(at);
      vib.stop(at + dur + 0.05);
      at += dur + rand(0.05, 0.18);
    }
  } else if (motif === "trill") {
    const dur = rand(0.5, 1.2);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(base * 1.1, t);
    osc.frequency.exponentialRampToValueAtTime(base * rand(0.85, 0.95), t + dur);
    // Square-wave tremolo between silence and `level` (offset + depth).
    const am = gainNode(ctx, level * 0.5);
    const lfo = ctx.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = rand(18, 28);
    const lfoDepth = gainNode(ctx, level * 0.5);
    lfo.connect(lfoDepth).connect(am.gain);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.05);
    env.gain.setTargetAtTime(0, t + dur - 0.1, 0.05);
    osc.connect(am).connect(env).connect(dest);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.2);
    lfo.stop(t + dur + 0.2);
    osc.onended = () => env.disconnect();
  } else {
    const dur = rand(0.35, 0.8);
    const osc = playTone(ctx, dest, t, { freq: base, dur, level, attack: 0.02 });
    const mod = ctx.createOscillator();
    mod.frequency.value = rand(28, 60);
    const depth = gainNode(ctx, base * rand(0.08, 0.16));
    mod.connect(depth).connect(osc.frequency);
    mod.start(t);
    mod.stop(t + dur + 0.05);
  }
}

// ── City ────────────────────────────────────────────────────────────────────

const street: Factory = (env) => {
  const { ctx, out } = env;
  const p = patch(env);
  p.loop("pink")
    .connect(filterNode(ctx, "highpass", 900))
    .connect(filterNode(ctx, "lowpass", 5500))
    .connect(gainNode(ctx, 0.2))
    .connect(out);
  p.every(
    rand(0.5, 3),
    () => rand(3, 11),
    (t) => {
      const d = rand(3.5, 7);
      const mid = t + d * rand(0.45, 0.55);
      const peak = rand(0.45, 1);
      // Tyres on wet asphalt: the hiss opens up as the car comes by, then closes.
      const src = ctx.createBufferSource();
      src.buffer = env.bank.loop("pink");
      const lp = filterNode(ctx, "lowpass", 700);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.setTargetAtTime(peak, t, (mid - t) / 2.2);
      g.gain.setTargetAtTime(0, mid, d / 7);
      lp.frequency.setValueAtTime(700, t);
      lp.frequency.setTargetAtTime(rand(4500, 7000), t, (mid - t) / 2.2);
      lp.frequency.setTargetAtTime(800, mid, d / 6);
      src.connect(lp).connect(g).connect(out);
      src.start(t, Math.random() * 8);
      src.stop(t + d + 1.5);
      src.onended = () => g.disconnect();
      // The engine underneath, its pitch dropping as it passes (Doppler).
      const f = rand(42, 75);
      const eng = ctx.createOscillator();
      eng.type = "sawtooth";
      eng.frequency.setValueAtTime(f * 1.05, t);
      eng.frequency.setTargetAtTime(f * 0.93, mid, 0.35);
      const elp = filterNode(ctx, "lowpass", 200);
      const eg = ctx.createGain();
      eg.gain.setValueAtTime(0, t);
      eg.gain.setTargetAtTime(peak * 0.16, t, (mid - t) / 2.2);
      eg.gain.setTargetAtTime(0, mid, d / 7);
      eng.connect(elp).connect(eg).connect(out);
      eng.start(t);
      eng.stop(t + d + 1.5);
      eng.onended = () => eg.disconnect();
    },
  );
  return p.done();
};

const cafe: Factory = (env) => {
  const { ctx, out } = env;
  const p = patch(env);
  p.loop("brown")
    .connect(filterNode(ctx, "lowpass", 400))
    .connect(gainNode(ctx, 0.12))
    .connect(out);
  const room = filterNode(ctx, "lowpass", 2800);
  room.connect(out);
  // Murmur: a few talkers, each noise shaped by two moving formants, syllable by syllable.
  for (let i = 0; i < 4; i++) {
    const src = p.loop("pink");
    const scale = rand(0.85, 1.2);
    const f1 = filterNode(ctx, "bandpass", 500 * scale, 4);
    const f2 = filterNode(ctx, "bandpass", 1500 * scale, 5);
    const syl = gainNode(ctx, 0);
    src.connect(f1).connect(syl);
    src.connect(f2).connect(syl);
    syl.connect(gainNode(ctx, rand(0.6, 1.1))).connect(room);
    let pauseUntil = 0;
    p.every(
      rand(0, 1),
      () => rand(0.12, 0.26),
      (t) => {
        if (t < pauseUntil) return;
        if (Math.random() < 0.08) {
          pauseUntil = t + rand(0.5, 3);
          glide(syl.gain, 0, t, 0.08);
          return;
        }
        glide(f1.frequency, rand(300, 850) * scale, t, 0.03);
        glide(f2.frequency, rand(900, 2300) * scale, t, 0.03);
        glide(syl.gain, rand(0.4, 1.4), t, 0.035);
      },
    );
  }
  // Cups and spoons: a short inharmonic ring now and then.
  p.every(
    rand(2, 6),
    () => rand(3, 11),
    (t) => {
      const f = rand(1900, 2900);
      for (const [ratio, lvl] of [
        [1, 0.05],
        [2.76, 0.025],
        [5.4, 0.012],
      ] as const) {
        playTone(ctx, out, t, { freq: f * ratio, dur: rand(0.3, 0.7), level: lvl, attack: 0.001 });
      }
    },
  );
  return p.done();
};

const train: Factory = (env) => {
  const { ctx, bank, out } = env;
  const p = patch(env);
  const swell = gainNode(ctx, 0.7);
  swell.connect(out);
  const rumble = gainNode(ctx, 0.55);
  p.loop("brown")
    .connect(filterNode(ctx, "lowpass", 150))
    .connect(rumble)
    .connect(swell);
  p.loop("pink")
    .connect(filterNode(ctx, "bandpass", 1800, 0.7))
    .connect(gainNode(ctx, 0.05))
    .connect(swell);
  breathe(p, swell, 0.45, 1, [6, 12]);
  const clackTone = filterNode(ctx, "lowpass", 900);
  clackTone.connect(swell);
  const clack = bank.grain(50, 14);
  let speed = 1.1;
  p.every(
    0,
    () => rand(8, 16),
    () => (speed = rand(0.95, 1.3)),
  );
  // Wheels over rail joints: "clack-clack … clack-clack".
  p.every(
    0.3,
    () => speed * rand(0.97, 1.03),
    (t) => {
      for (const dt of [0, 0.11]) {
        playGrain(ctx, clack, clackTone, t + dt, rand(0.35, 0.6), rand(0.32, 0.45));
        playTone(ctx, swell, t + dt, {
          freq: rand(80, 100),
          dur: 0.07,
          level: 0.18,
          attack: 0.002,
        });
      }
    },
  );
  // A horn far off, once in a long while.
  p.every(
    rand(25, 60),
    () => rand(60, 150),
    (t) => {
      const lp = filterNode(ctx, "lowpass", 1100);
      lp.connect(swell);
      for (const f of [311, 392]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f * rand(0.99, 1.01);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.05, t + 0.3);
        g.gain.setValueAtTime(0.05, t + 1.4);
        g.gain.linearRampToValueAtTime(0, t + 2.2);
        o.connect(g).connect(lp);
        o.start(t);
        o.stop(t + 2.3);
        o.onended = () => g.disconnect();
      }
    },
  );
  return p.done();
};

// ── Indoors ─────────────────────────────────────────────────────────────────

const fire: Factory = (env) => {
  const { ctx, bank, out } = env;
  const p = patch(env);
  const roar = gainNode(ctx, 0.5);
  p.loop("brown")
    .connect(filterNode(ctx, "lowpass", 520))
    .connect(roar)
    .connect(out);
  p.every(
    0,
    () => rand(0.08, 0.25),
    (t) => glide(roar.gain, rand(0.32, 0.78), t, 0.09),
  );
  const hiss = gainNode(ctx, 0.02);
  p.loop("white")
    .connect(filterNode(ctx, "highpass", 3200))
    .connect(hiss)
    .connect(out);
  p.every(
    0,
    () => rand(0.05, 0.2),
    (t) => glide(hiss.gain, rand(0.005, 0.045), t, 0.04),
  );
  const crackleTone = filterNode(ctx, "highpass", 1600);
  crackleTone.connect(out);
  const crackle = bank.grain(5, 1.2);
  const crack = (t: number, lvl = rand(0.12, 0.55)) =>
    playGrain(ctx, crackle, crackleTone, t, lvl, rand(0.9, 2.4));
  p.every(
    0,
    () => poissonGap(7),
    (t) => {
      crack(t);
      // Crackles come in bursts as often as alone.
      if (Math.random() < 0.12) {
        const n = Math.floor(rand(3, 9));
        for (let i = 1; i < n; i++) crack(t + rand(0.01, 0.18), rand(0.06, 0.35));
      }
    },
  );
  const popTone = filterNode(ctx, "bandpass", 900, 2);
  popTone.connect(out);
  const pop = bank.grain(60, 14);
  p.every(
    1,
    () => poissonGap(0.45),
    (t) => playGrain(ctx, pop, popTone, t, rand(0.25, 0.6), rand(0.4, 0.75)),
  );
  // A log settling: a low knock, then embers crumbling.
  p.every(
    rand(15, 40),
    () => rand(25, 70),
    (t) => {
      playTone(ctx, out, t, { freq: rand(60, 85), dur: 0.16, level: 0.35, attack: 0.004 });
      for (let i = 0; i < 14; i++) crack(t + 0.05 + rand(0, 0.7), rand(0.05, 0.25));
    },
  );
  return p.done();
};

const windowRain: Factory = (env) => {
  const { ctx, bank, out } = env;
  const p = patch(env);
  const bed = gainNode(ctx, 0.45);
  p.loop("pink")
    .connect(filterNode(ctx, "highpass", 220))
    .connect(filterNode(ctx, "lowpass", 2300))
    .connect(bed)
    .connect(out);
  breathe(p, bed, 0.3, 0.6, [3, 8]);
  const bands = [900, 1400, 2100, 3000].map((f) => {
    const bp = filterNode(ctx, "bandpass", f, 6);
    bp.connect(out);
    return bp;
  });
  const tap = bank.grain(35, 6);
  let density = 6;
  p.every(
    0,
    () => rand(2, 6),
    () => (density = rand(3, 11)),
  );
  p.every(
    0,
    () => poissonGap(density),
    (t) => {
      playGrain(ctx, tap, pick(bands), t, rand(0.2, 0.75), rand(0.5, 0.95));
      // Now and then a run of drops trickles down the glass.
      if (Math.random() < 0.06) {
        const n = Math.floor(rand(3, 7));
        for (let i = 1; i < n; i++)
          playGrain(ctx, tap, pick(bands), t + i * rand(0.03, 0.07), rand(0.1, 0.4), rand(0.6, 1));
      }
    },
  );
  return p.done();
};

const keys: Factory = (env) => {
  const { ctx, bank, out } = env;
  const p = patch(env);
  p.loop("brown")
    .connect(filterNode(ctx, "lowpass", 300))
    .connect(gainNode(ctx, 0.04))
    .connect(out);
  const clickTone = filterNode(ctx, "bandpass", 3000, 1.2);
  clickTone.connect(out);
  const click = bank.grain(14, 3);
  const hit = (t: number, space: boolean) => {
    playGrain(
      ctx,
      click,
      clickTone,
      t,
      space ? rand(0.3, 0.45) : rand(0.18, 0.4),
      space ? 0.65 : rand(0.9, 1.35),
    );
    playTone(ctx, out, t, {
      freq: space ? rand(140, 170) : rand(190, 290),
      dur: space ? 0.06 : 0.035,
      level: space ? 0.16 : 0.1,
      attack: 0.001,
    });
  };
  // A typist: words of a few keys, a space, and pauses to think.
  let left = 0;
  const gap = () => {
    if (left > 0) return rand(0.06, 0.17);
    if (Math.random() < 0.035) return rand(5, 14);
    if (Math.random() < 0.13) return rand(1.2, 5);
    return rand(0.12, 0.28);
  };
  p.every(rand(0.5, 2), gap, (t) => {
    if (left <= 0) {
      hit(t, true);
      left = Math.floor(rand(2, 9));
    } else {
      hit(t, false);
      left -= 1;
    }
  });
  return p.done();
};

const pages: Factory = (env) => {
  const { ctx, bank, out } = env;
  const p = patch(env);
  p.loop("brown")
    .connect(filterNode(ctx, "lowpass", 260))
    .connect(gainNode(ctx, 0.05))
    .connect(out);
  const swish = (t: number, dur: number, level: number) => {
    const src = ctx.createBufferSource();
    src.buffer = bank.loop("pink");
    const bp = filterNode(ctx, "bandpass", 900, 0.9);
    bp.frequency.setValueAtTime(rand(700, 1100), t);
    bp.frequency.exponentialRampToValueAtTime(rand(2800, 4200), t + dur);
    const flutter = gainNode(ctx, 0.7);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rand(16, 30);
    const depth = gainNode(ctx, 0.3);
    lfo.connect(depth).connect(flutter.gain);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + dur * 0.3);
    g.gain.setTargetAtTime(0, t + dur * 0.4, dur / 4);
    src.connect(bp).connect(flutter).connect(g).connect(out);
    src.start(t, Math.random() * 8);
    lfo.start(t);
    src.stop(t + dur * 2);
    lfo.stop(t + dur * 2);
    src.onended = () => g.disconnect();
  };
  p.every(
    rand(2, 5),
    () => rand(9, 35),
    (t) => swish(t, rand(0.35, 0.6), rand(0.4, 0.7)),
  );
  p.every(
    rand(3, 8),
    () => poissonGap(0.15),
    (t) => swish(t, rand(0.08, 0.15), rand(0.08, 0.18)),
  );
  return p.done();
};

const purr: Factory = (env) => {
  const { ctx, out } = env;
  const p = patch(env);
  const bp = filterNode(ctx, "bandpass", 170, 0.8);
  p.loop("brown").connect(bp);
  p.loop("pink").connect(gainNode(ctx, 0.35)).connect(bp);
  // The purr itself: noise pulsed ~25 times a second.
  const am = gainNode(ctx, 0.5);
  const pulse = p.osc("triangle", 25);
  pulse.connect(gainNode(ctx, 0.5)).connect(am.gain);
  const breath = gainNode(ctx, 0.8);
  bp.connect(am)
    .connect(breath)
    .connect(filterNode(ctx, "lowpass", 900))
    .connect(out);
  // Breathing in (softer, a little higher) and out, slightly different each time.
  let inhale = false;
  p.every(
    0,
    () => (inhale ? rand(1.5, 2.1) : rand(2, 2.8)),
    (t) => {
      inhale = !inhale;
      glide(breath.gain, inhale ? rand(0.35, 0.5) : rand(0.85, 1.1), t, 0.25);
      glide(pulse.frequency, inhale ? rand(22, 24) : rand(25, 28), t, 0.3);
      glide(bp.frequency, inhale ? rand(190, 230) : rand(140, 170), t, 0.3);
    },
  );
  return p.done();
};

export const GENERATORS: Record<PointSoundId, Factory> = {
  birds,
  rainfall,
  stream,
  pines,
  crickets,
  thunder,
  shore,
  street,
  cafe,
  train,
  fire,
  window: windowRain,
  keys,
  pages,
  purr,
  white: noise("white"),
  pink: noise("pink"),
  brown: noise("brown"),
  blue: noise("blue"),
  violet: noise("violet"),
};

/**
 * Per-sound loudness trim, so equal volume settings sound about equally loud.
 * Measured offline over 30 s (RMS): steady beds land near −22 dBFS; sparse ones
 * (birds, typing, page turns, thunder) a little under, since their events, not
 * their average, are what you hear; noise a touch under too, as it never lets up.
 * Re-measure after changing a generator's levels.
 */
export const TRIM: Record<PointSoundId, number> = {
  birds: 1.78,
  rainfall: 1.2,
  stream: 1.58,
  pines: 1.5,
  crickets: 2.04,
  thunder: 1.48,
  shore: 0.67,
  street: 1.2,
  cafe: 1.3,
  train: 1.24,
  fire: 0.79,
  window: 1.55,
  keys: 2.34,
  pages: 3.39,
  purr: 1.66,
  white: 0.45,
  pink: 0.53,
  brown: 0.53,
  blue: 0.45,
  violet: 0.4,
};
