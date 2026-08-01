// Create a contact — the upgraded entry modal (block FX-6, AC9). Create-only
// (the card edits inline, so the old "edit" mode is gone). Adds: a Company
// find-or-create field, a domain→company hint, a non-blocking duplicate warning
// with "Open instead", "Add another" for rapid entry (⌘Enter), and paste-to-
// autofill that keeps ALL parsed emails/phones (create, then patch the lists).
// Tokens + shadcn only; sentence case.

import { Building2, Plus, UserSearch, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ModuoRuntime } from "@/lib/runtime.types";
import type { MentionCandidate } from "../../spine/mention";
import { probeDuplicate } from "../dedupe";
import type { Company, Contact } from "../model";
import { parseContactText } from "../parse-contact";
import { contactStatusMeta, DEFAULT_CONTACT_STATUSES } from "../status";
import { ContactStatusDot } from "./contact-status-badge";
import { EntityLinkPicker } from "./entity-link-picker";

/** The company a new contact is filed under: an existing one, or one to create. */
export type CompanyChoice = { id: string; name: string } | { createName: string } | null;

export type ContactFormValues = {
  name: string;
  title: string;
  status: string;
  /** Full deduped email list, primary first; [0] is the scalar fast-path. */
  emails: string[];
  phones: string[];
  company: CompanyChoice;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  /** The loaded directory — powers the duplicate probe + the domain hint (zero reads). */
  existingContacts: Contact[];
  companies: Company[];
  /** Preset company ("+ Add person" from a company page). */
  initialCompany?: { id: string; name: string } | null;
  onSubmit: (values: ContactFormValues, opts: { addAnother: boolean }) => Promise<void>;
  /** Jump to an existing contact ("Open instead" on the dup warning). */
  onOpenExisting: (contactId: string) => void;
};

// Radix Select forbids an empty-string item value, so "No status" rides a sentinel.
const NO_STATUS = "__none__";

type Fields = { name: string; email: string; phone: string; title: string; status: string };
const EMPTY: Fields = { name: "", email: "", phone: "", title: "", status: "" };

function domainOf(email: string): string | null {
  const at = email.trim().toLowerCase().lastIndexOf("@");
  if (at < 0) return null;
  const domain = email
    .trim()
    .toLowerCase()
    .slice(at + 1);
  return domain.includes(".") ? domain : null;
}

