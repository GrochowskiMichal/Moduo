// What happens when a pomodoro phase ends while someone is looking (TV-F1, F1-5):
// the chime, and — only when Moduo is in the background — one OS notification
// on desktop or one in-app toast on the web. Phase ends caught up after an away
// gap never alert; the away prompt tells that story instead.
//
// The plugin can't schedule on desktop, so the engine calls this at the
// computed phase end; `backgroundThrottling: "disabled"` keeps its timers on
// time while the window is hidden (macOS 14+).

import { toast } from "sonner";

import { readLocalFocusPrefs } from "../../lib/focus-prefs";
import { areSoundsEnabled } from "../../lib/preferences";
import { isTauriRuntime } from "../../lib/runtime";
import type { FocusPhase, FocusPhaseEnd } from "./engine-core";

/** The phase the session is in right after the end. */
export interface FocusPhaseNext {
  phase: FocusPhase;
  longBreak: boolean;
  lengthMs: number;
  /** It started by itself (auto-start); false = waiting for Resume. */
  running: boolean;
}

export interface FocusAlertCopy {
  title: string;
  body: string;
}

function minutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000));
}

export function phaseEndCopy(end: FocusPhaseEnd, next: FocusPhaseNext): FocusAlertCopy {
  if (end.phase === "work") {
    const kind = next.longBreak ? "long break" : "break";
    return {
      title: "Focus block done",
      body: next.running
        ? `Your ${minutes(next.lengthMs)}-min ${kind} has started.`
        : `Start your ${minutes(next.lengthMs)}-min ${kind} when you're ready.`,
    };
  }
  return {
    title: "Break's over",
    body: next.running
      ? `Your next ${minutes(next.lengthMs)}-min focus block has started.`
      : "Resume when you're ready.",
  };
}

/** Moduo isn't the window you're looking at (hidden, minimized, or another app in front). */
export function isAppInBackground(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "hidden" || !document.hasFocus();
}

export function alertPhaseEnd(end: FocusPhaseEnd, next: FocusPhaseNext): void {
  const prefs = readLocalFocusPrefs();
  // The Focus chime respects its own toggle and the app-wide sound switch.
  if (prefs.soundEnabled && areSoundsEnabled()) playChime();
  if (!isAppInBackground()) return;
  const copy = phaseEndCopy(end, next);
  if (isTauriRuntime()) void notifyDesktop(copy);
  // Sonner holds a toast's timer while the page is hidden, so it's still there
  // when you come back.
  else toast(copy.title, { description: copy.body });
}

async function notifyDesktop(copy: FocusAlertCopy): Promise<void> {
  try {
    const notification = await import("@tauri-apps/plugin-notification");
    let granted = await notification.isPermissionGranted();
    if (!granted) granted = (await notification.requestPermission()) === "granted";
    if (granted) {
      notification.sendNotification({ title: copy.title, body: copy.body });
      return;
    }
  } catch (error) {
    console.warn("[focus] desktop notification failed", error);
  }
  // No OS notification: leave the same note in the app for when you're back.
  toast(copy.title, { description: copy.body });
}

/** A short end-of-interval chime via Web Audio: no asset. Silent where Web Audio
 *  is unavailable (or a backgrounded webview won't play it). */
function playChime(): void {
  if (typeof window === "undefined") return;
  const Ctx =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = 880;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.start(t);
    osc.stop(t + 0.42);
    osc.onended = () => void ctx.close();
  } catch {
    /* audio unavailable — silent */
  }
}
