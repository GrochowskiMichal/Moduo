// Soundspace — the building blocks every generated sound is made of: noise in
// five colours (as long, seamless loops), short one-shot grains, a room reverb,
// and small helpers that schedule a node's life on the audio clock. Nothing here
// streams a file: each buffer is computed once per AudioContext.

export type NoiseColor = "white" | "pink" | "brown" | "blue" | "violet";

export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
export const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
/** The wait until the next event of a Poisson process running at `perSecond`. */
export const poissonGap = (perSecond: number) =>
  -Math.log(1 - Math.random()) / Math.max(perSecond, 1e-3);

function whiteSamples(n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.random() * 2 - 1;
  return out;
}

/** Paul Kellet's refined pink filter (−3 dB/octave). */
function pinkSamples(n: number): Float32Array {
  const out = new Float32Array(n);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return out;
}

/** Leaky-integrated white (−6 dB/octave). */
function brownSamples(n: number): Float32Array {
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    out[i] = last;
  }
  return out;
}

/** First difference: tilts the spectrum up 6 dB/octave. */
function differentiate(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 1; i < x.length; i++) out[i] = x[i] - x[i - 1];
  return out;
}

function samplesFor(color: NoiseColor, n: number): Float32Array {
  switch (color) {
    case "white":
      return whiteSamples(n);
    case "pink":
      return pinkSamples(n);
    case "brown":
      return brownSamples(n);
    case "blue":
      return differentiate(pinkSamples(n));
    case "violet":
      return differentiate(whiteSamples(n));
  }
}

/** Scale to a common loudness (RMS), so every colour sits at the same level. */
function normalize(x: Float32Array, targetRms = 0.18): Float32Array {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  const rms = Math.sqrt(sum / x.length) || 1;
  const k = targetRms / rms;
  for (let i = 0; i < x.length; i++) x[i] = Math.max(-1, Math.min(1, x[i] * k));
  return x;
}

/**
 * Fold the tail into the head with an equal-power crossfade, so the buffer loops
 * with no seam (a cut in brown noise would click every lap).
 */
function makeSeamless(x: Float32Array, fade: number): Float32Array {
  const n = x.length - fade;
  const out = x.slice(0, n);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    out[i] = x[n + i] * Math.cos((t * Math.PI) / 2) + x[i] * Math.sin((t * Math.PI) / 2);
  }
  return out;
}

/** Per-context cache of the noise loops and grains (built on first use). */
export class NoiseBank {
  private loops = new Map<NoiseColor, AudioBuffer>();
  private grains = new Map<string, AudioBuffer>();
  constructor(private readonly ctx: BaseAudioContext) {}

  /** A 9–13 s seamless loop; lengths differ per colour so layered loops never line up. */
  loop(color: NoiseColor): AudioBuffer {
    let buf = this.loops.get(color);
    if (!buf) {
      const sr = this.ctx.sampleRate;
      const seconds = { white: 9.1, pink: 11.3, brown: 12.7, blue: 10.3, violet: 9.7 }[color];
      const fade = Math.floor(sr * 0.25);
      const data = makeSeamless(
        normalize(samplesFor(color, Math.floor(sr * seconds) + fade)),
        fade,
      );
      buf = this.ctx.createBuffer(1, data.length, sr);
      buf.getChannelData(0).set(data);
      this.loops.set(color, buf);
    }
    return buf;
  }

  /**
   * A short decaying burst of white noise: the raw material of a raindrop, a
   * crackle, a key click or a pebble. `ms` is its length, `decayMs` its fall.
   */
  grain(ms: number, decayMs: number): AudioBuffer {
    const key = `${ms}:${decayMs}`;
    let buf = this.grains.get(key);
    if (!buf) {
      const sr = this.ctx.sampleRate;
      const n = Math.max(1, Math.floor((sr * ms) / 1000));
      const data = new Float32Array(n);
      const k = 1000 / (decayMs * sr);
      for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i * k);
      buf = this.ctx.createBuffer(1, n, sr);
      buf.getChannelData(0).set(data);
      this.grains.set(key, buf);
    }
    return buf;
  }
}

/** A stereo room: decaying noise with highs dying faster than lows. */
export function roomImpulse(ctx: BaseAudioContext, seconds = 2.6): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const pre = Math.floor(sr * 0.018);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = new Float32Array(n);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      // One-pole lowpass whose cutoff falls over the tail: a darker, softer end.
      const a = 0.18 + 0.75 * Math.min(1, t / seconds);
      lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
      data[i] = lp * Math.exp(-t * 2.9) * 2.2;
    }
    buf.getChannelData(ch).set(data);
  }
  return buf;
}

// ── Scheduling helpers ──────────────────────────────────────────────────────

export function gainNode(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

export function filterNode(
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  frequency: number,
  q = 0.7,
): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = q;
  return f;
}

/** A looping noise source started at a random point, so two copies never align. */
export function loopSource(
  ctx: BaseAudioContext,
  bank: NoiseBank,
  color: NoiseColor,
  rate = 1,
): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = bank.loop(color);
  src.loop = true;
  src.playbackRate.value = rate;
  src.start(ctx.currentTime, Math.random() * src.buffer.duration);
  return src;
}

/** Play a grain once at `t` through `dest`, at `level`, pitched by `rate`. */
export function playGrain(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  dest: AudioNode,
  t: number,
  level: number,
  rate = 1,
): void {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  const g = gainNode(ctx, level);
  src.connect(g).connect(dest);
  src.start(t);
  src.onended = () => g.disconnect();
}

/** A one-shot tone with an attack/decay envelope and an optional pitch glide. */
export function playTone(
  ctx: BaseAudioContext,
  dest: AudioNode,
  t: number,
  opts: {
    freq: number;
    to?: number;
    dur: number;
    level: number;
    attack?: number;
    type?: OscillatorType;
  },
): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(opts.freq, t);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t + opts.dur);
  const g = ctx.createGain();
  const attack = opts.attack ?? 0.005;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(opts.level, t + attack);
  g.gain.setTargetAtTime(0, t + attack, Math.max(0.005, (opts.dur - attack) / 4));
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + opts.dur + 0.05);
  osc.onended = () => g.disconnect();
  return osc;
}

/** Glide an AudioParam toward `value` from `t`, easing over about `tau` × 3 seconds. */
export function glide(param: AudioParam, value: number, t: number, tau: number): void {
  param.cancelScheduledValues(t);
  param.setTargetAtTime(value, t, Math.max(0.001, tau));
}

/**
 * A recurring event on the audio clock. `run(until)` fires every occurrence
 * due before `until` and skips any the clock already passed (a frozen or
 * throttled tab), so events never pile up.
 */
export class Every {
  private next: number;
  constructor(
    start: number,
    private readonly gap: () => number,
    private readonly fire: (t: number) => void,
  ) {
    this.next = start;
  }
  run(now: number, until: number): void {
    if (this.next < now - 0.5) this.next = now + this.gap() * Math.random();
    while (this.next < until) {
      this.fire(Math.max(this.next, now));
      this.next += Math.max(0.005, this.gap());
    }
  }
}
