// Soundspace — the audio engine. One AudioContext plays one scene: each sound is
// a generator feeding its own chain (level → distance lowpass → HRTF panner →
// dry, plus a reverb send that grows with distance), so a sound to your left is
// heard on your left, and a far one is softer, darker and roomier. Binaural
// beats bypass all of it: one pure tone per ear, straight to the output.
//
// The engine only follows: `apply(state)` diffs the scene it is given against
// what is playing. The store (`../store.ts`) owns the state.

import { binauralBeat, type BinauralId, type PointSoundId } from "../catalog";
import { distanceT, metersFor, type Scene, type Voice } from "../model";
import { filterNode, gainNode, glide, NoiseBank, rand, roomImpulse } from "./dsp";
import { type Generator, GENERATORS, TRIM } from "./generators";

export interface EngineState {
  scene: Scene;
  playing: boolean;
  solo: PointSoundId | null;
}

const TICK_MS = 100;
/** How far ahead events are scheduled; a hidden tab ticks about once a second. */
const LOOKAHEAD_S = 0.4;
const LOOKAHEAD_HIDDEN_S = 1.6;
const CARRIER_HZ = 200;
const SMOOTH = 0.06;

interface Chain {
  gen: Generator;
  level: GainNode;
  lowpass: BiquadFilterNode;
  panner: PannerNode;
  dry: GainNode;
  send: GainNode;
  voice: Voice;
  /** Wander offsets around the chosen spot. */
  driftA: number;
  driftR: number;
  nextDrift: number;
}

interface BinauralChain {
  id: BinauralId;
  left: OscillatorNode;
  right: OscillatorNode;
  level: GainNode;
}

/** Perceived loudness: a fader feels linear when the gain is squared. */
const curve = (v: number) => v * v;

export class SoundspaceEngine {
  private readonly bank: NoiseBank;
  private readonly bus: GainNode;
  private readonly master: GainNode;
  private readonly reverb: ConvolverNode;
  private readonly chains = new Map<PointSoundId, Chain>();
  private binaural: BinauralChain | null = null;
  private state: EngineState | null = null;
  private readonly tickTimer: ReturnType<typeof setInterval>;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(readonly ctx: AudioContext) {
    this.bank = new NoiseBank(ctx);
    this.master = gainNode(ctx, 0);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.3;
    // Makeup gain into the compressor: a full mix sits around −20 dBFS, peaks held.
    this.bus = gainNode(ctx, 1.8);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = roomImpulse(ctx);
    const wet = gainNode(ctx, 0.55);
    this.reverb.connect(wet).connect(this.bus);
    this.bus.connect(comp).connect(this.master).connect(ctx.destination);
    // Headphones face forward: the listener sits at the origin looking down −z.
    this.tickTimer = setInterval(this.tick, TICK_MS);
  }

  apply(next: EngineState): void {
    if (this.disposed) return;
    this.state = next;
    const now = this.ctx.currentTime;
    this.applyMaster(next, now);
    this.applyVoices(next, now);
    this.applyBinaural(next, now);
  }

