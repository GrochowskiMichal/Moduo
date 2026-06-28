// The CompanyHub — a company's center pane (CO-4 AC8 + v2 editable). Header
// (inline-editable) + a People group (members via the denormalized company_id ∪
// works-at links) + the union of the company's + its people's work (read-only
// EntityHub) + the activity trail. Tokens only.

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { EntityRef } from "@/lib/entity-links";
import type { CompanyDetailsPatch } from "@/lib/runtime.types";
import { EntityHub } from "../../spine/ui/entity-hub";
import type { HubStatus } from "../../spine/hooks/use-entity-hub";
import { spineActivityLine, spineActorName } from "../../spine/activity";
import type { ActivityEntry } from "../../tasks/model";
import type { CompanyRollup } from "../company";
import type { Company } from "../model";
import { timeAgo } from "../rollup";
import { initials } from "./contact-directory";
import { ContactStatusDot } from "./contact-status-badge";

const SECTION_HEADING = "font-sans text-2xs font-medium uppercase tracking-wide text-muted-foreground";

export type CompanyHubProps = {
  company: Company;
  rollup: CompanyRollup;
  status: HubStatus;
  activity: ActivityEntry[];
  canEdit?: boolean;
  currentUserId?: string | null;
  /** Injected for deterministic stories/tests; defaults to now. */
  now?: Date;
  onSaveDetails?: (patch: CompanyDetailsPatch) => void;
  onOpenEntity?: (ref: EntityRef) => void;
  onRetry?: () => void;
};

export function CompanyHub({
  company,
  rollup,
  status,
  activity,
  canEdit = false,
  currentUserId = null,
  now = new Date(),
  onSaveDetails,
  onOpenEntity,
  onRetry,
}: CompanyHubProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(company.name);
  const [website, setWebsite] = useState(company.website ?? "");
  const [domains, setDomains] = useState(company.domains.join(", "));
  const [notes, setNotes] = useState(company.notesInline);

  useEffect(() => {
    setEditing(false);
    setName(company.name);
    setWebsite(company.website ?? "");
    setDomains(company.domains.join(", "));
    setNotes(company.notesInline);
  }, [company.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function save() {
    onSaveDetails?.({
      name: name.trim() || company.name,
      website: website.trim() || null,
      domains: domains.split(",").map((d) => d.trim()).filter(Boolean),
      notesInline: notes,
    });
    setEditing(false);
  }

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-2xl flex-col gap-5 overflow-y-auto p-6">
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
        </div>
        {canEdit && onSaveDetails ? (
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
            <IconButton icon={Pencil} label="Edit company" size="sm" variant="ghost" className="shrink-0" onClick={() => setEditing(true)} />
          )
        ) : null}
      </div>

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
          <div className="space-y-1.5">
            <Label htmlFor="co-notes">Note</Label>
            <Input id="co-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="One-line note" />
          </div>
        </div>
      ) : null}

      <Separator />

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
      </section>

      <EntityHub variant="page" status={status} sections={rollup.unionSections} canEdit={false} onOpen={onOpenEntity} onRetry={onRetry} />

      {activity.length > 0 ? (
        <section className="space-y-1">
          <h3 className={SECTION_HEADING}>Activity</h3>
          <ul className="space-y-1">
            {activity.map((entry) => (
              <li key={entry.id} className="flex items-baseline gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  <span className="text-foreground">{spineActorName(entry, currentUserId)}</span>{" "}
                  {spineActivityLine(entry)}
                </span>
                <span className="shrink-0 text-2xs text-muted-foreground/70">{timeAgo(entry.createdAt, now)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
