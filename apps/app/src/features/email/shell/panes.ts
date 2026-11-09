// The shell's panes and keyboard focus between them (specs/mail-v3.md §7;
// specs/mail-improve.md §6): Enter moves into the reader, F6 / ⇧F6 cycle rail → list →
// reader → side panel, landing on each pane's current item.

/** Moves keyboard focus into the reader (Enter, spec §7): its title, else the slot. */
export function focusIn(root: HTMLElement | null): boolean {
  if (!root) return false;
  const target = root.querySelector<HTMLElement>("[data-reader-title], h1, h2") ?? root;
  if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
  target.focus({ preventScroll: true });
  return true;
}

/** The panes F6 cycles (specs/mail-improve.md §6): rail, list, reader, the side panel. */
const PANES = [
  '[data-mail-pane="rail"]',
  '[data-mail-pane="list"]',
  '[data-mail-pane="reader"]',
  "[data-mail-panel], [data-mail-panel-strip]",
] as const;

/** Where focus lands in a pane: its current item, else its first control, else itself. */
function focusPane(pane: HTMLElement, i: number): void {
  const first = (...sels: string[]) =>
    sels.reduce<HTMLElement | null>(
      (hit, sel) => hit ?? pane.querySelector<HTMLElement>(sel),
      null,
    );
  const pick =
    i === 0
      ? first('[data-rail-body] [tabindex="0"]', '[aria-current="page"]', "button:not([disabled])")
      : i === 1
        ? (pane.querySelector<HTMLElement>('[aria-selected="true"][data-thread-id]') ??
          pane.querySelector<HTMLElement>('[role="listbox"]'))
        : i === 2
          ? null
          : pane.querySelector<HTMLElement>('button:not([disabled]), [tabindex="0"]');
  if (i === 2 && focusIn(pane)) return;
  const target = pick ?? pane;
  if (!target.hasAttribute("tabindex") && !target.matches("button, a[href]")) target.tabIndex = -1;
  target.focus({ preventScroll: true });
}

/** F6 / ⇧F6: the next or previous pane that is on screen. */
export function cyclePane(delta: 1 | -1): void {
  const panes = PANES.map((sel) => document.querySelector<HTMLElement>(sel));
  const at = document.activeElement;
  const here = panes.findIndex((p) => p && at && p.contains(at));
  const n = panes.length;
  let i = here < 0 ? (delta === 1 ? -1 : 0) : here;
  for (let step = 0; step < n; step++) {
    i = (i + delta + n) % n;
    const pane = panes[i];
    if (pane) {
      focusPane(pane, i);
      return;
    }
  }
}
