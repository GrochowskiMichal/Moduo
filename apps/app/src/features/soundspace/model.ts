// Soundspace — the scene model: what a widget saves in its config, how a sound's
// place on the stage maps to direction and distance, and the scene edits the
// UI makes. Pure functions only; the engine and the widget both use them.

import {
  binauralBeat,
  type BinauralId,
  isBinauralId,
  isPointSoundId,
  MAX_VOICES,
  MIXES,
  pointSound,
  type PointSoundId,
} from "./catalog";

/** The innermost a sound can sit (the head and shoulders take the middle). */
export const R_MIN = 0.34;
/** Distances on the stage, near to far. */
export const NEAREST_M = 0.3;
export const FARTHEST_M = 8;

export interface Voice {
  id: PointSoundId;
  /** Degrees clockwise from straight ahead, −180…180. */
  angle: number;
  /** R_MIN…1 of the stage radius; closer is louder. */
  radius: number;
  /** 0…1. */
  volume: number;
  on: boolean;
  wander: boolean;
}

export interface BinauralLayer {
  id: BinauralId;
  volume: number;
  on: boolean;
}

export interface Scene {
  voices: Voice[];
  binaural: BinauralLayer | null;
  /** 0…1, the whole space. */
  master: number;
  /** The mix it came from, or the name it was saved under. */
  mixName: string | null;
}

export const EMPTY_SCENE: Scene = { voices: [], binaural: null, master: 0.7, mixName: null };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export function wrapAngle(a: number): number {
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

/** Lax read of a widget's saved config: anything unknown or broken is dropped. */
export function sceneFromConfig(config: Record<string, unknown>): Scene {
  const raw = config.soundspace;
  if (!raw || typeof raw !== "object") return EMPTY_SCENE;
  const r = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const voices: Voice[] = [];
  for (const v of Array.isArray(r.voices) ? r.voices : []) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (!isPointSoundId(o.id) || seen.has(o.id)) continue;
    seen.add(o.id);
    voices.push({
      id: o.id,
      angle: wrapAngle(num(o.angle, 0)),
      radius: clamp(num(o.radius, 0.8), R_MIN, 1),
      volume: clamp(num(o.volume, 0.5), 0, 1),
      on: o.on !== false,
      wander: o.wander === true,
    });
  }
  let binaural: BinauralLayer | null = null;
  const b = r.binaural as Record<string, unknown> | null | undefined;
  if (b && typeof b === "object" && isBinauralId(b.id)) {
    binaural = { id: b.id, volume: clamp(num(b.volume, 0.4), 0, 1), on: b.on !== false };
  }
  const capped = voices.slice(0, MAX_VOICES - (binaural ? 1 : 0));
  return {
    voices: capped,
    binaural,
    master: clamp(num(r.master, EMPTY_SCENE.master), 0, 1),
    mixName:
      typeof r.mixName === "string" && r.mixName.trim() ? r.mixName.trim().slice(0, 60) : null,
  };
}

/** The config patch that saves a scene (rounded so a drag doesn't churn the row). */
export function sceneToConfig(scene: Scene): Record<string, unknown> {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    soundspace: {
      voices: scene.voices.map((v) => ({
        id: v.id,
        angle: Math.round(v.angle),
        radius: r2(v.radius),
        volume: r2(v.volume),
        on: v.on,
        wander: v.wander,
      })),
      binaural: scene.binaural
        ? { id: scene.binaural.id, volume: r2(scene.binaural.volume), on: scene.binaural.on }
        : null,
      master: r2(scene.master),
      mixName: scene.mixName,
    },
  };
}

export function voiceCount(scene: Scene): number {
  return scene.voices.length + (scene.binaural ? 1 : 0);
}

export function isFull(scene: Scene): boolean {
  return voiceCount(scene) >= MAX_VOICES;
}

// ── Geometry ────────────────────────────────────────────────────────────────

/** 0 at the head, 1 at the stage's edge. */
export function distanceT(radius: number): number {
  return clamp((radius - R_MIN) / (1 - R_MIN), 0, 1);
}

export function metersFor(radius: number): number {
  return NEAREST_M + Math.pow(distanceT(radius), 1.5) * (FARTHEST_M - NEAREST_M);
}

