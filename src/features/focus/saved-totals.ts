// TV-F1 kept, per person and device, the total each task's focus time was last
// saved with, because the Tasks sink wrote an absolute total. Since TV-D3 a save
// adds a stretch through `tasks_op_track_time` and the server keeps the total,
// so nothing reads or writes that map any more. Account deletion still erases
// what an older build left on this device.

/** One map per person (erased with their focus record on account deletion). */
export const FOCUS_SAVED_TOTALS_PREFIX = "moduo:tasks:focus:saved:";

export function forgetSavedFocusTotals(userId: string): void {
  try {
    localStorage.removeItem(`${FOCUS_SAVED_TOTALS_PREFIX}${userId}`);
  } catch {
    /* storage unavailable — nothing to erase */
  }
}