export function ContactFormDialog({
  open,
  onOpenChange,
  runtime,
  workspaceId,
  existingContacts,
  companies,
  initialCompany = null,
  onSubmit,
  onOpenExisting,
}: Props) {
  const [values, setValues] = useState<Fields>(EMPTY);
  const [company, setCompany] = useState<CompanyChoice>(null);
  // Extra emails/phones captured from a paste, BEYOND the primary shown in the
  // field (paste stores parsed[1..]). Keeping only the extras — not the full
  // parsed list — means correcting the email/phone field can't resurrect the
  // original primary as a stray secondary channel (AC9).
  const [pastedEmails, setPastedEmails] = useState<string[]>([]);
  const [pastedPhones, setPastedPhones] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setPasteOpen(false);
    setValues(EMPTY);
    setPastedEmails([]);
    setPastedPhones([]);
    setCompany(initialCompany ? { id: initialCompany.id, name: initialCompany.name } : null);
  }, [open, initialCompany]);

  const set = (patch: Partial<Fields>) => setValues((v) => ({ ...v, ...patch }));
  const canSave = values.name.trim().length > 0 && !saving;

  // Status is optional ("No status" first); a renamed/custom status stays selectable.
  const statusMeta = contactStatusMeta(values.status);
  const statusOptions: { id: string; label: string }[] = [
    { id: "", label: "No status" },
    ...DEFAULT_CONTACT_STATUSES,
  ];
  if (statusMeta.id && !statusOptions.some((s) => s.id === statusMeta.id))
    statusOptions.push(statusMeta);

  const companyLabel = company ? ("name" in company ? company.name : company.createName) : null;

  // Duplicate probe — a non-blocking warning against the loaded directory (AC9).
  const duplicate = useMemo(
    () =>
      values.name.trim() || values.email.trim()
        ? probeDuplicate({ name: values.name, email: values.email }, existingContacts)
        : null,
    [values.name, values.email, existingContacts],
  );

  // Domain→company hint: when the email domain matches a company and none is
  // chosen yet, offer a one-tap "Add to Acme" (AC9).
  const domainHint = useMemo(() => {
    if (company) return null;
    const domain = domainOf(values.email);
    if (!domain) return null;
    return companies.find((c) => c.domains.some((d) => d.trim().toLowerCase() === domain)) ?? null;
  }, [company, values.email, companies]);

  function onPickCompany(candidate: MentionCandidate) {
    if (candidate.kind === "entity") setCompany({ id: candidate.ref.id, name: candidate.label });
    else if (candidate.kind === "create") setCompany({ createName: candidate.label });
  }

  function resetForNext() {
    setValues(EMPTY);
    setPastedEmails([]);
    setPastedPhones([]);
    setPasteOpen(false);
    // Keep the company (rapid entry of teammates at one company); clear the rest.
    nameRef.current?.focus();
  }

  async function handleSubmit(addAnother: boolean) {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    // Merge the single fields with any pasted extras; dedupe happens downstream.
    const emails = [values.email.trim(), ...pastedEmails].filter(Boolean);
    const phones = [values.phone.trim(), ...pastedPhones].filter(Boolean);
    try {
      await onSubmit(
        {
          name: values.name.trim(),
          title: values.title.trim(),
          status: values.status,
          emails,
          phones,
          company,
        },
        { addAnother },
      );
      if (addAnother) resetForNext();
      else onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save the contact.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New contact</DialogTitle>
          <DialogDescription>Add a person to your contacts.</DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit(false); // plain Enter → Add contact + close
          }}
          onKeyDown={(e) => {
            // ⌘/Ctrl+Enter saves and keeps going (Add another).
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.stopPropagation();
              void handleSubmit(true);
            }
          }}
        >
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setPasteOpen((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {pasteOpen ? "Hide paste" : "Paste a signature to autofill"}
            </button>
            {pasteOpen ? (
              <Textarea
                rows={3}
                placeholder="Paste an email signature or contact block…"
                onChange={(e) => {
                  const p = parseContactText(e.target.value);
                  set({
                    name: p.name ?? values.name,
                    email: p.emails[0] ?? values.email,
                    phone: p.phones[0] ?? values.phone,
                    title: p.title ?? values.title,
                  });
                  // Store the extras (beyond the primary in the field) so all
                  // parsed values land on the created contact, without pinning
                  // the primary if the user later edits it.
                  setPastedEmails(p.emails.slice(1));
                  setPastedPhones(p.phones.slice(1));
                }}
              />
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact-name">Name</Label>
            <Input
              ref={nameRef}
              id="contact-name"
              value={values.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Dana Lee"
              autoFocus
            />
          </div>

          {/* Duplicate warning — informational, never blocks (AC9). */}
          {duplicate ? (
            <div className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
              <UserSearch className="size-icon-sm shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                Looks like {duplicate.name || "an existing contact"}
              </span>
              <button
                type="button"
                onClick={() => {
                  onOpenExisting(duplicate.id);
                  onOpenChange(false);
                }}
                className="shrink-0 font-medium text-foreground underline underline-offset-2"
              >
                Open instead
              </button>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="contact-email">Email</Label>
              <Input
                id="contact-email"
                type="email"
                value={values.email}
                onChange={(e) => set({ email: e.target.value })}
                placeholder="dana@acme.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-phone">Phone</Label>
              <Input
                id="contact-phone"
                value={values.phone}
                onChange={(e) => set({ phone: e.target.value })}
                placeholder="+1 555 0100"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Company</Label>
            <div className="flex items-center gap-1.5">
              <EntityLinkPicker
                runtime={runtime}
                workspaceId={workspaceId}
                types={["company"]}
                canCreate
                createType="company"
                placeholder="Find or create a company…"
                emptyLabel="No companies."
                trigger={
                  <Button type="button" variant="outline" size="sm" className="gap-1.5">
                    <Building2 className="size-icon-sm" aria-hidden />
                    {companyLabel ?? "Set company"}
                  </Button>
                }
                onPick={onPickCompany}
              />
              {company ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  onClick={() => setCompany(null)}
                >
                  <X className="size-icon-sm" aria-hidden />
                  Clear
                </Button>
              ) : null}
            </div>
            {domainHint ? (
              <button
                type="button"
                onClick={() => setCompany({ id: domainHint.id, name: domainHint.name })}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Add to {domainHint.name}?
              </button>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact-title">Title</Label>
            <Input
              id="contact-title"
              value={values.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="Head of ops"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-status">Status</Label>
            <Select
              value={statusMeta.id || NO_STATUS}
              onValueChange={(v) => set({ status: v === NO_STATUS ? "" : v })}
            >
              <SelectTrigger id="contact-status" aria-label="Status">
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

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="gap-1.5"
              disabled={!canSave}
              onClick={() => void handleSubmit(true)}
            >
              <Plus className="size-icon-sm" aria-hidden />
              Add another
            </Button>
            <Button type="button" disabled={!canSave} onClick={() => void handleSubmit(false)}>
              {saving ? "Saving…" : "Add contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
