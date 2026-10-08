// The ContactHub — the iOS/Folk-grade contact card (specs/contacts-v2.md). One
// scrollable card (no essential right panel): header + favorite + action row +
// the auto last-touch line + a view/edit details area (labelled multi-value
// emails/phones/urls/addresses, birthday & dates, optional status, custom
// fields), the spine suggested-links strip, the linked-work roll-up, and the
// activity trail. Edit toggles inline editing; Save sends one patch. Tokens +
// shadcn only; status is color+label and optional.

import {
  Building2,
  Cake,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  Copy,
  Globe,
  Hash,
  Link2,
  Mail,
  MapPin,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Star,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
import { Eyebrow } from "@/components/ui/eyebrow";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EntityLink, EntityRef, RelationKind } from "@/lib/entity-links";
import type { ContactDetailsPatch, ModuoRuntime } from "@/lib/runtime.types";
import { cn } from "@/lib/utils";
import type { HubStatus } from "../../spine/hooks/use-entity-hub";
import type { MentionCandidate } from "../../spine/mention";
import { LinkSuggestionStrip } from "../../spine/ui/link-suggestion-strip";
import type { ActivityEntry } from "../../tasks/model";
import { birthdayCountdown } from "../dates";
import { parseFieldOptions, selectOptionsFor } from "../field-defs";
import { useContactSuggestions } from "../hooks/use-contact-suggestions";
import type {
  Contact,
  ContactChannel,
  ContactDateEntry,
  ContactFieldDef,
  ContactFieldType,
} from "../model";
import { type ContactRollup, lastTouchLine } from "../rollup";
import { contactStatusMeta, DEFAULT_CONTACT_STATUSES } from "../status";
import { ActivityTrail } from "./activity-trail";
import { initials } from "./contact-directory";
import { ContactStatusBadge, ContactStatusDot } from "./contact-status-badge";
import { EntityLinkPicker } from "./entity-link-picker";
import { EntityTagRow } from "./entity-tag-row";
import { LinkedSections } from "./linked-sections";

// Radix Select forbids an empty-string item value, so "No status" rides a sentinel.
const NO_STATUS = "__none__";

/** Copy to clipboard with the notes-module fallback for non-secure contexts. */
function copyText(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast("Copied", { description: text }),
      () => toast.error("Couldn’t copy"),
    );
    return;
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    el.remove();
    toast("Copied", { description: text });
  } catch {
    toast.error("Couldn’t copy");
  }
}

/** The card's editable draft (everything the inline-edit form owns). */
type Draft = {
  name: string;
  title: string;
  status: string;
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
    emails: c.emails.map((e) => ({ ...e })),
    phones: c.phones.map((e) => ({ ...e })),
    urls: c.urls.map((e) => ({ ...e })),
    addresses: c.addresses.map((e) => ({ ...e })),
    dates: c.dates.map((d) => ({ ...d })),
    custom: Object.fromEntries(
      Object.entries(c.custom).map(([k, v]) => [
        k,
        Array.isArray(v) ? v.join(", ") : String(v ?? ""),
      ]),
    ),
  };
}

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

type DetailRow = { label: string; value: ReactNode; wrap?: boolean; copy?: string };
type DetailGroup = { key: string; icon: typeof Mail; rows: DetailRow[] };

