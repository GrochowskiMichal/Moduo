// The Contacts directory rail (block CO-2): a dense, Linear-style list of people
// AND companies with a People/Companies/All segmented filter, search, and a
// `+ new`. Rows are presentational; selection + data come from the page. Density
// via tokens (--row-h-ish via the control rung); tokens only (R7/R10).

import { useMemo, useState } from "react";
import { Building2, Plus, Search, Upload, User } from "lucide-react";

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState } from "@/components/ui/empty-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import { IconButton } from "@/components/ui/icon-button";
import type { Company, Contact } from "../model";
import { ContactStatusDot } from "./contact-status-badge";

export type DirectoryFilter = "all" | "people" | "companies";

/** A selected directory entity — a person or a company. */
export type DirectorySelection = { type: "contact" | "company"; id: string };

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type RowProps = {
  avatarUrl: string | null;
  name: string;
  secondary: string | null;
  status?: string;
  icon: typeof User;
  selected: boolean;
  onSelect: () => void;
};

function DirectoryRow({ avatarUrl, name, secondary, status, icon: Icon, selected, onSelect }: RowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <Avatar size="sm">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate text-sm text-foreground">{name}</span>
        </span>
        {secondary ? <span className="block truncate text-xs text-muted-foreground">{secondary}</span> : null}
      </span>
      {status ? <ContactStatusDot status={status} /> : null}
    </button>
  );
}

type Props = {
  contacts: Contact[];
  companies: Company[];
  status: "loading" | "ready" | "error";
  selected: DirectorySelection | null;
  onSelect: (sel: DirectorySelection) => void;
  onNew?: () => void;
  onImport?: () => void;
  onRetry?: () => void;
};

const FILTER_ITEMS = [
  { value: "all", label: "All" },
  { value: "people", label: "People" },
  { value: "companies", label: "Companies" },
];

export function ContactDirectory({ contacts, companies, status, selected, onSelect, onNew, onImport, onRetry }: Props) {
  const [filter, setFilter] = useState<DirectoryFilter>("all");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const people = useMemo(
    () => contacts.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q)),
    [contacts, q],
  );
  const orgs = useMemo(
    () => companies.filter((c) => !q || c.name.toLowerCase().includes(q)),
    [companies, q],
  );

  const showPeople = filter !== "companies";
  const showCompanies = filter !== "people";
  const isEmpty = (showPeople ? people.length : 0) + (showCompanies ? orgs.length : 0) === 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex items-center gap-2">
        <SegmentedControl
          aria-label="Filter directory"
          value={filter}
          onValueChange={(v) => setFilter(v as DirectoryFilter)}
          items={FILTER_ITEMS}
          size="sm"
          className="flex-1"
          fullWidth
        />
        {onImport ? (
          <IconButton icon={Upload} label="Import contacts" size="sm" variant="ghost" onClick={onImport} />
        ) : null}
        <IconButton icon={Plus} label="New contact" size="sm" variant="ghost" onClick={onNew} />
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-icon-sm -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search contacts"
          aria-label="Search contacts"
          className="pl-7"
        />
      </div>

      {status === "error" ? (
        <div className="flex flex-col items-start gap-2 rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
          <span className="text-destructive">Couldn’t load contacts.</span>
          {onRetry ? (
            <button type="button" onClick={onRetry} className="text-foreground underline underline-offset-2">
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
        <EmptyState icon={User} title="No contacts yet" description="Import your contacts or add one to begin." />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-0.5 pr-1">
            {showPeople
              ? people.map((c) => (
                  <DirectoryRow
                    key={c.id}
                    avatarUrl={c.avatarUrl}
                    name={c.name || "Unnamed"}
                    secondary={c.title || c.email}
                    status={c.status}
                    icon={User}
                    selected={selected?.type === "contact" && selected.id === c.id}
                    onSelect={() => onSelect({ type: "contact", id: c.id })}
                  />
                ))
              : null}
            {showCompanies
              ? orgs.map((c) => (
                  <DirectoryRow
                    key={c.id}
                    avatarUrl={c.avatarUrl}
                    name={c.name || "Unnamed company"}
                    secondary={c.domains[0] ?? c.website}
                    icon={Building2}
                    selected={selected?.type === "company" && selected.id === c.id}
                    onSelect={() => onSelect({ type: "company", id: c.id })}
                  />
                ))
              : null}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
