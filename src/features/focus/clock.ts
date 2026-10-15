// How a Focus clock reads in the chrome (tasks-v3 call 96): "18:02",
// "Break 4:12". The Focus view's own clock still pads minutes ("04:12") until
// Focus is rebuilt (62a); new Focus surfaces should use this one.

/** "4:12" under an hour, "1:04:12" from an hour on. */
export function formatFocusClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
