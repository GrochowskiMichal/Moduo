// The ContactHub — the iOS/Folk-grade contact card (specs/contacts-v2.md). One
// scrollable card (no essential right panel): header + favorite + action row +
// the auto last-touch line + a view/edit details area (labelled multi-value
// emails/phones/urls/addresses, birthday & dates, optional status, custom
// fields), the spine suggested-links strip, the linked-work roll-up, and the
// activity trail. Edit toggles inline editing; Save sends one patch. Tokens +
// shadcn only; status is color+label and optional.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Building2,
  Cake,
  CalendarDays,
  CalendarPlus,
  Globe,
  Hash,
  Link2,
  Mail,
  MapPin,
  MoreHorizontal,
  Pencil,
  PenLine,
  Phone,
  Plus,
  Star,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { EntityLink, EntityRef, RelationKind } from "@/lib/entity-links";
import type { ModuoRuntime, ContactDetailsPatch } from "@/lib/runtime.types";
import { EntityHub } from "../../spine/ui/entity-hub";
import type { HubStatus } from "../../spine/hooks/use-entity-hub";
import { LinkSuggestionStrip } from "../../spine/ui/link-suggestion-strip";
import type { MentionCandidate } from "../../spine/mention";
import type { ActivityEntry } from "../../tasks/model";
import type { Contact, ContactChannel, ContactDateEntry, ContactFieldDef, ContactFieldType } from "../model";
import { contactStatusMeta, DEFAULT_CONTACT_STATUSES } from "../status";
import { lastTouchLine, type ContactRollup } from "../rollup";
import { useContactSuggestions } from "../hooks/use-contact-suggestions";
import { initials } from "./contact-directory";
import { ActivityTrail } from "./activity-trail";
import { ContactStatusBadge, ContactStatusDot } from "./contact-status-badge";
import { EntityLinkPicker } from "./entity-link-picker";

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

// ── the read-mode details card (iOS-style grouped rows, click-to-act) ─────────

type DetailRow = { label: string; value: ReactNode; wrap?: boolean };
type DetailGroup = { key: string; icon: typeof Mail; rows: DetailRow[] };

