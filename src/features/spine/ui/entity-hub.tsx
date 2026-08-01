// Connective-tissue spine — the reusable EntityHub roll-up (block CT-2).
//
// ONE component, owned by the spine, that every module renders for the selected
// entity (Tasks today, Contacts next). Consumers pick a `variant` (rail | page)
// and supply callbacks + per-type snippet projectors; they never re-implement
// it. Presentational + controlled: data comes from `useEntityHub`; this file
// renders sections grouped by the fixed order, with counts, "Show all (N)",
// tombstone dimming, and the empty/loading/error states (AC6, AC14).

import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import {
  type EntityLink,
  type EntityRef,
  RELATION_KIND_LABELS,
  type RelationKind,
} from "@/lib/entity-links";
import { cn } from "@/lib/utils";
import type { HubStatus } from "../hooks/use-entity-hub";
import { resolveEntityIcon } from "../icon-map";
import { allowedKinds } from "../kind-constraints";
import { type HubRow, type HubSection, isSectionTruncated, visibleRows } from "../rollup";

export type EntityHubProps = {
  /** Right-rail (compact) vs center-page (roomier) presentation. */
  variant?: "rail" | "page";
  status: HubStatus;
  sections: HubSection[];
  /** When false, all link gestures (change kind / remove) are hidden (read-only). */
  canEdit?: boolean;
  onOpen?: (ref: EntityRef) => void;
  onChangeKind?: (link: EntityLink, kind: RelationKind) => void;
  onUnlink?: (link: EntityLink) => void;
  onRetry?: () => void;
  className?: string;
};

export function EntityHub({
  variant = "rail",
  status,
  sections,
  canEdit = false,
  onOpen,
  onChangeKind,
  onUnlink,
  onRetry,
  className,
}: EntityHubProps) {
  if (status === "loading") {
    return (
      <div className={cn("space-y-4", className)} aria-busy="true">
        <HubSectionSkeleton rows={3} />
        <HubSectionSkeleton rows={2} />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        className={cn(
          "flex flex-col items-start gap-2 rounded-md border border-border bg-card p-3 text-sm text-muted-foreground",
          className,
        )}
      >
        <span className="text-destructive">Couldn’t load links.</span>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <div className={className}>
        <EmptyState title="Nothing linked yet" description="Drag, @mention, or /ref to connect." />
      </div>
    );
  }

  return (
    <div className={cn(variant === "page" ? "space-y-6" : "space-y-4", className)}>
      {sections.map((section) => (
        <EntityHubSection
          key={section.key}
          section={section}
          variant={variant}
          canEdit={canEdit}
          onOpen={onOpen}
          onChangeKind={onChangeKind}
          onUnlink={onUnlink}
        />
      ))}
    </div>
  );
}

type SectionProps = {
  section: HubSection;
  variant: "rail" | "page";
  canEdit: boolean;
  onOpen?: (ref: EntityRef) => void;
  onChangeKind?: (link: EntityLink, kind: RelationKind) => void;
  onUnlink?: (link: EntityLink) => void;
};

export function EntityHubSection({
  section,
  variant,
  canEdit,
  onOpen,
  onChangeKind,
  onUnlink,
}: SectionProps) {
  const [expanded, setExpanded] = useState(false);
  const rows = visibleRows(section, expanded);
  const truncated = isSectionTruncated(section);

  return (
    <section className="space-y-1">
      {/* Uppercase section label (the Field pattern) + count. */}
      <div className="flex items-center gap-2">
        <span className="font-sans text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          {section.label}
        </span>
        <Badge variant="secondary" className="px-1.5 py-0 text-2xs tabular-nums">
          {section.count}
        </Badge>
      </div>
      <div className={cn(variant === "page" ? "space-y-1" : "space-y-0.5")}>
        {rows.map((row) => (
          <EntityHubRow
            key={row.link.id}
            row={row}
            variant={variant}
            canEdit={canEdit}
            onOpen={onOpen}
            onChangeKind={onChangeKind}
            onUnlink={onUnlink}
          />
        ))}
      </div>
      {truncated && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rounded-sm font-sans text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Show all ({section.count})
        </button>
      ) : null}
    </section>
  );
}

type RowProps = {
  row: HubRow;
  /** rail keeps the compact uppercase relation tag; page renders it quieter. */
  variant?: "rail" | "page";
  canEdit: boolean;
  onOpen?: (ref: EntityRef) => void;
  onChangeKind?: (link: EntityLink, kind: RelationKind) => void;
  onUnlink?: (link: EntityLink) => void;
};

export function EntityHubRow({
  row,
  variant = "rail",
  canEdit,
  onOpen,
  onChangeKind,
  onUnlink,
}: RowProps) {
  // Neutral, monochrome — the type icon (not color) distinguishes a task from a
  // contact (R5: accent reserved; color is never the only signal).
  const Icon = resolveEntityIcon(row.other.type, row.icon);

  return (
    <div
      className={cn(
        "group flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-sm",
        "hover:bg-accent",
        row.tombstoned && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen?.(row.other)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate text-foreground">{row.title}</span>
        {row.snippet ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">· {row.snippet}</span>
        ) : null}
        {/* Provenance caption on a company's union rows (FX-7): "· via Jane Cooper". */}
        {row.via ? (
          <span className="shrink-0 truncate text-xs text-muted-foreground/70">
            · via {row.via}
          </span>
        ) : null}
        {variant === "page" ? (
          // The page card is calmer: sentence-case caption, and the default
          // "references" kind (no information) renders nothing at all.
          row.relationKind !== "references" ? (
            <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground/70">
              {RELATION_KIND_LABELS[row.relationKind]}
            </span>
          ) : null
        ) : (
          <span className="ml-auto shrink-0 pl-2 text-2xs uppercase tracking-wide text-muted-foreground/70">
            {RELATION_KIND_LABELS[row.relationKind]}
          </span>
        )}
      </button>

      {canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              icon={MoreHorizontal}
              label="Link actions"
              tooltip={null}
              size="sm"
              variant="ghost"
              className="shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onOpen?.(row.other)}>Open</DropdownMenuItem>
            {row.tombstoned ? null : (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Change relation</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {/* Only kinds sensible for THIS endpoint pair (FX-5) — no
                      `attachment`/`paid-by`/`works-at` between two people. */}
                  {allowedKinds(row.link.sourceType, row.link.targetType).map((kind) => (
                    <DropdownMenuItem
                      key={kind}
                      disabled={kind === row.relationKind}
                      onSelect={() => onChangeKind?.(row.link, kind)}
                    >
                      {RELATION_KIND_LABELS[kind]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onUnlink?.(row.link)}>
              Remove link
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function HubSectionSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-1">
      <div className="h-3 w-20 animate-pulse rounded bg-muted" />
      <div className="space-y-0.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex min-h-8 items-center gap-2 px-2 py-1">
            <div className="size-icon-sm shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
