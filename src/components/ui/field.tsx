import * as React from "react";

import { Eyebrow } from "@/components/ui/eyebrow";

/**
 * A full-width, uppercase-labeled section — the collection-section pattern lifted
 * out of the Tasks detail panel for reuse across detail surfaces (Tasks today,
 * the spine `EntityHub` next). Pairs the quiet `Mirror` ambient row below.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Eyebrow className="block">{label}</Eyebrow>
      {children}
    </div>
  );
}

/**
 * A quiet, factual ambient row — icon + muted text, never alarming (design
 * principles 4 & 5). Used for drift/blocked/reschedule mirrors and, in the
 * spine, for tombstone/sync hints.
 */
function Mirror({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="shrink-0 text-muted-foreground/70">{icon}</span>
      {children}
    </span>
  );
}

export { Field, Mirror };