/** Multi-value channel → labelled rows; email/phone/url values act on click. */
function channelRows(rows: ContactChannel[], kind: "email" | "phone" | "url" | "address"): DetailRow[] {
  const href = (v: string) =>
    kind === "email" ? `mailto:${v}` : kind === "phone" ? `tel:${v}` : kind === "url" ? v : undefined;
  return rows.map((r) => {
    const h = href(r.value);
    // Display URLs without the protocol noise; the href keeps it.
    const display = kind === "url" ? r.value.replace(/^https?:\/\//, "").replace(/\/$/, "") : r.value;
    return {
      label: r.label || kind,
      value: h ? (
        <a
          href={h}
          target={kind === "url" ? "_blank" : undefined}
          rel={kind === "url" ? "noreferrer" : undefined}
          className="rounded-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {display}
        </a>
      ) : (
        display
      ),
    };
  });
}

/** "1988-04-17" → "April 17, 1988" (falls back to the raw value). */
function formatDateValue(value: string): string {
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** One field group inside the card: a type icon on the first row, then rows. */
function DetailsGroup({ icon: Icon, rows }: { icon: typeof Mail; rows: DetailRow[] }) {
  return (
    <div className="px-3 py-2">
      {rows.map((r, i) => (
        <div key={i} className={cn("flex gap-3 py-1 text-sm", r.wrap ? "items-start" : "items-center")}>
          <Icon
            className={cn("size-icon-sm shrink-0 text-muted-foreground/70", r.wrap && "mt-0.5", i > 0 && "invisible")}
            aria-hidden
          />
          <span className="w-16 shrink-0 truncate text-xs text-muted-foreground">{r.label}</span>
          <span className={cn("min-w-0 flex-1 text-foreground", r.wrap ? "break-words" : "truncate")}>{r.value}</span>
        </div>
      ))}
    </div>
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

  const primaryEmail = contact.email ?? contact.emails.find((e) => e.primary)?.value ?? contact.emails[0]?.value ?? null;

  // The read-mode field groups (only non-empty ones render; the card hides
  // entirely when the record has no details yet — progressive disclosure).
  const detailGroups = useMemo<DetailGroup[]>(() => {
    const hasBirthday = contact.dates.some((d) => d.label.toLowerCase() === "birthday");
    const customRows: DetailRow[] = fieldDefs.flatMap((f) => {
      const v = contact.custom[f.key];
      const text = Array.isArray(v) ? v.join(", ") : String(v ?? "");
      if (!text) return [];
      const value: ReactNode =
        f.type === "url" ? (
          <a
            href={text}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {text}
          </a>
        ) : (
          text
        );
      return [{ label: f.label, value }];
    });
    return [
      { key: "emails", icon: Mail, rows: channelRows(contact.emails, "email") },
      { key: "phones", icon: Phone, rows: channelRows(contact.phones, "phone") },
      { key: "urls", icon: Globe, rows: channelRows(contact.urls, "url") },
      { key: "addresses", icon: MapPin, rows: channelRows(contact.addresses, "address") },
      {
        key: "dates",
        icon: hasBirthday ? Cake : CalendarDays,
        rows: contact.dates.map((d) => ({ label: d.label || "date", value: formatDateValue(d.value) })),
      },
      { key: "custom", icon: Hash, rows: customRows },
      {
        key: "note",
        icon: PenLine,
        rows: contact.notesInline ? [{ label: "note", value: contact.notesInline, wrap: true }] : [],
      },
    ].filter((g) => g.rows.length > 0);
  }, [contact, fieldDefs]);

  // The header already names the company — drop its works-at row from the
  // roll-up so the same fact never renders twice on one page.
  const sections = useMemo(() => {
    if (!contact.companyId) return rollup.sections;
    return rollup.sections
      .map((s) => ({
        ...s,
        rows: s.rows.filter((r) => !(r.other.type === "company" && r.other.id === contact.companyId)),
      }))
      .map((s) => ({ ...s, count: s.rows.length }))
      .filter((s) => s.rows.length > 0);
  }, [rollup.sections, contact.companyId]);

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
    <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
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
            {contact.status ? <ContactStatusBadge status={contact.status} /> : null}
          </div>
        </div>
        {canEdit ? (
          <div className="flex shrink-0 items-center gap-0.5">
            {editing ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft(draftFrom(contact)); }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={save}>Done</Button>
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
                <IconButton icon={Pencil} label="Edit contact" size="sm" variant="ghost" onClick={() => setEditing(true)} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton icon={MoreHorizontal} label="More actions" size="sm" variant="ghost" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
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
          <div className="space-y-1.5">
            <Label>Company</Label>
            <div>
              <EntityLinkPicker
                runtime={runtime}
                workspaceId={workspaceId}
                types={["company"]}
                canCreate
                createType="company"
                placeholder="Find or create a company…"
                emptyLabel="No companies."
                trigger={
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Building2 className="size-icon-sm" aria-hidden />
                    {companyName ?? "Set company"}
                  </Button>
                }
                onPick={onSetCompany}
              />
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
      ) : detailGroups.length > 0 ? (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {detailGroups.map((g) => (
            <DetailsGroup key={g.key} icon={g.icon} rows={g.rows} />
          ))}
        </div>
      ) : null}

      {/* Suggested links (moved onto the page from the old right panel) */}
      {canEdit && !editing ? (
        <ContactSuggestions runtime={runtime} workspaceId={workspaceId} contactId={contact.id} onLinked={onLinked} />
      ) : null}

      {/* Linked work */}
      {!editing ? (
        <EntityHub
          variant="page"
          status={hubStatus}
          sections={sections}
          canEdit={canEdit}
          onOpen={onOpenEntity}
          onChangeKind={onChangeKind}
          onUnlink={onUnlink}
          onRetry={onRetry}
        />
      ) : null}

      {/* Activity (delete moved to the header ⋯ menu — no destructive control on the page body) */}
      {!editing ? (
        <ActivityTrail activity={activity} currentUserId={currentUserId} now={now} entityId={contact.id} />
      ) : null}
    </div>
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
