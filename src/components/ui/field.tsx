import * as React from "react";

/**
 * A full-width, uppercase-labeled section — the collection-section pattern lifted
 * out of the Tasks detail panel for reuse across detail surfaces (Tasks today,
 * the spine `EntityHub` next). Pairs the quiet `Mirror` ambient row below.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="block font-sans text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
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