/** Multi-value channel → labelled rows; email/phone/url values act on click. */
function channelRows(
  rows: ContactChannel[],
  kind: "email" | "phone" | "url" | "address",
): DetailRow[] {
  const href = (v: string) =>
    kind === "email"
      ? `mailto:${v}`
      : kind === "phone"
        ? `tel:${v}`
        : kind === "url"
          ? v
          : undefined;
  return rows.map((r) => {
    const h = href(r.value);
    // Display URLs without the protocol noise; the href keeps it.
    const display =
      kind === "url" ? r.value.replace(/^https?:\/\//, "").replace(/\/$/, "") : r.value;
    return {
      label: r.label || kind,
      // Copy the raw value (email/phone/url); addresses have no one-tap channel.
      copy: kind === "address" ? undefined : r.value,
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

/** One field group inside the card: a type icon on the first row, then rows.
 * Copyable rows (email/phone/url) reveal a copy button on hover/focus (R6). */
function DetailsGroup({ icon: Icon, rows }: { icon: typeof Mail; rows: DetailRow[] }) {
  return (
    <div className="px-3 py-2">
      {rows.map((r, i) => (
        <div
          key={i}
          className={cn(
            "group/row flex gap-3 py-1 text-sm",
            r.wrap ? "items-start" : "items-center",
          )}
        >
          <Icon
            className={cn(
              "size-icon-sm shrink-0 text-muted-foreground/70",
              r.wrap && "mt-0.5",
              i > 0 && "invisible",
            )}
            aria-hidden
          />
          <span className="w-16 shrink-0 truncate text-xs text-muted-foreground">{r.label}</span>
          <span
            className={cn("min-w-0 flex-1 text-foreground", r.wrap ? "break-words" : "truncate")}
          >
            {r.value}
          </span>
          {r.copy ? (
            // opacity-0 (not hidden) reserves the column so the value never shifts.
            <IconButton
              icon={Copy}
              label={`Copy ${r.label}`}
              size="sm"
              variant="ghost"
              className="-my-1 shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
              onClick={() => copyText(r.copy!)}
            />
          ) : null}
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
  const { current, busy, accept, dismiss } = useContactSuggestions(
    runtime,
    workspaceId,
    focus,
    onLinked,
  );
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
  const detailGroups = useMemo<DetailGroup[]>(() => {
    const hasBirthday = contact.dates.some((d) => d.label.toLowerCase() === "birthday");
    const customRows: DetailRow[] = fieldDefs.flatMap((f) => {
      const v = contact.custom[f.key];
      const text = Array.isArray(v) ? v.join(", ") : String(v ?? "");
      if (!text) return [];
      const value: ReactNode =
        f.type === "url" ? (
          <a
            key={f.key}
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
        rows: contact.dates.map((d) => {
          // A quiet "in 3 weeks" caption when the date recurs within 60 days (FX-4 AC7).
          const countdown = birthdayCountdown(d.value, now);
          return {
            label: d.label || "date",
            value: (
              <span className="inline-flex items-baseline gap-2">
                {formatDateValue(d.value)}
                {countdown ? (
                  <span className="text-xs text-muted-foreground">{countdown}</span>
                ) : null}
              </span>
            ),
          };
        }),
      },
      { key: "custom", icon: Hash, rows: customRows },
    ].filter((g) => g.rows.length > 0);
  }, [contact, fieldDefs, now]);

  // Linked people get a dedicated People section (FX-5) instead of falling into
  // "Other" — pull them out of the roll-up and enrich with status/avatar. Dedupe
  // by id: a pair can hold two edges of different kinds (references + mentions),
  // which would otherwise render the same person twice with a duplicate key.
  const linkedPeople = useMemo(() => {
    const byId = new Map<
      string,
      { id: string; name: string; status: string; avatarUrl: string | null }
    >();
    for (const r of rollup.sections.flatMap((s) => s.rows)) {
      if (r.other.type !== "contact" || r.tombstoned || byId.has(r.other.id)) continue;
      const c = contactsById?.get(r.other.id);
      byId.set(r.other.id, {
        id: r.other.id,
        name: c?.name || r.title,
        status: c?.status ?? "",
        avatarUrl: c?.avatarUrl ?? null,
      });
    }
    return [...byId.values()];
  }, [rollup.sections, contactsById]);

  // The header already names the company — drop its works-at row from the
  // roll-up so the same fact never renders twice; and person rows move to the
  // People section above, so exclude them from the linked-work buckets.
  const sections = useMemo(() => {
    return rollup.sections
      .map((s) => ({
        ...s,
        rows: s.rows.filter(
          (r) =>
            !(r.other.type === "company" && r.other.id === contact.companyId) &&
            r.other.type !== "contact",
        ),
      }))
      .map((s) => ({ ...s, count: s.rows.length }))
      .filter((s) => s.rows.length > 0);
  }, [rollup.sections, contact.companyId]);

  function clean(rows: ContactChannel[]): ContactChannel[] {
    return rows
      .filter((r) => r.value.trim() !== "")
      .map((r) => ({
        label: r.label.trim() || "other",
        value: r.value.trim(),
        primary: r.primary,
      }));
  }

  function save() {
    const patch: ContactDetailsPatch = {
      name: draft.name.trim() || contact.name,
      title: draft.title.trim() || null,
      status: draft.status,
      emails: clean(draft.emails),
      phones: clean(draft.phones),
      urls: clean(draft.urls),
      addresses: clean(draft.addresses),
      dates: draft.dates
        .filter((d) => d.value.trim() !== "")
        .map((d) => ({ label: d.label.trim() || "date", value: d.value })),
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
        {editing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="c-title">Title</Label>
                <Input
                  id="c-title"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Head of ops"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-status">Status</Label>
                <Select
                  value={contactStatusMeta(draft.status).id || NO_STATUS}
                  onValueChange={(v) => setDraft({ ...draft, status: v === NO_STATUS ? "" : v })}
                >
                  <SelectTrigger id="c-status">
                    <SelectValue />
                  </SelectTrigger>
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
              <div className="flex items-center gap-1">
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
                {companyName && onClearCompany ? (
                  <IconButton
                    icon={X}
                    label="Remove company"
                    size="sm"
                    variant="ghost"
                    onClick={onClearCompany}
                  />
                ) : null}
              </div>
            </div>
            <ChannelEditor
              label="Email"
              placeholder="name@example.com"
              rows={draft.emails}
              onChange={(r) => setDraft({ ...draft, emails: r })}
            />
            <ChannelEditor
              label="Phone"
              placeholder="+1 555 0100"
              rows={draft.phones}
              onChange={(r) => setDraft({ ...draft, phones: r })}
            />
            <ChannelEditor
              label="URL"
              placeholder="https://…"
              rows={draft.urls}
              onChange={(r) => setDraft({ ...draft, urls: r })}
            />
            <ChannelEditor
              label="Address"
              placeholder="123 Main St, City"
              rows={draft.addresses}
              onChange={(r) => setDraft({ ...draft, addresses: r })}
            />
            <DatesEditor rows={draft.dates} onChange={(r) => setDraft({ ...draft, dates: r })} />
            <div className="space-y-1.5">
              <Label>Custom fields</Label>
              {fieldDefs.map((f) => (
                <div key={f.id} className="flex items-center gap-1.5">
                  <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">
                    {f.label}
                  </span>
                  {f.type === "select" ? (
                    <Select
                      value={(draft.custom[f.key] ?? "") || NO_STATUS}
                      onValueChange={(v) =>
                        setDraft({
                          ...draft,
                          custom: { ...draft.custom, [f.key]: v === NO_STATUS ? "" : v },
                        })
                      }
                    >
                      <SelectTrigger className="min-w-0 flex-1" aria-label={f.label}>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_STATUS}>
                          <span className="text-muted-foreground">None</span>
                        </SelectItem>
                        {selectOptionsFor(f, draft.custom[f.key] ?? "").map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                      value={draft.custom[f.key] ?? ""}
                      onChange={(e) =>
                        setDraft({ ...draft, custom: { ...draft.custom, [f.key]: e.target.value } })
                      }
                      className="min-w-0 flex-1"
                      aria-label={f.label}
                    />
                  )}
                  {onDeleteField ? (
                    <IconButton
                      icon={X}
                      label={`Remove ${f.label} field`}
                      size="sm"
                      variant="ghost"
                      onClick={() => onDeleteField(f.id)}
                    />
                  ) : null}
                </div>
              ))}
              {onAddField ? <AddFieldInline onAdd={onAddField} /> : null}
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
          <ContactSuggestions
            runtime={runtime}
            workspaceId={workspaceId}
            contactId={contact.id}
            onLinked={onLinked}
          />
        ) : null}

        {/* Linked people — person↔person links get their own quiet section (FX-5) */}
        {!editing && linkedPeople.length > 0 ? (
          <section className="space-y-1">
            <Eyebrow as="h3">People</Eyebrow>
            <ul className="space-y-0.5">
              {linkedPeople.map((p) => (
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
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {p.name}
                    </span>
                    {p.status ? <ContactStatusDot status={p.status} /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Linked work — one fixed section per module relation, always present */}
        {!editing ? (
          <LinkedSections
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

/**
 * The header status pill — a click-to-open dropdown in view mode (FX-4 AC5).
 * Optimistic: the pill flips immediately and rolls back on failure (the page
 * toasts). Read-only members (or no handler) see a plain badge.
 */
function HeaderStatus({
  contact,
  canEdit,
  onSetStatus,
}: {
  contact: Contact;
  canEdit: boolean;
  onSetStatus?: (status: string) => Promise<void>;
}) {
  const [optimistic, setOptimistic] = useState<string | null>(null);
  // Drop the optimistic override once the real status catches up (or on switch).
  useEffect(() => setOptimistic(null), [contact.id, contact.status]);
  const status = optimistic ?? contact.status;

  const options = useMemo(() => {
    const opts: { id: string; label: string }[] = [
      { id: "", label: "No status" },
      ...DEFAULT_CONTACT_STATUSES.map((s) => ({ id: s.id, label: s.label })),
    ];
    const meta = contactStatusMeta(status);
    if (meta.id && !opts.some((o) => o.id === meta.id))
      opts.push({ id: meta.id, label: meta.label });
    return opts;
  }, [status]);

  if (!canEdit || !onSetStatus) {
    return status ? <ContactStatusBadge status={status} /> : null;
  }

  const change = (next: string) => {
    if (next === status) return;
    setOptimistic(next);
    void onSetStatus(next).catch(() => setOptimistic(null));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Change status"
        >
          {status ? (
            <ContactStatusBadge status={status} />
          ) : (
            <span className="text-muted-foreground/70">Set status</span>
          )}
          <ChevronDown className="size-icon-sm shrink-0 opacity-60" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((o) => (
          <DropdownMenuItem key={o.id || "none"} onSelect={() => change(o.id)}>
            <span className="flex flex-1 items-center gap-1.5">
              {o.id ? (
                <ContactStatusDot status={o.id} />
              ) : (
                <span
                  className="inline-block size-2 shrink-0 rounded-full border border-border"
                  aria-hidden
                />
              )}
              {o.label}
              {contactStatusMeta(status).id === o.id ? (
                <Check className="ml-auto size-icon-sm text-muted-foreground" aria-hidden />
              ) : null}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DatesEditor({
  rows,
  onChange,
}: {
  rows: ContactDateEntry[];
  onChange: (rows: ContactDateEntry[]) => void;
}) {
  const set = (i: number, patch: Partial<ContactDateEntry>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-1.5">
      <Label>Dates</Label>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={r.label}
            onChange={(e) => set(i, { label: e.target.value })}
            placeholder="birthday"
            className="w-24 shrink-0"
            aria-label="Date label"
          />
          <Input
            type="date"
            value={r.value}
            onChange={(e) => set(i, { value: e.target.value })}
            className="min-w-0 flex-1"
            aria-label="Date"
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
        onClick={() => onChange([...rows, { label: "birthday", value: "" }])}
      >
        <Plus className="size-icon-sm" aria-hidden />
        Add date
      </Button>
    </div>
  );
}

// "date" is deliberately absent — labelled dates already live in the Dates
// section; offering a date custom field would create a second dates concept.
// "select" is single-select only (multi_select stays deferred; FX-8).
const FIELD_TYPES: ContactFieldType[] = ["text", "number", "url", "select"];

/** Inline "add a custom field" control (defines a workspace field def). A
 * `select` field asks for its options inline (comma-separated) before it can be
 * added (FX-8). */
function AddFieldInline({
  onAdd,
}: {
  onAdd: (label: string, type: ContactFieldType, options?: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<ContactFieldType>("text");
  const [optionsInput, setOptionsInput] = useState("");

  const parsedOptions = parseFieldOptions(optionsInput);
  const canAdd = label.trim().length > 0 && (type !== "select" || parsedOptions.length > 0);
  const reset = () => {
    setLabel("");
    setType("text");
    setOptionsInput("");
    setOpen(false);
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-icon-sm" aria-hidden />
        Add field
      </Button>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Field name"
          className="min-w-0 flex-1"
          aria-label="New field name"
          autoFocus
        />
        <Select value={type} onValueChange={(v) => setType(v as ContactFieldType)}>
          <SelectTrigger className="w-24" aria-label="Field type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={!canAdd}
          onClick={() => {
            onAdd(label.trim(), type, type === "select" ? parsedOptions : undefined);
            reset();
          }}
        >
          Add
        </Button>
        <IconButton icon={X} label="Cancel" size="sm" variant="ghost" onClick={reset} />
      </div>
      {type === "select" ? (
        <Input
          value={optionsInput}
          onChange={(e) => setOptionsInput(e.target.value)}
          placeholder="Options, comma-separated"
          aria-label="Select options"
          className="w-full"
        />
      ) : null}
    </div>
  );
}
