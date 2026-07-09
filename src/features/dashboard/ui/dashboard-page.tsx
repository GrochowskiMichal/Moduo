import { useState } from "react";

import { createDefaultLayout } from "../engine/default-layout";
import { GridCanvas } from "./grid-canvas";

/**
 * The Home feature root. Full-bleed — it owns the whole content area (no
 * FeaturePanelsShell, no left/right rails; the grid IS the page, per the spec).
 *
 * DB-2 seeds the curated default layout and renders its first page statically.
 * The layers still to come: DB-3 (edit mode + drag), DB-4 (Supabase-synced
 * layout state + multi-page pager/dots replacing this local seed), DB-5 (the
 * widget registry + real data behind each frame).
 */
export function DashboardPage() {
  const [layout] = useState(createDefaultLayout);
  const page = layout.pages[0];

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="min-h-0 flex-1 p-4">
        <GridCanvas widgets={page.widgets} />
      </div>
    </div>
  );
}
