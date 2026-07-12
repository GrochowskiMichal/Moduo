// The CompanyHub — a company's center pane (CO-4 AC8 + v2 editable). Same calm
// card anatomy as ContactHub: header (inline-editable) + a grouped details card
// (website / email domains / note, read mode) + a People group (members via the
// denormalized company_id ∪ works-at links) + the union of the company's + its
// people's work (read-only EntityHub) + the activity trail. Tokens only.

import { useEffect, useState } from "react";
import { AtSign, CalendarPlus, Globe, Link2, MoreHorizontal, Pencil, UserPlus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EntityRef } from "@/lib/entity-links";
import type { CompanyDetailsPatch, ModuoRuntime } from "@/lib/runtime.types";
import type { HubStatus } from "../../spine/hooks/use-entity-hub";
import type { MentionCandidate } from "../../spine/mention";
import type { ActivityEntry } from "../../tasks/model";
import { companyLastTouchLine, type CompanyRollup } from "../company";
import type { Company } from "../model";
import { ActivityTrail } from "./activity-trail";
import { initials } from "./contact-directory";
import { ContactStatusDot } from "./contact-status-badge";
import { EntityLinkPicker } from "./entity-link-picker";
import { EntityTagRow } from "./entity-tag-row";
import { LinkedSections } from "./linked-sections";

const SECTION_HEADING = "font-sans text-2xs font-medium uppercase tracking-wide text-muted-foreground";

export type CompanyHubProps = {
  company: Company;
  rollup: CompanyRollup;
  status: HubStatus;
  activity: ActivityEntry[];
  /** For the header tag row (FX-2); safe to omit in stories (row stays empty). */
  runtime?: ModuoRuntime | null;
  workspaceId?: string | null;
  canEdit?: boolean;
  currentUserId?: string | null;
  /** Injected for deterministic stories/tests; defaults to now. */
  now?: Date;
  onSaveDetails?: (patch: CompanyDetailsPatch) => void;
  onOpenEntity?: (ref: EntityRef) => void;
  /** Action row + ⋯ menu + People "+ Add person" (FX-7). */
  onAddTask?: () => void;
  onLink?: (candidate: MentionCandidate) => void;
  onAddPerson?: () => void;
  onDelete?: () => void;
  onRetry?: () => void;
};

/** One field group inside the read-mode details card (mirrors ContactHub). */
function DetailsGroup({
  icon: Icon,
  label,
  value,
  wrap = false,
}: {
  icon: typeof Globe;
  label: string;
  value: React.ReactNode;
  wrap?: boolean;
}) {
  return (
    <div className="px-3 py-2">
      <div className={cn("flex gap-3 py-1 text-sm", wrap ? "items-start" : "items-center")}>
        <Icon className={cn("size-icon-sm shrink-0 text-muted-foreground/70", wrap && "mt-0.5")} aria-hidden />
        <span className="w-16 shrink-0 truncate text-xs text-muted-foreground">{label}</span>
        <span className={cn("min-w-0 flex-1 text-foreground", wrap ? "break-words" : "truncate")}>{value}</span>
      </div>
    </div>
  );
}

