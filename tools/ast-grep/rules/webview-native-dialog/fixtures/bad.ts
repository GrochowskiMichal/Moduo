// Pre-fix shapes: every `@flag` line must be reported.
export function closeGuard(e: Event) {
  // @flag
  if (!window.confirm("Discard changes?")) e.preventDefault();
}

export function askUrl() {
  // @flag
  return window.prompt("Link URL");
}

export function warn() {
  // @flag
  globalThis.alert("Saved");
}
