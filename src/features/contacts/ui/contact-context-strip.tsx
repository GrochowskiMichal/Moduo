// The contact context strip — the right pane (block CO-4). A quiet column of the
// spine's deterministic Suggested links (accept → contacts.link, dismiss
// remembered; AC7) + Quick actions (Add follow-up AC4, Link existing… AC5, Set
// company AC8) + read-only contact details. Edit affordances are hidden for a
// viewer (server-guarded regardless). Tokens + shadcn only; one accent at most.

import { Building2, CalendarPlus, Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import type { MentionCandidate } from "../../spine/mention";
import { LinkSuggestionStrip } from "../../spine/ui/link-suggestion-strip";
import type { Contact } from "../model";
import { useContactSuggestions } from "../hooks/use-contact-suggestions";
import { EntityLinkPicker } from "./entity-link-picker";

const SECTION_HEADING = "font-sans text-2xs font-medium uppercase tracking-wide text-muted-foreground";
const ACTION_BUTTON = "w-full justify-start gap-2";

function ContactSuggestions({
  runtime,
  workspaceId,
  focus,
  onLinked,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  focus: EntityRef;
  onLinked: () => void;
}) {
  const { current, busy, accept, dismiss } = useContactSuggestions(runtime, workspaceId, focus, onLinked);
  if (!current) return null;
  return (
    <LinkSuggestionStrip
      suggestion={current}
      busy={busy}
      onAccept={() => void accept()}
      onDismiss={() => void dismiss()}
    />
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-foreground">{value}</dd>
    </div>
  );
}

export type ContactContextStripProps = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  contact: Contact;
  canEdit: boolean;
  onLinked: () => void;
  onAddFollowup: () => void;
  onLink: (candidate: MentionCandidate) => void;
  onSetCompany: (candidate: MentionCandidate) => void;
};

export function ContactContextStrip({
  runtime,
  workspaceId,
  contact,
  canEdit,
  onLinked,
  onAddFollowup,
  onLink,
  onSetCompany,
}: ContactContextStripProps) {
  const focus: EntityRef = { type: "contact", id: contact.id };
  const hasDetails = Boolean(contact.title || contact.email || contact.phone);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3">
      {canEdit ? (
        <ContactSuggestions runtime={runtime} workspaceId={workspaceId} focus={focus} onLinked={onLinked} />
      ) : null}

      {canEdit ? (
        <section className="space-y-1">
          <h3 className={SECTION_HEADING}>Quick actions</h3>
          <Button variant="ghost" size="sm" className={ACTION_BUTTON} onClick={onAddFollowup}>
            <CalendarPlus className="size-icon-sm" aria-hidden />
            Add follow-up
          </Button>
          <EntityLinkPicker
            runtime={runtime}
            workspaceId={workspaceId}
            types={["task", "note", "event", "contact", "company"]}
            placeholder="Link a task, note, contact…"
            emptyLabel="Nothing to link."
            trigger={
              <Button variant="ghost" size="sm" className={ACTION_BUTTON}>
                <Link2 className="size-icon-sm" aria-hidden />
                Link existing…
              </Button>
            }
            onPick={onLink}
          />
          <EntityLinkPicker
            runtime={runtime}
            workspaceId={workspaceId}
            types={["company"]}
            canCreate
            createType="company"
            placeholder="Find or create a company…"
            emptyLabel="No companies."
            trigger={
              <Button variant="ghost" size="sm" className={ACTION_BUTTON}>
                <Building2 className="size-icon-sm" aria-hidden />
                Set company
              </Button>
            }
            onPick={onSetCompany}
          />
        </section>
      ) : null}

      <section className="space-y-1">
        <h3 className={SECTION_HEADING}>Details</h3>
        {hasDetails ? (
          <dl className="space-y-1 text-sm">
            {contact.title ? <Detail label="Title" value={contact.title} /> : null}
            {contact.email ? <Detail label="Email" value={contact.email} /> : null}
            {contact.phone ? <Detail label="Phone" value={contact.phone} /> : null}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">No details yet.</p>
        )}
      </section>
    </div>
  );
}