export function CompanyHub({
  company,
  rollup,
  status,
  activity,
  runtime = null,
  workspaceId = null,
  canEdit = false,
  currentUserId = null,
  now = new Date(),
  onSaveDetails,
  onOpenEntity,
  onAddTask,
  onLink,
  onAddPerson,
  onDelete,
  onRetry,
}: CompanyHubProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(company.name);
  const [website, setWebsite] = useState(company.website ?? "");
  const [domains, setDomains] = useState(company.domains.join(", "));

  useEffect(() => {
    setEditing(false);
    setName(company.name);
    setWebsite(company.website ?? "");
    setDomains(company.domains.join(", "));
  }, [company.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function save() {
    onSaveDetails?.({
      name: name.trim() || company.name,
      website: website.trim() || null,
      domains: domains.split(",").map((d) => d.trim()).filter(Boolean),
    });
    setEditing(false);
  }

  const hasDetails = !!(company.website || company.domains.length > 0);

  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
    <div className="mx-auto flex max-w-2xl flex-col gap-5 p-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Avatar size="lg" className="shrink-0">
          {company.avatarUrl ? <AvatarImage src={company.avatarUrl} alt="" /> : null}
          <AvatarFallback>{initials(company.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              variant="bare"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Company name"
              style={{ height: "auto" }}
              className="font-display text-2xl focus-visible:ring-0"
            />
          ) : (
            <h2 className="font-display text-2xl text-foreground">{company.name || "Unnamed company"}</h2>
          )}
          {!editing && (company.domains[0] || company.website) ? (
            <p className="truncate text-sm text-muted-foreground">{company.domains[0] ?? company.website}</p>
          ) : null}
          {!editing ? (
            <EntityTagRow
              key={`company:${company.id}`}
              runtime={runtime}
              workspaceId={workspaceId}
              focus={{ type: "company", id: company.id }}
              canEdit={canEdit}
              className="mt-1"
            />
          ) : null}
        </div>
        {canEdit ? (
          editing ? (
            <div className="flex shrink-0 items-center gap-0.5">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={save}>
                Done
              </Button>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-0.5">
              {onSaveDetails ? (
                <IconButton icon={Pencil} label="Edit company" size="sm" variant="ghost" onClick={() => setEditing(true)} />
              ) : null}
              {onDelete ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton icon={MoreHorizontal} label="More actions" size="sm" variant="ghost" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                      Delete company
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          )
        ) : null}
      </div>

      {/* Action row — Add task · Link (mirrors the contact card; FX-7) */}
      {!editing && canEdit && (onAddTask || onLink) ? (
        <div className="flex flex-wrap gap-1.5">
          {onAddTask ? (
            <Button variant="secondary" size="sm" className="gap-1.5" onClick={onAddTask}>
              <CalendarPlus className="size-icon-sm" aria-hidden />
              Add task
            </Button>
          ) : null}
          {onLink ? (
            <EntityLinkPicker
              runtime={runtime}
              workspaceId={workspaceId}
              types={["task", "note", "event", "contact", "company"]}
              placeholder="Link a task, note, contact…"
              emptyLabel="Nothing to link."
              trigger={
                <Button variant="secondary" size="sm" className="gap-1.5">
                  <Link2 className="size-icon-sm" aria-hidden />
                  Link
                </Button>
              }
              onPick={onLink}
            />
          ) : null}
        </div>
      ) : null}

      {/* Last touch — the most recent interaction across the company + its people */}
      <p className="text-sm text-muted-foreground">{companyLastTouchLine(rollup, now)}</p>

      {/* Details — edit form or the grouped read card */}
      {editing ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="co-website">Website</Label>
            <Input id="co-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://acme.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="co-domains">Email domains</Label>
            <Input id="co-domains" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="acme.com, acme.io" />
          </div>
        </div>
      ) : hasDetails ? (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {company.website ? (
            <DetailsGroup
              icon={Globe}
              label="website"
              value={
                <a
                  href={company.website}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {company.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              }
            />
          ) : null}
          {company.domains.length > 0 ? (
            <DetailsGroup icon={AtSign} label="domains" value={company.domains.join(", ")} />
          ) : null}
        </div>
      ) : null}

      <section className="space-y-1">
        <h3 className={SECTION_HEADING}>People ({rollup.people.length})</h3>
        {rollup.people.length === 0 ? (
          <p className="text-sm text-muted-foreground">No people linked yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {rollup.people.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onOpenEntity?.({ type: "contact", id: p.id })}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Avatar size="sm">
                    {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt="" /> : null}
                    <AvatarFallback>{initials(p.name)}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{p.name}</span>
                  {p.status ? <ContactStatusDot status={p.status} /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
        {canEdit && onAddPerson ? (
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={onAddPerson}>
            <UserPlus className="size-icon-sm" aria-hidden />
            Add person
          </Button>
        ) : null}
      </section>

      <LinkedSections status={status} sections={rollup.unionSections} canEdit={false} onOpen={onOpenEntity} onRetry={onRetry} />

      <ActivityTrail activity={activity} currentUserId={currentUserId} now={now} entityId={company.id} />
    </div>
    </div>
  );
}
