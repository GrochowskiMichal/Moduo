// Printing a layout (TV-D14): the time report's "Export PDF" and a view's
// print layout. The page renders the printable document into a `PrintRoot`
// (components/app/print-root.tsx); global.css hides everything else on paper.
// The system dialog's "Save as PDF" makes the file: the browser's print, or on
// the desktop the `print_page` command (WKWebView ignores `window.print()`).

import { isTauriRuntime } from "./runtime";

/** Open the print dialog for this window. */
export async function printPage(): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("print_page");
    return;
  }
  window.print();
}
