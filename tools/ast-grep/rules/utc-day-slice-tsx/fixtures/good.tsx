// Fixed shapes: nothing here may be reported.
import { localDayOf } from "@/lib/task-rows";
import { toFloating } from "@/lib/zoned-time";

export function dueChipDay(task: { dueDate: string }) {
  return localDayOf(task.dueDate);
}

export function dayInZone(at: Date, zone: string) {
  // The wall clock is already in the UTC digits.
  return toFloating(at, zone).toISOString().slice(0, 10);
}

export function stamp(at: Date) {
  // A full instant, not a day.
  return at.toISOString();
}

export function hourOf(at: Date) {
  return at.toISOString().slice(11, 13);
}
