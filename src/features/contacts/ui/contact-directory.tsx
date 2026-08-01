// The Contacts directory rail (CO-2 + v2 + FX-3): people OR companies with a
// pinned Favorites group, iOS-style A–Z letter separators (or a flat Recent
// list), search across the widened field set, status/tag filters, counts on
// the segmented control, and arrow/Enter keyboard navigation. Rows are
// presentational; selection + data come from the page. Tokens only (R7/R10).

import {
  ArrowDownAZ,
  Building2,
  Copy,
  History,
  Plus,
  Search,
  Star,
  Upload,
  User,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { entityDrag } from "@/lib/drag-payload";
import { cn } from "@/lib/utils";
import { useDragPayload } from "../../spine/hooks/use-drag-payload";
import type { Tag, TagLink } from "../../tasks/model";
import { findDuplicateGroups } from "../dedupe";
import {
  type DirectorySort,
  filterCompanies,
  filterPeople,
  personSecondary,
  STATUS_FILTER_NONE,
  sortRecent,
} from "../directory-query";
import { groupByLetter } from "../letter-index";
import type { Company, Contact } from "../model";
import { contactStatusMeta, DEFAULT_CONTACT_STATUSES } from "../status";
import { ContactStatusDot } from "./contact-status-badge";

export type DirectoryFilter = "people" | "companies";

/** A selected directory entity — a person or a company. */
export type DirectorySelection = { type: "contact" | "company"; id: string };

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type RowProps = {
  rowId: string;
  avatarUrl: string | null;
  name: string;
  secondary: string | null;
  status?: string;
  selected: boolean;
  /** Keyboard-nav highlight (visual only; Tab/focus rings stay native). */
  highlighted?: boolean;
  favorite?: boolean;
  onSelect: () => void;
  onToggleFavorite?: () => void;
  /** Drag-to-link wiring (FX-9), supplied only by DraggableRow. */
  dragRef?: (node: HTMLElement | null) => void;
  dragHandleProps?: Record<string, unknown>;
  dragging?: boolean;
};

function DirectoryRow({
  rowId,
  avatarUrl,
  name,
  secondary,
  status,
  selected,
  highlighted,
  favorite,
  onSelect,
  onToggleFavorite,
  dragRef,
  dragHandleProps,
  dragging,
}: RowProps) {
  return (
    <div
      id={rowId}
      ref={dragRef}
      {...dragHandleProps}
      className={cn(
        // scroll-mt keeps a keyboard-highlighted row clear of the sticky
        // letter header when scrolled into view.
        "group relative flex w-full scroll-mt-6 items-center gap-2.5 rounded-md px-2 py-1.5",
        selected ? "bg-(--selected-bg)" : highlighted ? "bg-accent/50" : "hover:bg-accent/60",
        dragHandleProps && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-50",
      )}
    >
      {/* selected marker — the app-wide R5 recipe: quiet accent bar + tint */}
      {selected ? (
        <span className="absolute inset-y-1 left-0.5 w-0.5 rounded-full bg-primary" aria-hidden />
      ) : null}
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
      >
        <Avatar size="sm" className="shrink-0">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">{name}</span>
          {secondary ? (
            <span className="block truncate text-xs text-muted-foreground">{secondary}</span>
          ) : null}
        </span>
      </button>
      {/* Star sits INSIDE the dot column (dots are on ~every row, stars are rare —
          the frequent signal owns the outer edge so the column reads aligned). */}
      {onToggleFavorite ? (
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={favorite}
          className={cn(
            "shrink-0 rounded-sm p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            favorite
              ? "text-warning"
              : "text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:text-foreground",
          )}
        >
          <Star className={cn("size-icon-sm", favorite && "fill-current")} aria-hidden />
        </button>
      ) : null}
      {status ? <ContactStatusDot status={status} className="shrink-0" /> : null}
    </div>
  );
}

/** A directory row wired as a spine entity drag source (FX-9). Only rendered
 * when the page enables drag (so useDraggable always sits under a DndContext).
 * Pointer-drag only — we spread `listeners`, not `attributes`, to keep the row's
 * click-to-select semantics (no extra tab stop / role on the row). */
function DraggableRow({
  entity,
  label,
  rowProps,
}: {
  entity: DirectorySelection;
  label: string;
  rowProps: RowProps;
}) {
  const { setNodeRef, listeners, isDragging } = useDragPayload(
    entityDrag({ type: entity.type, id: entity.id }, { label, from: "contacts-directory" }),
  );
  return (
    <DirectoryRow
      {...rowProps}
      dragRef={setNodeRef}
      dragHandleProps={listeners as Record<string, unknown>}
      dragging={isDragging}
    />
  );
}

function LetterHeader({ letter }: { letter: string }) {
  return (
    <div className="sticky top-0 z-10 bg-card/95 px-2 py-0.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
      {letter}
    </div>
  );
}

type Props = {
  contacts: Contact[];
  companies: Company[];
  status: "loading" | "ready" | "error";
  selected: DirectorySelection | null;
  /** Workspace tags + contact/company tag links (the tag filter's data). */
  workspaceTags?: Tag[];
  tagLinks?: TagLink[];
  onSelect: (sel: DirectorySelection) => void;
  /** When true, rows are entity drag sources (FX-9) — the page must supply a DndContext. */
  draggable?: boolean;
  onNew?: () => void;
  /** Companies-tab "+" — opens the New-company dialog (FX-6). */
  onNewCompany?: () => void;
  onImport?: () => void;
  onToggleFavorite?: (contactId: string) => void;
  onRetry?: () => void;
  /** Refresh the tag-filter data (called when the tag menu opens). */
  onRefreshTags?: () => void;
};

const ALL = "__all__";

export function ContactDirectory({
  contacts,
  companies,
  status,
  selected,
  workspaceTags = [],
  tagLinks = [],
  onSelect,
  draggable = false,
  onNew,
  onNewCompany,
  onImport,
  onToggleFavorite,
  onRetry,
  onRefreshTags,
}: Props) {
  // Seed from the selection so a company deep link doesn't flash the People
  // tab on first paint.
  const [filter, setFilter] = useState<DirectoryFilter>(() =>
    selected?.type === "company" ? "companies" : "people",
  );
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [sort, setSort] = useState<DirectorySort>("alpha");
  // Keyboard highlight is an ID, not an index — reordering (starring a row,
  // an import landing) can't silently move it onto a different record.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Follow the selection's type (a URL deep link can select a company while
  // the People tab is up) — but only when the selection itself changes, so
  // manually browsing the other tab isn't fought.
  useEffect(() => {
    if (!selected) return;
    setFilter(selected.type === "company" ? "companies" : "people");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.type, selected?.id]);

  const companyNameById = useMemo(
    () => new Map(companies.map((c) => [c.id, c.name || "Unnamed company"])),
    [companies],
  );

  const people = useMemo(
    () =>
      filterPeople(contacts, {
        query,
        status: statusFilter,
        tagId: tagFilter,
        tagLinks,
        companyNameById,
      }),
    [contacts, query, statusFilter, tagFilter, tagLinks, companyNameById],
  );
  const orgs = useMemo(
    () => filterCompanies(companies, { query, tagId: tagFilter, tagLinks }),
    [companies, query, tagFilter, tagLinks],
  );

  const favorites = useMemo(() => {
    const favs = people.filter((c) => c.isFavorite);
    return sort === "recent" ? sortRecent(favs) : favs;
  }, [people, sort]);
  // Favorites are pinned above; exclude them from the main list to avoid a
  // confusing double-listing in one scroll.
  const rest = useMemo(() => people.filter((c) => !c.isFavorite), [people]);
  const peopleGroups = useMemo(
    () => (sort === "alpha" ? groupByLetter(rest, (c) => c.name || "Unnamed") : []),
    [rest, sort],
  );
  const peopleRecent = useMemo(() => (sort === "recent" ? sortRecent(rest) : []), [rest, sort]);
  const orgGroups = useMemo(
    () => (sort === "alpha" ? groupByLetter(orgs, (c) => c.name || "Unnamed company") : []),
    [orgs, sort],
  );
  const orgsRecent = useMemo(() => (sort === "recent" ? sortRecent(orgs) : []), [orgs, sort]);
  const dupGroups = useMemo(() => findDuplicateGroups(contacts), [contacts]);

  const showingPeople = filter === "people";
  const isEmpty = (showingPeople ? people.length : orgs.length) === 0;
  // Status only applies (and only shows) on the People tab.
  const filtersActive = !!(tagFilter || (showingPeople && statusFilter));

  // Filter options = the defaults ∪ any renamed/custom status actually in use
  // (statuses are free strings — a renamed one must stay filterable).
  const statusOptions = useMemo(() => {
    const opts = [...DEFAULT_CONTACT_STATUSES];
    const known = new Set(opts.map((o) => o.id));
    for (const c of contacts) {
      if (c.status && !known.has(c.status)) {
        known.add(c.status);
        opts.push(contactStatusMeta(c.status));
      }
    }
    return opts;
  }, [contacts]);

  // The flat, render-ordered row list keyboard nav walks (favorites first).
  const flatRows = useMemo<DirectorySelection[]>(() => {
    if (showingPeople) {
      const ordered = sort === "alpha" ? peopleGroups.flatMap((g) => g.items) : peopleRecent;
      return [...favorites, ...ordered].map((c) => ({ type: "contact" as const, id: c.id }));
    }
    const ordered = sort === "alpha" ? orgGroups.flatMap((g) => g.items) : orgsRecent;
    return ordered.map((c) => ({ type: "company" as const, id: c.id }));
  }, [showingPeople, sort, favorites, peopleGroups, peopleRecent, orgGroups, orgsRecent]);

  const highlightIndexById = useMemo(() => {
    const map = new Map<string, number>();
    flatRows.forEach((r, i) => {
      map.set(r.id, i);
    });
    return map;
  }, [flatRows]);
  const highlightIndex = highlightId != null ? (highlightIndexById.get(highlightId) ?? -1) : -1;

  // Any change to what's visible resets the keyboard highlight.
  useEffect(() => setHighlightId(null), [query, statusFilter, tagFilter, sort, filter]);

  useEffect(() => {
    if (!highlightId) return;
    document.getElementById(`dir-row-${highlightId}`)?.scrollIntoView({ block: "nearest" });
  }, [highlightId]);

  function onKeyDown(event: React.KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const inInput = target?.tagName?.toLowerCase() === "input";
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      // Segmented control / menu triggers own their arrow keys.
      if (target?.closest('[data-slot="segmented-control"],[aria-haspopup]')) return;
      event.preventDefault();
      const next =
        event.key === "ArrowDown"
          ? Math.min(highlightIndex + 1, flatRows.length - 1)
          : highlightIndex <= 0
            ? highlightIndex // ArrowUp with nothing highlighted is a no-op
            : highlightIndex - 1;
      const row = flatRows[next];
      if (row) setHighlightId(row.id);
    } else if (event.key === "Enter") {
      // Never steal Enter from a focused control (row buttons, stars, the
      // dup banner, menu triggers) — only the search input / container path
      // activates the highlight.
      if (target?.closest("button,a,[role='menuitem'],[role='menuitemradio']")) return;
      const row = highlightIndex >= 0 ? flatRows[highlightIndex] : undefined;
      if (row) {
        event.preventDefault();
        onSelect(row);
      }
    } else if (event.key === "/" && !inInput) {
      event.preventDefault();
      searchRef.current?.focus();
    }
  }

  const statusFilterLabel =
    statusFilter === ""
      ? "Status"
      : statusFilter === STATUS_FILTER_NONE
        ? "No status"
        : contactStatusMeta(statusFilter).label;
  const activeTag = tagFilter ? workspaceTags.find((t) => t.id === tagFilter) : undefined;

  const rowProps = (c: Contact): RowProps => ({
    rowId: `dir-row-${c.id}`,
    avatarUrl: c.avatarUrl,
    name: c.name || "Unnamed",
    secondary: personSecondary(c, c.companyId ? (companyNameById.get(c.companyId) ?? null) : null),
    status: c.status,
    favorite: c.isFavorite,
    selected: selected?.type === "contact" && selected.id === c.id,
    highlighted: c.id === highlightId,
    onSelect: () => onSelect({ type: "contact", id: c.id }),
    onToggleFavorite: onToggleFavorite ? () => onToggleFavorite(c.id) : undefined,
  });

  const companyRowProps = (c: Company): RowProps => ({
    rowId: `dir-row-${c.id}`,
    avatarUrl: c.avatarUrl,
    name: c.name || "Unnamed company",
    secondary: c.domains[0] ?? c.website,
    selected: selected?.type === "company" && selected.id === c.id,
    highlighted: c.id === highlightId,
    onSelect: () => onSelect({ type: "company", id: c.id }),
  });

  // Render a row plain, or wrapped as a drag source when the page enables drag.
  const personRow = (c: Contact) => {
    const p = rowProps(c);
    return draggable ? (
      <DraggableRow
        key={p.rowId}
        entity={{ type: "contact", id: c.id }}
        label={c.name || "Unnamed"}
        rowProps={p}
      />
    ) : (
      <DirectoryRow key={p.rowId} {...p} />
    );
  };
  const companyRow = (c: Company) => {
    const p = companyRowProps(c);
    return draggable ? (
      <DraggableRow
        key={p.rowId}
        entity={{ type: "company", id: c.id }}
        label={c.name || "Unnamed company"}
        rowProps={p}
      />
    ) : (
      <DirectoryRow key={p.rowId} {...p} />
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2" onKeyDown={onKeyDown}>
      <div className="flex w-full items-center gap-1">
        <SegmentedControl
          aria-label="Filter directory"
          value={filter}
          onValueChange={(v) => setFilter(v as DirectoryFilter)}
          items={[
            { value: "people", label: `People ${contacts.length}` },
            { value: "companies", label: `Companies ${companies.length}` },
          ]}
          size="sm"
        />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* CSV import is people-only; "+" adds a contact or a company by tab. */}
          {showingPeople && onImport ? (
            <IconButton
              icon={Upload}
              label="Import contacts"
              size="sm"
              variant="ghost"
              onClick={onImport}
            />
          ) : null}
          {showingPeople
            ? onNew && (
                <IconButton
                  icon={Plus}
                  label="New contact"
                  size="sm"
                  variant="ghost"
                  onClick={onNew}
                />
              )
            : onNewCompany && (
                <IconButton
                  icon={Plus}
                  label="New company"
                  size="sm"
                  variant="ghost"
                  onClick={onNewCompany}
                />
              )}
        </div>
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 size-icon-sm -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={showingPeople ? "Search people" : "Search companies"}
          aria-label="Search contacts"
          className="pl-7 pr-2"
        />
      </div>

      {/* Filters + sort — quiet ghost controls on one row (FX-3 AC4). */}
      <div className="flex items-center gap-1">
        {showingPeople ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "gap-1.5",
                  statusFilter ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {statusFilter && statusFilter !== STATUS_FILTER_NONE ? (
                  <ContactStatusDot status={statusFilter} />
                ) : null}
                {statusFilterLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={statusFilter || ALL}
                onValueChange={(v) => setStatusFilter(v === ALL ? "" : v)}
              >
                <DropdownMenuRadioItem value={ALL}>All statuses</DropdownMenuRadioItem>
                {statusOptions.map((s) => (
                  <DropdownMenuRadioItem key={s.id} value={s.id}>
                    <span className="flex items-center gap-1.5">
                      <ContactStatusDot status={s.id} />
                      {s.label}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
                <DropdownMenuRadioItem value={STATUS_FILTER_NONE}>No status</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <DropdownMenu onOpenChange={(open) => open && onRefreshTags?.()}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn("gap-1.5", tagFilter ? "text-foreground" : "text-muted-foreground")}
            >
              {activeTag ? `#${activeTag.name}` : "Tag"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {workspaceTags.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">No tags yet.</p>
            ) : (
              <DropdownMenuRadioGroup
                value={tagFilter || ALL}
                onValueChange={(v) => setTagFilter(v === ALL ? "" : v)}
              >
                <DropdownMenuRadioItem value={ALL}>All tags</DropdownMenuRadioItem>
                {workspaceTags.map((t) => (
                  <DropdownMenuRadioItem key={t.id} value={t.id}>
                    #{t.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton
          icon={sort === "alpha" ? ArrowDownAZ : History}
          label={
            sort === "alpha" ? "Sorted A–Z — switch to recent" : "Sorted by recent — switch to A–Z"
          }
          size="sm"
          variant="ghost"
          className="ml-auto shrink-0"
          onClick={() => setSort((s) => (s === "alpha" ? "recent" : "alpha"))}
        />
      </div>

      {status === "ready" && showingPeople && dupGroups.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            const id = dupGroups[0].contactIds[0];
            if (id) onSelect({ type: "contact", id });
          }}
          className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
        >
          <Copy className="size-icon-sm shrink-0" aria-hidden />
          {dupGroups.length} possible duplicate{dupGroups.length === 1 ? "" : "s"} — review
        </button>
      ) : null}

      {status === "error" ? (
        <div className="flex flex-col items-start gap-2 rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
          <span className="text-destructive">Couldn’t load contacts.</span>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="text-foreground underline underline-offset-2"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : status === "loading" ? (
        <div className="space-y-1" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 px-2 py-1.5">
              <div className="size-6 shrink-0 animate-pulse rounded-avatar bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : isEmpty ? (
        query.trim() || filtersActive ? (
          <EmptyState
            icon={Search}
            title="No results"
            description={
              query.trim()
                ? `No ${showingPeople ? "people" : "companies"} match “${query.trim()}”.`
                : "Nothing matches the current filters."
            }
          />
        ) : (
          <EmptyState
            icon={showingPeople ? User : Building2}
            title={showingPeople ? "No people yet" : "No companies yet"}
            description={
              showingPeople
                ? "Import your contacts or add one to begin."
                : "Companies appear as you add them or set a contact’s company."
            }
          />
        )
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-0.5 pr-1">
            {showingPeople ? (
              <>
                {favorites.length > 0 ? (
                  <>
                    <LetterHeader letter="★ Favorites" />
                    {favorites.map(personRow)}
                  </>
                ) : null}
                {sort === "alpha"
                  ? peopleGroups.map((group) => (
                      <div key={group.letter}>
                        <LetterHeader letter={group.letter} />
                        {group.items.map(personRow)}
                      </div>
                    ))
                  : peopleRecent.map(personRow)}
              </>
            ) : sort === "alpha" ? (
              orgGroups.map((group) => (
                <div key={group.letter}>
                  <LetterHeader letter={group.letter} />
                  {group.items.map(companyRow)}
                </div>
              ))
            ) : (
              orgsRecent.map(companyRow)
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