export function formatMeters(m: number): string {
  return m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(1)} m`;
}

const DIRECTIONS = [
  "Front",
  "Front-right",
  "Right",
  "Back-right",
  "Behind",
  "Back-left",
  "Left",
  "Front-left",
] as const;

export function directionName(angle: number): string {
  const a = ((angle % 360) + 360) % 360;
  return DIRECTIONS[Math.round(a / 45) % 8];
}

export function distanceWord(radius: number): string {
  return radius < 0.55 ? "Close" : radius < 0.8 ? "In the room" : "Far";
}

export function placeLabel(v: Pick<Voice, "angle" | "radius">): string {
  return `${directionName(v.angle)} · ${formatMeters(metersFor(v.radius))}`;
}

/** Stage-relative x/y (y down) for a voice, given the stage radius in px. */
export function toStageXY(angle: number, radius: number, stageR: number) {
  const rad = (angle * Math.PI) / 180;
  return { x: Math.sin(rad) * radius * stageR, y: -Math.cos(rad) * radius * stageR };
}

/** The voice place under a point, offset from the stage centre in px. */
export function fromStageXY(x: number, y: number, stageR: number) {
  const angle = (Math.atan2(x, -y) * 180) / Math.PI;
  const radius = clamp(Math.hypot(x, y) / stageR, R_MIN, 1);
  return { angle: wrapAngle(angle), radius };
}

// ── Scene edits ─────────────────────────────────────────────────────────────

/** A free spot near the sound's own default, stepping round so new sounds don't stack. */
export function freeSpot(id: PointSoundId, voices: readonly Voice[]) {
  const def = pointSound(id);
  let angle = def.angle;
  for (let i = 0; i < 10; i++) {
    const hit = voices.some(
      (v) => Math.abs(wrapAngle(v.angle - angle)) < 26 && Math.abs(v.radius - def.radius) < 0.22,
    );
    if (!hit) break;
    angle += 37;
  }
  return { angle: wrapAngle(angle), radius: def.radius };
}

export function addPointSound(scene: Scene, id: PointSoundId): Scene {
  if (scene.voices.some((v) => v.id === id) || isFull(scene)) return scene;
  const def = pointSound(id);
  const spot = freeSpot(id, scene.voices);
  const voice: Voice = { id, ...spot, volume: def.volume, on: true, wander: def.wander === true };
  return { ...scene, voices: [...scene.voices, voice] };
}

/** One binaural beat at a time: picking another swaps it, keeping the volume. */
export function setBinaural(scene: Scene, id: BinauralId): Scene {
  if (scene.binaural?.id === id) return scene;
  if (!scene.binaural && isFull(scene)) return scene;
  return { ...scene, binaural: { id, volume: scene.binaural?.volume ?? 0.4, on: true } };
}

export function updateVoice(scene: Scene, id: PointSoundId, patch: Partial<Voice>): Scene {
  return {
    ...scene,
    voices: scene.voices.map((v) =>
      v.id === id
        ? {
            ...v,
            ...patch,
            angle: wrapAngle(patch.angle ?? v.angle),
            radius: clamp(patch.radius ?? v.radius, R_MIN, 1),
            volume: clamp(patch.volume ?? v.volume, 0, 1),
          }
        : v,
    ),
  };
}

export function updateBinaural(scene: Scene, patch: Partial<BinauralLayer>): Scene {
  if (!scene.binaural) return scene;
  return {
    ...scene,
    binaural: {
      ...scene.binaural,
      ...patch,
      volume: clamp(patch.volume ?? scene.binaural.volume, 0, 1),
    },
  };
}

export function removeVoice(scene: Scene, id: PointSoundId): Scene {
  return { ...scene, voices: scene.voices.filter((v) => v.id !== id) };
}

/** Put a removed voice back where it was in the list (undo). */
export function restoreVoice(scene: Scene, voice: Voice, index: number): Scene {
  if (scene.voices.some((v) => v.id === voice.id) || isFull(scene)) return scene;
  const voices = [...scene.voices];
  voices.splice(Math.min(index, voices.length), 0, voice);
  return { ...scene, voices };
}

export function sceneFromMix(mixId: string, master: number): Scene {
  const mix = MIXES.find((m) => m.id === mixId);
  if (!mix) return { ...EMPTY_SCENE, master };
  return {
    voices: mix.voices.map(([id, angle, radius, volume]) => ({
      id,
      angle,
      radius,
      volume,
      on: true,
      wander: pointSound(id).wander === true,
    })),
    binaural: mix.binaural ? { id: mix.binaural[0], volume: mix.binaural[1], on: true } : null,
    master,
    mixName: mix.name,
  };
}

/** What a sound's row and card say under its name. */
export function voiceSubtitle(v: Voice, soloId: PointSoundId | null): string {
  const tags = [!v.on ? "Paused" : null, soloId === v.id ? "Solo" : null].filter(Boolean);
  return [...tags, placeLabel(v)].join(" · ");
}

export function binauralSubtitle(b: BinauralLayer): string {
  return `${b.on ? "" : "Paused · "}${binauralBeat(b.id).hint} · headphones`;
}
