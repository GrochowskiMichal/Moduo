// Where a printable layout lives while it's mounted (TV-D14): a portal at the
// body's top level, hidden on screen; on paper global.css shows only it, in
// the light theme whatever the app's. See lib/print.ts.

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export function PrintRoot({ label, children }: { label: string; children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      data-print-root=""
      data-theme="light"
      aria-label={label}
      className="bg-card font-sans text-sm text-foreground"
    >
      {children}
    </div>,
    document.body,
  );
}
