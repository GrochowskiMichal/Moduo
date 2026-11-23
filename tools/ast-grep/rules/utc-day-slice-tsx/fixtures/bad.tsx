// Pre-fix shapes: every `@flag` line must be reported.
export function dueChipDay(task: { dueDate: string }) {
  // @flag
  return new Date(task.dueDate).toISOString().slice(0, 10);
}

export function todayKey() {
  // @flag
  return new Date().toISOString().split("T")[0];
}

export function untilDay(until: Date) {
  // @flag
  return until.toJSON().substring(0, 10);
}
