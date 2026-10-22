// The ContactHub — the iOS/Folk-grade contact card (specs/contacts-v2.md). One
// scrollable card (no essential right panel): header + favorite + action row +
// the auto last-touch line + a view/edit details area (labelled multi-value
// emails/phones/urls/addresses, birthday & dates, optional status, custom
// fields), the spine suggested-links strip, the linked-work roll-up, and the
// activity trail. Edit toggles inline editing; Save sends one patch. Tokens +
// shadcn only; status is color+label and optional.

import {
  Building2,
  CalendarPlus,
  Link2,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DetailTitle, detailTitleVariants } from "@/components/ui/detail-title";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import type { EntityLink, EntityRef, RelationKind } from "@/lib/entity-links";
import type { ContactDetailsPatch, ModuoRuntime } from "@/lib/runtime.types";
import { cn } from "@/lib/utils";
import { useStartConversation } from "../../chat/start-conversation";
import type { HubStatus } from "../../spine/hooks/use-entity-hub";
import type { MentionCandidate } from "../../spine/mention";
import { EntityTagRow } from "../../tags/ui/entity-tag-row";
import type { ActivityEntry } from "../../tasks/model";
import { ClientTimeReport } from "../../tasks/ui/client-time-report";
import type { Contact, ContactFieldDef, ContactFieldType } from "../model";
import { type ContactRollup, lastTouchLine } from "../rollup";
import { ActivityTrail } from "./activity-trail";
import { ContactDetailsCard, detailGroupsFor } from "./contact-details-card";
import { initials } from "./contact-directory";
import { ContactEditForm } from "./contact-hub-edit-form";
import {
  type Draft,
  draftFrom,
  linkedPeopleOf,
  linkedSectionsOf,
  patchFromDraft,
  statusOptionsFor,
} from "./contact-hub-model";
import { ContactSuggestions, HeaderStatus, LinkedPeople } from "./contact-hub-parts";
import { ContactStatusBadge } from "./contact-status-badge";
import { EntityLinkPicker } from "./entity-link-picker";
import { LinkedSections } from "./linked-sections";

export type ContactHubProps = {
  contact: Contact;
  companyName?: string | null;
  /** Directory contacts by id — enriches linked-people rows with status/avatar (FX-5). */
  contactsById?: Map<string, Contact>;
  fieldDefs: ContactFieldDef[];
  rollup: ContactRollup;
  hubStatus: HubStatus;
  activity: ActivityEntry[];
  canEdit?: boolean;
  currentUserId?: string | null;
  now?: Date;
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  onSaveDetails: (patch: ContactDetailsPatch) => void;
  /** Quick status change from the header pill in view mode (optimistic; FX-4 AC5). */
  onSetStatus?: (status: string) => Promise<void>;
  onToggleFavorite: () => void;
  onDelete: () => void;
  onShare: () => void;
  onAddFollowup: () => void;
  onLink: (candidate: MentionCandidate) => void;
  onSetCompany: (candidate: MentionCandidate) => void;
  /** Clear the company (drops the works-at edge + the FK; undoable). DF-5. */
  onClearCompany?: () => void;
  onAddField?: (label: string, type: ContactFieldType, options?: string[]) => void;
  onDeleteField?: (fieldId: string) => void;
  onOpenEntity?: (ref: EntityRef) => void;
  onChangeKind?: (link: EntityLink, kind: RelationKind) => void;
  onUnlink?: (link: EntityLink) => void;
  onRetry?: () => void;
  onLinked: () => void;
};

// ── the card ──────────────────────────────────────────────────────────────────