  /** Fade the whole space, then let the context sleep so a paused space costs nothing. */
  private applyMaster({ scene, playing }: EngineState, now: number): void {
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    if (playing) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      glide(this.master.gain, curve(scene.master), now, 0.25);
      return;
    }
    glide(this.master.gain, 0, now, 0.15);
    this.suspendTimer = setTimeout(() => {
      if (!this.state?.playing && this.ctx.state === "running") void this.ctx.suspend();
    }, 900);
  }

  /** Point sounds: add, update, remove. */
  private applyVoices({ scene, solo }: EngineState, now: number): void {
    const keep = new Set<PointSoundId>();
    for (const v of scene.voices) {
      keep.add(v.id);
      let chain = this.chains.get(v.id);
      if (!chain) {
        chain = this.createChain(v);
        this.chains.set(v.id, chain);
      }
      chain.voice = v;
      this.place(chain, now, SMOOTH);
      const audible = v.on && (!solo || solo === v.id);
      glide(chain.level.gain, audible ? curve(v.volume) * TRIM[v.id] : 0, now, 0.08);
    }
    for (const [id, chain] of this.chains) {
      if (!keep.has(id)) this.dropChain(id, chain, now);
    }
  }

  /** One beat at a time, never placed, silent while a sound is soloed. */
  private applyBinaural({ scene, solo }: EngineState, now: number): void {
    const b = scene.binaural;
    if (!b) {
      if (this.binaural) this.dropBinaural(now);
      return;
    }
    this.binaural ??= this.createBinaural(b.id);
    if (this.binaural.id !== b.id) {
      this.binaural.id = b.id;
      glide(this.binaural.right.frequency, CARRIER_HZ + binauralBeat(b.id).beatHz, now, 0.3);
    }
    const audible = b.on && !solo;
    glide(this.binaural.level.gain, audible ? curve(b.volume) * 0.22 : 0, now, 0.12);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.tickTimer);
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    const now = this.ctx.currentTime;
    glide(this.master.gain, 0, now, 0.05);
    setTimeout(() => void this.ctx.close(), 300);
  }

  private createChain(v: Voice): Chain {
    const { ctx } = this;
    const level = gainNode(ctx, 0);
    const lowpass = filterNode(ctx, "lowpass", 18000, 0.5);
    const panner = new PannerNode(ctx, {
      panningModel: "HRTF",
      distanceModel: "inverse",
      // Distance is ours (level, tone and room below); the panner only turns.
      rolloffFactor: 0,
    });
    const dry = gainNode(ctx, 1);
    const send = gainNode(ctx, 0.1);
    level.connect(lowpass).connect(panner);
    panner.connect(dry).connect(this.bus);
    panner.connect(send).connect(this.reverb);
    const gen = GENERATORS[v.id]({ ctx, bank: this.bank, out: level });
    const chain: Chain = {
      gen,
      level,
      lowpass,
      panner,
      dry,
      send,
      voice: v,
      driftA: 0,
      driftR: 0,
      nextDrift: 0,
    };
    this.place(chain, ctx.currentTime, 0.001);
    return chain;
  }

  /** Point the panner and shape level, tone and room for where the voice sits. */
  private place(chain: Chain, t: number, tau: number): void {
    const v = chain.voice;
    const radius = Math.max(0.34, Math.min(1, v.radius + chain.driftR));
    const angle = ((v.angle + chain.driftA) * Math.PI) / 180;
    const d = Math.max(1, metersFor(radius));
    const x = Math.sin(angle) * d;
    const z = -Math.cos(angle) * d;
    const p = chain.panner;
    if (p.positionX) {
      glide(p.positionX, x, t, tau);
      glide(p.positionY, 0, t, tau);
      glide(p.positionZ, z, t, tau);
    } else {
      p.setPosition(x, 0, z);
    }
    const k = distanceT(radius);
    // Near: full, bright and dry. Far: about −11 dB, dull and roomy.
    glide(chain.dry.gain, (1 - 0.3 * k) / (1 + 2.4 * k), t, tau);
    glide(chain.lowpass.frequency, 18000 * Math.pow(0.22, k), t, tau);
    glide(chain.send.gain, 0.05 + 0.5 * k, t, tau);
  }

  private dropChain(id: PointSoundId, chain: Chain, now: number): void {
    this.chains.delete(id);
    glide(chain.level.gain, 0, now, 0.1);
    chain.gen.stop(now + 0.7);
    setTimeout(() => {
      chain.level.disconnect();
      chain.panner.disconnect();
    }, 900);
  }

  private createBinaural(id: BinauralId): BinauralChain {
    const { ctx } = this;
    const merger = ctx.createChannelMerger(2);
    const left = ctx.createOscillator();
    const right = ctx.createOscillator();
    left.frequency.value = CARRIER_HZ;
    right.frequency.value = CARRIER_HZ + binauralBeat(id).beatHz;
    left.connect(merger, 0, 0);
    right.connect(merger, 0, 1);
    const level = gainNode(ctx, 0);
    merger.connect(level).connect(this.master);
    left.start();
    right.start();
    return { id, left, right, level };
  }

  private dropBinaural(now: number): void {
    const b = this.binaural;
    if (!b) return;
    this.binaural = null;
    glide(b.level.gain, 0, now, 0.15);
    b.left.stop(now + 0.8);
    b.right.stop(now + 0.8);
    setTimeout(() => b.level.disconnect(), 1000);
  }

  private readonly tick = () => {
    if (this.disposed || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    const hidden = typeof document !== "undefined" && document.hidden;
    const until = now + (hidden ? LOOKAHEAD_HIDDEN_S : LOOKAHEAD_S);
    for (const chain of this.chains.values()) {
      chain.gen.schedule(now, until);
      // Wander: a slow random walk around the spot; back home when it's off.
      if (now >= chain.nextDrift) {
        chain.nextDrift = now + rand(0.6, 1.2);
        if (chain.voice.wander) {
          chain.driftA = Math.max(-22, Math.min(22, chain.driftA + rand(-7, 7)));
          chain.driftR = Math.max(-0.07, Math.min(0.07, chain.driftR + rand(-0.03, 0.03)));
        } else {
          chain.driftA = 0;
          chain.driftR = 0;
        }
        this.place(chain, now, 0.9);
      }
    }
  };
}
