// The contact/company page's linked-work area: one FIXED section per module
// relation (Tasks · Notes · Emails · Events · Payments · Other), always
// rendered — an empty section is a quiet promise of what will roll up there,
// not an omission (designer decision 2026-07-02, supersedes the omit-empty
// semantic buckets on the *page* variant only; the Tasks rail keeps EntityHub).
// Rows are the spine's EntityHubRow; grouping is by the other endpoint's type.

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EntityLink, EntityRef, RelationKind } from "@/lib/entity-links";
import type { HubStatus } from "../../spine/hooks/use-entity-hub";
import { type HubRow, type HubSection, isSectionTruncated, visibleRows } from "../../spine/rollup";
import { EntityHubRow } from "../../spine/ui/entity-hub";

const SECTION_HEADING =
  "font-sans text-2xs font-medium uppercase tracking-wide text-muted-foreground";

/** The fixed page sections, one per module relation. Order is the page order. */
const MODULE_SECTIONS = [
  { key: "tasks", label: "Tasks", types: ["task", "project"], empty: "No linked tasks yet." },
  { key: "notes", label: "Notes", types: ["note"], empty: "No linked notes yet." },
  {
    key: "emails",
    label: "Emails",
    types: ["email"],
    empty: "Fills automatically when Email syncs.",
  },
  {
    key: "events",
    label: "Events",
    types: ["event"],
    empty: "Fills from Calendar when events link here.",
  },
  {
    key: "payments",
    label: "Payments",
    types: ["payment", "invoice"],
    empty: "Invoices and payments land here when Finance ships.",
  },
] as const;

export type LinkedSectionsProps = {
  status: HubStatus;
  /** Pre-filtered hub sections (the semantic grouping is ignored; rows are regrouped by type). */
  sections: HubSection[];
  canEdit?: boolean;
  onOpen?: (ref: EntityRef) => void;
  onChangeKind?: (link: EntityLink, kind: RelationKind) => void;
  onUnlink?: (link: EntityLink) => void;
  onRetry?: () => void;
};

export function LinkedSections({
  status,
  sections,
  canEdit = false,
  onOpen,
  onChangeKind,
  onUnlink,
  onRetry,
}: LinkedSectionsProps) {
  if (status === "loading") {
    return (
      <div className="space-y-4" aria-busy="true">
        {MODULE_SECTIONS.slice(0, 3).map((s) => (
          <div key={s.key} className="space-y-1">
            <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            <div className="flex min-h-8 items-center gap-2 px-2 py-1">
              <div className="size-icon-sm shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
        <span className="text-destructive">Couldn’t load links.</span>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    );
  }

  const all = sections.flatMap((s) => s.rows);
  const claimed = new Set<HubRow>();
  const buckets = MODULE_SECTIONS.map((def) => {
    const rows = all.filter((r) => (def.types as readonly string[]).includes(r.other.type));
    rows.forEach((r) => {
      claimed.add(r);
    });
    return { ...def, rows };
  });
  const other = all.filter((r) => !claimed.has(r));

  return (
    <div className="space-y-5">
      {buckets.map((section) => (
        <ModuleSection
          key={section.key}
          label={section.label}
          rows={section.rows}
          emptyText={section.empty}
          canEdit={canEdit}
          onOpen={onOpen}
          onChangeKind={onChangeKind}
          onUnlink={onUnlink}
        />
      ))}
      {other.length > 0 ? (
        <ModuleSection
          label="Other"
          rows={other}
          emptyText=""
          canEdit={canEdit}
          onOpen={onOpen}
          onChangeKind={onChangeKind}
          onUnlink={onUnlink}
        />
      ) : null}
    </div>
  );
}

function ModuleSection({
  label,
  rows,
  emptyText,
  canEdit,
  onOpen,
  onChangeKind,
  onUnlink,
}: {
  label: string;
  rows: HubRow[];
  emptyText: string;
  canEdit: boolean;
  onOpen?: (ref: EntityRef) => void;
  onChangeKind?: (link: EntityLink, kind: RelationKind) => void;
  onUnlink?: (link: EntityLink) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const section: HubSection = { key: "other", label, rows, count: rows.length };
  const visible = visibleRows(section, expanded);
  const truncated = isSectionTruncated(section);

  return (
    <section className="space-y-1">
      <div className="flex items-center gap-2">
        <h3 className={SECTION_HEADING}>{label}</h3>
        {rows.length > 0 ? (
          <Badge variant="secondary" className="px-1.5 py-0 text-2xs tabular-nums">
            {rows.length}
          </Badge>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="px-2 py-0.5 text-sm text-muted-foreground/70">{emptyText}</p>
      ) : (
        <div className="space-y-1">
          {visible.map((row) => (
            <EntityHubRow
              key={row.link.id}
              row={row}
              variant="page"
              canEdit={canEdit}
              onOpen={onOpen}
              onChangeKind={onChangeKind}
              onUnlink={onUnlink}
            />
          ))}
          {truncated && !expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded-sm font-sans text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Show all ({rows.length})
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
