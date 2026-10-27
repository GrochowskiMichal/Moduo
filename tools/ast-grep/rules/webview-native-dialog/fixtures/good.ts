// Fixed shapes: nothing here may be reported.
export async function closeGuard(ask: (q: string) => Promise<boolean>, e: Event) {
  if (!(await ask("Discard changes?"))) e.preventDefault();
}

export function open(url: string) {
  window.open(url, "_blank");
}