export function ContactHub(props: ContactHubProps) {
  const {
    contact,
    companyName,
    contactsById,
    fieldDefs,
    rollup,
    hubStatus,
    activity,
    canEdit = false,
    currentUserId = null,
    now = new Date(),
    runtime,
    workspaceId,
    onSaveDetails,
    onSetStatus,
    onToggleFavorite,
    onDelete,
    onShare,
    onAddFollowup,
    onLink,
    onSetCompany,
    onClearCompany,
    onAddField,
    onDeleteField,
    onOpenEntity,
    onChangeKind,
    onUnlink,
    onRetry,
    onLinked,
  } = props;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(contact));
  const startConversation = useStartConversation();

  // Leave edit mode + resync the draft whenever the selected contact changes.
  useEffect(() => {
    setEditing(false);
    setDraft(draftFrom(contact));
  }, [contact.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const primaryEmail =
    contact.email ??
    contact.emails.find((e) => e.primary)?.value ??
    contact.emails[0]?.value ??
    null;

  // The read-mode field groups (only non-empty ones render; the card hides
  // entirely when the record has no details yet — progressive disclosure).
  const detailGroups = useMemo(
    () => detailGroupsFor(contact, fieldDefs, now),
    [contact, fieldDefs, now],
  );

  // Linked people get a dedicated People section (FX-5); the roll-up's remaining
  // sections are the linked work.
  const linkedPeople = useMemo(() => linkedPeopleOf(rollup, contactsById), [rollup, contactsById]);
  const sections = useMemo(
    () => linkedSectionsOf(rollup, contact.companyId),
    [rollup, contact.companyId],
  );

  function save() {
    onSaveDetails(patchFromDraft(draft, contact));
    setEditing(false);
  }

  const statusOptions = statusOptionsFor(draft.status);

  return (
    <div className="pane-scroll h-full min-h-0 overflow-y-auto scrollbar-thin">
      <div className="mx-auto flex max-w-2xl flex-col gap-5 p-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Avatar size="lg" className="shrink-0">
            {contact.avatarUrl ? <AvatarImage src={contact.avatarUrl} alt="" /> : null}
            <AvatarFallback>{initials(contact.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-1">
            {editing ? (
              <Input
                variant="bare"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                aria-label="Contact name"
                style={{ height: "auto" }}
                className={cn(detailTitleVariants({ size: "page" }), "focus-visible:ring-0")}
              />
            ) : (
              <DetailTitle size="page">{contact.name || "Unnamed"}</DetailTitle>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {contact.title ? <span className="truncate">{contact.title}</span> : null}
              {companyName ? (
                <button
                  type="button"
                  onClick={() =>
                    contact.companyId && onOpenEntity?.({ type: "company", id: contact.companyId })
                  }
                  className="inline-flex items-center gap-1 truncate hover:text-foreground hover:underline"
                >
                  <Building2 className="size-icon-sm shrink-0" aria-hidden />
                  {companyName}
                </button>
              ) : null}
              {!editing ? (
                <HeaderStatus contact={contact} canEdit={canEdit} onSetStatus={onSetStatus} />
              ) : contact.status ? (
                <ContactStatusBadge status={contact.status} />
              ) : null}
            </div>
            {!editing ? (
              // key: remount per entity so tag state can never leak across a
              // focus switch (stale chips / late-mutation writes).
              <EntityTagRow
                key={`contact:${contact.id}`}
                runtime={runtime}
                workspaceId={workspaceId}
                focus={{ type: "contact", id: contact.id }}
                canEdit={canEdit}
              />
            ) : null}
          </div>
          {canEdit ? (
            <div className="flex shrink-0 items-center gap-0.5">
              {editing ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(false);
                      setDraft(draftFrom(contact));
                    }}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={save}>
                    Done
                  </Button>
                </>
              ) : (
                <>
                  <IconButton
                    icon={Star}
                    label={contact.isFavorite ? "Remove from favorites" : "Add to favorites"}
                    size="sm"
                    variant="ghost"
                    className={cn(contact.isFavorite && "text-warning")}
                    onClick={onToggleFavorite}
                  />
                  <IconButton
                    icon={Pencil}
                    label="Edit contact"
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(true)}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        icon={MoreHorizontal}
                        label="More actions"
                        size="sm"
                        variant="ghost"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canEdit && startConversation ? (
                        // Chat's "Start a conversation for X" (CV-13).
                        <DropdownMenuItem onSelect={() => startConversation("contact", contact.id)}>
                          Start a conversation
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={onShare}>Share as vCard…</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                        Delete contact
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
          ) : null}
        </div>

        {/* Action row */}
        {!editing ? (
          <div className="flex flex-wrap gap-1.5">
            {primaryEmail ? (
              <Button variant="secondary" size="sm" className="gap-1.5" asChild>
                <a href={`mailto:${primaryEmail}`}>
                  <Mail className="size-icon-sm" aria-hidden />
                  Email
                </a>
              </Button>
            ) : (
              <Button variant="secondary" size="sm" className="gap-1.5" disabled>
                <Mail className="size-icon-sm" aria-hidden />
                Email
              </Button>
            )}
            {canEdit ? (
              <>
                <Button variant="secondary" size="sm" className="gap-1.5" onClick={onAddFollowup}>
                  <CalendarPlus className="size-icon-sm" aria-hidden />
                  Add task
                </Button>
                <EntityLinkPicker
                  runtime={runtime}
                  workspaceId={workspaceId}
                  types={["note"]}
                  placeholder="Attach a note…"
                  emptyLabel="No notes."
                  trigger={
                    <Button variant="secondary" size="sm" className="gap-1.5">
                      <Plus className="size-icon-sm" aria-hidden />
                      Note
                    </Button>
                  }
                  onPick={onLink}
                />
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
              </>
            ) : null}
          </div>
        ) : null}

        {/* Last touch */}
        <p className="text-sm text-muted-foreground">{lastTouchLine(rollup, now)}</p>

        {/* Details */}
        {/* Details */}
        {editing ? (
          <ContactEditForm
            draft={draft}
            setDraft={setDraft}
            statusOptions={statusOptions}
            companyName={companyName}
            fieldDefs={fieldDefs}
            runtime={runtime}
            workspaceId={workspaceId}
            onSetCompany={onSetCompany}
            onClearCompany={onClearCompany}
            onAddField={onAddField}
            onDeleteField={onDeleteField}
          />
        ) : (
          <ContactDetailsCard groups={detailGroups} />
        )}

        {/* Suggested links (moved onto the page from the old right panel) */}
        {canEdit && !editing ? (
          <ContactSuggestions
            runtime={runtime}
            workspaceId={workspaceId}
            contactId={contact.id}
            onLinked={onLinked}
          />
        ) : null}

        {/* Linked people — person↔person links get their own quiet section (FX-5) */}
        {!editing ? <LinkedPeople people={linkedPeople} onOpenEntity={onOpenEntity} /> : null}

        {/* Linked work — one fixed section per module relation, always present */}
        {!editing ? (
          <LinkedSections
            focus={{ type: "contact", id: contact.id }}
            status={hubStatus}
            sections={sections}
            canEdit={canEdit}
            onOpen={onOpenEntity}
            onChangeKind={onChangeKind}
            onUnlink={onUnlink}
            onRetry={onRetry}
          />
        ) : null}

        {/* The client's work and time, when they're a project's client
            (TV-D14's report; TV-U16's rollup, AC6.4). */}
        {!editing && workspaceId ? (
          <ClientTimeReport
            workspaceId={workspaceId}
            contactId={contact.id}
            contactName={contact.name || "Client"}
            onOpen={onOpenEntity}
          />
        ) : null}

        {/* Activity (delete moved to the header ⋯ menu — no destructive control on the page body) */}
        {!editing ? (
          <ActivityTrail
            activity={activity}
            currentUserId={currentUserId}
            now={now}
            entityId={contact.id}
          />
        ) : null}
      </div>
    </div>
  );
}
