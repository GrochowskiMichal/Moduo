// The ContactHub — the iOS/Folk-grade contact card (specs/contacts-v2.md). One
// scrollable card (no essential right panel): header + favorite + action row +
// the auto last-touch line + a view/edit details area (labelled multi-value
// emails/phones/urls/addresses, birthday & dates, optional status, custom
// fields), the spine suggested-links strip, the linked-work roll-up, and the
// activity trail. Edit toggles inline editing; Save sends one patch. Tokens +
// shadcn only; status is color+label and optional.

import { useEffect, useState } from "react";
import { Building2, CalendarPlus, Link2, Mail, Pencil, Plus, Share2, Star, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { EntityLink, EntityRef, RelationKind } from "@/lib/entity-links";
import type { ModuoRuntime, ContactDetailsPatch } from "@/lib/runtime.types";
import { EntityHub } from "../../spine/ui/entity-hub";
import type { HubStatus } from "../../spine/hooks/use-entity-hub";
import { LinkSuggestionStrip } from "../../spine/ui/link-suggestion-strip";
import { spineActivityLine, spineActorName } from "../../spine/activity";
import type { MentionCandidate } from "../../spine/mention";
import type { ActivityEntry } from "../../tasks/model";
import type { Contact, ContactChannel, ContactDateEntry, ContactFieldDef, ContactFieldType } from "../model";
import { contactStatusMeta, DEFAULT_CONTACT_STATUSES } from "../status";
import { lastTouchLine, timeAgo, type ContactRollup } from "../rollup";
import { useContactSuggestions } from "../hooks/use-contact-suggestions";
import { initials } from "./contact-directory";
import { ContactStatusDot } from "./contact-status-badge";
import { EntityLinkPicker } from "./entity-link-picker";

const SECTION = "font-sans text-2xs font-medium uppercase tracking-wide text-muted-foreground";
// Radix Select forbids an empty-string item value, so "No status" rides a sentinel.
const NO_STATUS = "__none__";

/** The card's editable draft (everything the inline-edit form owns). */
type Draft = {
  name: string;
  title: string;
  status: string;
  notesInline: string;
  emails: ContactChannel[];
  phones: ContactChannel[];
  urls: ContactChannel[];
  addresses: ContactChannel[];
  dates: ContactDateEntry[];
  custom: Record<string, string>;
};

function draftFrom(c: Contact): Draft {
  return {
    name: c.name,
    title: c.title ?? "",
    status: c.status,
    notesInline: c.notesInline,
    emails: c.emails.map((e) => ({ ...e })),
    phones: c.phones.map((e) => ({ ...e })),
    urls: c.urls.map((e) => ({ ...e })),
    addresses: c.addresses.map((e) => ({ ...e })),
    dates: c.dates.map((d) => ({ ...d })),
    custom: Object.fromEntries(
      Object.entries(c.custom).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v ?? "")]),
    ),
  };
}

export type ContactHubProps = {
  contact: Contact;
  companyName?: string | null;
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
  onToggleFavorite: () => void;
  onDelete: () => void;
  onShare: () => void;
  onAddFollowup: () => void;
  onLink: (candidate: MentionCandidate) => void;
  onSetCompany: (candidate: MentionCandidate) => void;
  onAddField?: (label: string, type: ContactFieldType) => void;
  onDeleteField?: (fieldId: string) => void;
  onOpenEntity?: (ref: EntityRef) => void;
  onChangeKind?: (link: EntityLink, kind: RelationKind) => void;
  onUnlink?: (link: EntityLink) => void;
  onRetry?: () => void;
  onLinked: () => void;
};

// ── small editors ─────────────────────────────────────────────────────────────

function ChannelEditor({
  label,
  rows,
  placeholder,
  onChange,
}: {
  label: string;
  rows: ContactChannel[];
  placeholder: string;
  onChange: (rows: ContactChannel[]) => void;
}) {
  const set = (i: number, patch: Partial<ContactChannel>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={r.label}
            onChange={(e) => set(i, { label: e.target.value })}
            placeholder="label"
            className="w-24 shrink-0"
            aria-label={`${label} label`}
          />
          <Input
            value={r.value}
            onChange={(e) => set(i, { value: e.target.value })}
            placeholder={placeholder}
            className="min-w-0 flex-1"
            aria-label={label}
          />
          <IconButton
            icon={X}
            label="Remove"
            size="sm"
            variant="ghost"
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
          />
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={() => onChange([...rows, { label: "", value: "", primary: rows.length === 0 }])}
      >
        <Plus className="size-icon-sm" aria-hidden />
        Add {label.toLowerCase()}
      </Button>
    </div>
  );
}

