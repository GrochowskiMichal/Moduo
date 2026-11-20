// MR-13 — Mail's one way into search: ⌘K on the Email chip (AC32).

import { dispatchOpenPalette } from "../../../components/app/global-command-palette";

export function openMailSearch(query?: string): void {
  dispatchOpenPalette({ chip: "email", ...(query !== undefined ? { query } : {}) });
}
