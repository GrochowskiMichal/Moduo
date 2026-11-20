// Soundspace — playback, app-wide. One space plays at a time (the widget that
// last pressed play "owns" it) and keeps playing while you move between
// modules; the top-bar chip pauses it from anywhere. The scene itself is saved
// in the widget's config; this store holds only what is live: who plays, what,
// solo and the sleep timer.
//
// The AudioContext is created inside the click that starts playback (browsers
// only let sound start from a gesture); the engine code loads on first play.

import { useSyncExternalStore } from "react";

import type { EngineState, SoundspaceEngine } from "./audio/engine";
import type { PointSoundId } from "./catalog";
import { type Scene, voiceCount } from "./model";

export const SLEEP_OPTIONS = [0, 25, 50, 90] as const;
export type SleepMinutes = (typeof SLEEP_OPTIONS)[number];

export interface PlaybackSnapshot {
  /** The widget whose space is loaded, or null before anything played. */
  ownerId: string | null;
  scene: Scene | null;
  playing: boolean;
  solo: PointSoundId | null;
  sleepMinutes: SleepMinutes;
  /** Epoch ms when the sleep timer pauses playback. */
  sleepEndsAt: number | null;
}

const IDLE: PlaybackSnapshot = {
  ownerId: null,
  scene: null,
  playing: false,
  solo: null,
  sleepMinutes: 0,
  sleepEndsAt: null,
};

let snapshot: PlaybackSnapshot = IDLE;
const listeners = new Set<() => void>();
let ctx: AudioContext | null = null;
let engine: SoundspaceEngine | null = null;
let loading: Promise<void> | null = null;
let sleepTimer: ReturnType<typeof setTimeout> | null = null;

function emit(next: Partial<PlaybackSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
  const s = snapshot;
  if (s.scene && engine) engine.apply(engineState(s));
}

function engineState(s: PlaybackSnapshot): EngineState {
  return { scene: s.scene!, playing: s.playing && voiceCount(s.scene!) > 0, solo: s.solo };
}

/** Make the AudioContext in the gesture, then load the engine behind it. */
function ensureEngine(): void {
  if (engine || loading) return;
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return;
  ctx ??= new AudioContext({ latencyHint: "playback" });
  void ctx.resume();
  const forCtx = ctx;
  loading = import("./audio/engine").then(({ SoundspaceEngine }) => {
    loading = null;
    if (ctx !== forCtx) return; // stopped meanwhile
    engine = new SoundspaceEngine(forCtx);
    if (snapshot.scene) engine.apply(engineState(snapshot));
  });
}

export function subscribeSoundspace(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSoundspaceSnapshot(): PlaybackSnapshot {
  return snapshot;
}

export function useSoundspacePlayback(): PlaybackSnapshot {
  return useSyncExternalStore(subscribeSoundspace, getSoundspaceSnapshot, getSoundspaceSnapshot);
}

/** Start (or take over) playback with this widget's scene. Call from a click. */
export function playSoundspace(ownerId: string, scene: Scene): void {
  ensureEngine();
  if (ctx?.state === "suspended") void ctx.resume();
  const sameOwner = snapshot.ownerId === ownerId;
  emit({ ownerId, scene, playing: true, solo: sameOwner ? snapshot.solo : null });
}

export function pauseSoundspace(): void {
  if (!snapshot.playing) return;
  emit({ playing: false });
}

/** The scene changed in the widget: play the change if this widget owns the space. */
export function syncSoundspace(ownerId: string, scene: Scene): void {
  if (snapshot.ownerId !== ownerId) return;
  const solo =
    snapshot.solo && scene.voices.some((v) => v.id === snapshot.solo) ? snapshot.solo : null;
  emit({ scene, solo });
}

export function setSoundspaceSolo(ownerId: string, id: PointSoundId | null): void {
  if (snapshot.ownerId !== ownerId) return;
  emit({ solo: id });
}

/** Pause after `minutes` (0 turns the timer off). */
export function setSoundspaceSleep(minutes: SleepMinutes): void {
  if (sleepTimer) clearTimeout(sleepTimer);
  sleepTimer = null;
  if (!minutes) {
    emit({ sleepMinutes: 0, sleepEndsAt: null });
    return;
  }
  const endsAt = Date.now() + minutes * 60_000;
  sleepTimer = setTimeout(() => {
    sleepTimer = null;
    emit({ playing: false, sleepMinutes: 0, sleepEndsAt: null });
  }, minutes * 60_000);
  emit({ sleepMinutes: minutes, sleepEndsAt: endsAt });
}

/** Silence and release everything (sign-out, the app shell going away). */
export function stopSoundspace(): void {
  if (sleepTimer) clearTimeout(sleepTimer);
  sleepTimer = null;
  engine?.dispose();
  if (!engine && ctx) void ctx.close();
  engine = null;
  ctx = null;
  loading = null;
  snapshot = IDLE;
  listeners.forEach((l) => l());
}