/** A read-only labelled list with click-to-act (mailto/tel/url). */
function ChannelView({ rows, kind }: { rows: ContactChannel[]; kind: "email" | "phone" | "url" | "address" }) {
  if (rows.length === 0) return null;
  const href = (v: string) =>
    kind === "email" ? `mailto:${v}` : kind === "phone" ? `tel:${v}` : kind === "url" ? v : undefined;
  return (
    <ul className="space-y-0.5">
      {rows.map((r, i) => {
        const h = href(r.value);
        return (
          <li key={i} className="flex items-baseline gap-2 text-sm">
            <span className="w-16 shrink-0 truncate text-xs text-muted-foreground">{r.label || kind}</span>
            {h ? (
              <a
                href={h}
                target={kind === "url" ? "_blank" : undefined}
                rel={kind === "url" ? "noreferrer" : undefined}
                className="min-w-0 truncate text-foreground hover:underline"
              >
                {r.value}
              </a>
            ) : (
              <span className="min-w-0 truncate text-foreground">{r.value}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ContactSuggestions({
  runtime,
  workspaceId,
  contactId,
  onLinked,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  contactId: string;
  onLinked: () => void;
}) {
  const focus: EntityRef = { type: "contact", id: contactId };
  const { current, busy, accept, dismiss } = useContactSuggestions(runtime, workspaceId, focus, onLinked);
  if (!current) return null;
  return (
    <LinkSuggestionStrip suggestion={current} busy={busy} onAccept={() => void accept()} onDismiss={() => void dismiss()} />
  );
}

// ── the card ──────────────────────────────────────────────────────────────────

export function ContactHub(props: ContactHubProps) {
  const {
    contact,
    companyName,
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
    onToggleFavorite,
    onDelete,
    onShare,
    onAddFollowup,
    onLink,
    onSetCompany,
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

  // Leave edit mode + resync the draft whenever the selected contact changes.
  useEffect(() => {
    setEditing(false);
    setDraft(draftFrom(contact));
  }, [contact.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusMeta = contactStatusMeta(contact.status);
  const primaryEmail = contact.email ?? contact.emails.find((e) => e.primary)?.value ?? contact.emails[0]?.value ?? null;
  const birthday = contact.dates.find((d) => d.label.toLowerCase() === "birthday")?.value ?? null;

  function clean(rows: ContactChannel[]): ContactChannel[] {
    return rows.filter((r) => r.value.trim() !== "").map((r) => ({ label: r.label.trim() || "other", value: r.value.trim(), primary: r.primary }));
  }

  function save() {
    const patch: ContactDetailsPatch = {
      name: draft.name.trim() || contact.name,
      title: draft.title.trim() || null,
      status: draft.status,
      notesInline: draft.notesInline,
      emails: clean(draft.emails),
      phones: clean(draft.phones),
      urls: clean(draft.urls),
      addresses: clean(draft.addresses),
      dates: draft.dates.filter((d) => d.value.trim() !== "").map((d) => ({ label: d.label.trim() || "date", value: d.value })),
      custom: Object.fromEntries(Object.entries(draft.custom).filter(([, v]) => v.trim() !== "")),
    };
    onSaveDetails(patch);
    setEditing(false);
  }

  const draftStatusMeta = contactStatusMeta(draft.status);
  const statusOptions: { id: string; label: string }[] = [
    { id: "", label: "No status" },
    ...DEFAULT_CONTACT_STATUSES,
  ];
  if (draftStatusMeta.id && !statusOptions.some((s) => s.id === draftStatusMeta.id)) {
    statusOptions.push({ id: draftStatusMeta.id, label: draftStatusMeta.label });
  }

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-2xl flex-col gap-5 overflow-y-auto p-6">
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
              className="font-display text-2xl focus-visible:ring-0"
            />
          ) : (
            <h2 className="font-display text-2xl text-foreground">{contact.name || "Unnamed"}</h2>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {contact.title ? <span className="truncate">{contact.title}</span> : null}
            {companyName ? (
              <button
                type="button"
                onClick={() => contact.companyId && onOpenEntity?.({ type: "company", id: contact.companyId })}
                className="inline-flex items-center gap-1 truncate hover:text-foreground hover:underline"
              >
                <Building2 className="size-icon-sm shrink-0" aria-hidden />
                {companyName}
              </button>
            ) : null}
          </div>
        </div>
        {canEdit ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton
              icon={Star}
              label={contact.isFavorite ? "Remove from favorites" : "Add to favorites"}
              size="sm"
              variant="ghost"
              className={cn(contact.isFavorite && "text-warning")}
              onClick={onToggleFavorite}
            />
            <IconButton icon={Share2} label="Share contact" size="sm" variant="ghost" onClick={onShare} />
            {editing ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft(draftFrom(contact)); }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={save}>Done</Button>
              </>
            ) : (
              <IconButton icon={Pencil} label="Edit contact" size="sm" variant="ghost" onClick={() => setEditing(true)} />
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
                <CalendarPlus className="size-icon-sm" aria-hidden />Add task
              </Button>
              <EntityLinkPicker
                runtime={runtime}
                workspaceId={workspaceId}
                types={["note"]}
                placeholder="Attach a note…"
                emptyLabel="No notes."
                trigger={<Button variant="secondary" size="sm" className="gap-1.5"><Plus className="size-icon-sm" aria-hidden />Note</Button>}
                onPick={onLink}
              />
              <EntityLinkPicker
                runtime={runtime}
                workspaceId={workspaceId}
                types={["task", "note", "event", "contact", "company"]}
                placeholder="Link a task, note, contact…"
                emptyLabel="Nothing to link."
                trigger={<Button variant="secondary" size="sm" className="gap-1.5"><Link2 className="size-icon-sm" aria-hidden />Link</Button>}
                onPick={onLink}
              />
            </>
          ) : null}
        </div>
      ) : null}

      {/* Last touch */}
      <p className="text-sm text-muted-foreground">{lastTouchLine(rollup, now)}</p>

      <Separator />

      {/* Details */}
      {editing ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-title">Title</Label>
              <Input id="c-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Head of ops" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-status">Status</Label>
              <Select
                value={contactStatusMeta(draft.status).id || NO_STATUS}
                onValueChange={(v) => setDraft({ ...draft, status: v === NO_STATUS ? "" : v })}
              >
                <SelectTrigger id="c-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statusOptions.map((s) => (
                    <SelectItem key={s.id || "none"} value={s.id || NO_STATUS}>
                      <span className="flex items-center gap-1.5">
                        {s.id ? <ContactStatusDot status={s.id} /> : null}
                        {s.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <ChannelEditor label="Email" placeholder="name@example.com" rows={draft.emails} onChange={(r) => setDraft({ ...draft, emails: r })} />
          <ChannelEditor label="Phone" placeholder="+1 555 0100" rows={draft.phones} onChange={(r) => setDraft({ ...draft, phones: r })} />
          <ChannelEditor label="URL" placeholder="https://…" rows={draft.urls} onChange={(r) => setDraft({ ...draft, urls: r })} />
          <ChannelEditor label="Address" placeholder="123 Main St, City" rows={draft.addresses} onChange={(r) => setDraft({ ...draft, addresses: r })} />
          <DatesEditor rows={draft.dates} onChange={(r) => setDraft({ ...draft, dates: r })} />
          <div className="space-y-1.5">
            <Label>Custom fields</Label>
            {fieldDefs.map((f) => (
              <div key={f.id} className="flex items-center gap-1.5">
                <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{f.label}</span>
                <Input
                  type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                  value={draft.custom[f.key] ?? ""}
                  onChange={(e) => setDraft({ ...draft, custom: { ...draft.custom, [f.key]: e.target.value } })}
                  className="min-w-0 flex-1"
                  aria-label={f.label}
                />
                {onDeleteField ? (
                  <IconButton icon={X} label={`Remove ${f.label} field`} size="sm" variant="ghost" onClick={() => onDeleteField(f.id)} />
                ) : null}
              </div>
            ))}
            {onAddField ? <AddFieldInline onAdd={onAddField} /> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-notes">Note</Label>
            <Input id="c-notes" value={draft.notesInline} onChange={(e) => setDraft({ ...draft, notesInline: e.target.value })} placeholder="One-line note" />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <ChannelView rows={contact.emails} kind="email" />
          <ChannelView rows={contact.phones} kind="phone" />
          <ChannelView rows={contact.urls} kind="url" />
          <ChannelView rows={contact.addresses} kind="address" />
          {birthday || contact.dates.length > 0 ? (
            <ul className="space-y-0.5 text-sm">
              {contact.dates.map((d, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="w-16 shrink-0 truncate text-xs text-muted-foreground">{d.label || "date"}</span>
                  <span className="text-foreground">{d.value}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {contact.status ? (
            <div className="flex items-center gap-1.5 text-sm">
              <ContactStatusDot status={statusMeta.id} />
              <span className="text-muted-foreground">{statusMeta.label}</span>
            </div>
          ) : null}
          {fieldDefs.length > 0 ? (
            <ul className="space-y-0.5 text-sm">
              {fieldDefs.map((f) => {
                const v = contact.custom[f.key];
                const text = Array.isArray(v) ? v.join(", ") : (v ?? "");
                if (!text) return null;
                return (
                  <li key={f.id} className="flex items-baseline gap-2">
                    <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{f.label}</span>
                    <span className="min-w-0 truncate text-foreground">{text}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {contact.notesInline ? <p className="text-sm text-muted-foreground">{contact.notesInline}</p> : null}
          {canEdit ? (
            <div className="pt-1">
              <EntityLinkPicker
                runtime={runtime}
                workspaceId={workspaceId}
                types={["company"]}
                canCreate
                createType="company"
                placeholder="Find or create a company…"
                emptyLabel="No companies."
                trigger={
                  <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                    <Building2 className="size-icon-sm" aria-hidden />
                    {contact.companyId ? "Change company" : "Set company"}
                  </Button>
                }
                onPick={onSetCompany}
              />
            </div>
          ) : null}
        </div>
      )}

      {/* Suggested links (moved onto the page from the old right panel) */}
      {canEdit && !editing ? (
        <ContactSuggestions runtime={runtime} workspaceId={workspaceId} contactId={contact.id} onLinked={onLinked} />
      ) : null}

      {/* Linked work */}
      {!editing ? (
        <EntityHub
          variant="page"
          status={hubStatus}
          sections={rollup.sections}
          canEdit={canEdit}
          onOpen={onOpenEntity}
          onChangeKind={onChangeKind}
          onUnlink={onUnlink}
          onRetry={onRetry}
        />
      ) : null}

      {/* Activity */}
      {!editing && activity.length > 0 ? (
        <section className="space-y-1">
          <h3 className={SECTION}>Activity</h3>
          <ul className="space-y-1">
            {activity.map((entry) => (
              <li key={entry.id} className="flex items-baseline gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  <span className="text-foreground">{spineActorName(entry, currentUserId)}</span> {spineActivityLine(entry)}
                </span>
                <span className="shrink-0 text-2xs text-muted-foreground/70">{timeAgo(entry.createdAt, now)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Delete (destructive, edit-gated) */}
      {canEdit && !editing ? (
        <div className="pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="size-icon-sm" aria-hidden />
            Delete contact
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function DatesEditor({ rows, onChange }: { rows: ContactDateEntry[]; onChange: (rows: ContactDateEntry[]) => void }) {
  const set = (i: number, patch: Partial<ContactDateEntry>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-1.5">
      <Label>Dates</Label>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input value={r.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="birthday" className="w-24 shrink-0" aria-label="Date label" />
          <Input type="date" value={r.value} onChange={(e) => set(i, { value: e.target.value })} className="min-w-0 flex-1" aria-label="Date" />
          <IconButton icon={X} label="Remove" size="sm" variant="ghost" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} />
        </div>
      ))}
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => onChange([...rows, { label: "birthday", value: "" }])}>
        <Plus className="size-icon-sm" aria-hidden />
        Add date
      </Button>
    </div>
  );
}

const FIELD_TYPES: ContactFieldType[] = ["text", "number", "date", "url"];

/** Inline "add a custom field" control (defines a workspace field def). */
function AddFieldInline({ onAdd }: { onAdd: (label: string, type: ContactFieldType) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<ContactFieldType>("text");
  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setOpen(true)}>
        <Plus className="size-icon-sm" aria-hidden />
        Add field
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Field name" className="min-w-0 flex-1" aria-label="New field name" autoFocus />
      <Select value={type} onValueChange={(v) => setType(v as ContactFieldType)}>
        <SelectTrigger className="w-24" aria-label="Field type"><SelectValue /></SelectTrigger>
        <SelectContent>
          {FIELD_TYPES.map((t) => (
            <SelectItem key={t} value={t}>{t}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        disabled={!label.trim()}
        onClick={() => {
          onAdd(label.trim(), type);
          setLabel("");
          setType("text");
          setOpen(false);
        }}
      >
        Add
      </Button>
      <IconButton icon={X} label="Cancel" size="sm" variant="ghost" onClick={() => { setOpen(false); setLabel(""); }} />
    </div>
  );
}
