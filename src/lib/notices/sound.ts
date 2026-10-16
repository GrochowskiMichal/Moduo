// Chat's one soft sound (CV-6b, CH34): for direct messages and `@you`, off by
// default, one switch (Settings → Preferences → Chat). Web Audio, no asset;
// silent where audio is unavailable or the app-wide sound switch is off.

import { areSoundsEnabled, currentPreferences } from "../preferences";
import type { NoticeDelivery } from "./deliveries";
import { chatNoticeSwitch } from "./ring";

/** Whether this notice gets the sound: a direct message or one that names you. */
export function soundsForNotice(
  delivery: Pick<NoticeDelivery, "kind">,
  conversationKind: string | null,
): boolean {
  if (delivery.kind === "chat_mention") return true;
  return chatNoticeSwitch(delivery, conversationKind) === "chatDirect";
}

/** Two quiet descending notes, under half a second. */
export function playChatSound(): void {
  if (!currentPreferences().chatSound || !areSoundsEnabled()) return;
  if (typeof window === "undefined") return;
  const Ctx =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.setValueAtTime(523, t + 0.12);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.44);
    osc.onended = () => void ctx.close();
  } catch {
    /* audio unavailable: silent */
  }
}
