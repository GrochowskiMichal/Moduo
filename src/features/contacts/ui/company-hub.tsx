// The CompanyHub — a company's center pane (block CO-4, AC8). Header + a People
// group (members via the denormalized company_id ∪ the works-at links) + the
// union of the company's and its people's work one level up (the spine EntityHub,
// read-only — those links belong to the people, not the company) + the company's
// activity trail. Presentational + controlled (data from useCompanyHub). Tokens
// only; status as color + label.

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import type { EntityRef } from "@/lib/entity-links";
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
  currentUserId?: string | null;
  /** Injected for deterministic stories/tests; defaults to now. */
  now?: Date;
  onOpenEntity?: (ref: EntityRef) => void;
  onRetry?: () => void;
};

export function CompanyHub({
  company,
  rollup,
  status,
  activity,
  currentUserId = null,
  now = new Date(),
  onOpenEntity,
  onRetry,
}: CompanyHubProps) {
  return (
    <div className="mx-auto flex h-full min-h-0 max-w-2xl flex-col gap-5 overflow-y-auto p-6">
      <div className="flex items-start gap-3">
        <Avatar size="lg">
          {company.avatarUrl ? <AvatarImage src={company.avatarUrl} alt="" /> : null}
          <AvatarFallback>{initials(company.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl text-foreground">{company.name || "Unnamed company"}</h2>
          {company.domains[0] || company.website ? (
            <p className="truncate text-sm text-muted-foreground">{company.domains[0] ?? company.website}</p>
          ) : null}
        </div>
      </div>

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

      {/* The union of the company's + its people's work. Read-only — these links
          belong to the people, not the company; editing happens on each person. */}
      <EntityHub
        variant="page"
        status={status}
        sections={rollup.unionSections}
        canEdit={false}
        onOpen={onOpenEntity}
        onRetry={onRetry}
      />

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
