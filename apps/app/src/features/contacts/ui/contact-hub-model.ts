// The pure side of the contact card: the inline-edit draft and the patch it
// saves, the status choices, and how the roll-up splits into a People list and
// the linked-work sections.

import type { ContactDetailsPatch } from "@/lib/runtime.types";

import type { Contact, ContactChannel, ContactDateEntry } from "../model";
import type { ContactRollup } from "../rollup";
import { contactStatusMeta, DEFAULT_CONTACT_STATUSES } from "../status";

/** The card's editable draft (everything the inline-edit form owns). */
export type Draft = {
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

export function draftFrom(c: Contact): Draft {
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

function clean(rows: ContactChannel[]): ContactChannel[] {
  return rows
    .filter((r) => r.value.trim() !== "")
    .map((r) => ({
      label: r.label.trim() || "other",
      value: r.value.trim(),
      primary: r.primary,
    }));
}

/** The one patch Save sends: trimmed, blanks dropped, labels defaulted. */
export function patchFromDraft(draft: Draft, contact: Contact): ContactDetailsPatch {
  return {
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
}

/** "No status", the defaults, and the draft's own status when it is a custom one. */
export function statusOptionsFor(status: string): { id: string; label: string }[] {
  const meta = contactStatusMeta(status);
  const options: { id: string; label: string }[] = [
    { id: "", label: "No status" },
    ...DEFAULT_CONTACT_STATUSES,
  ];
  if (meta.id && !options.some((s) => s.id === meta.id)) {
    options.push({ id: meta.id, label: meta.label });
  }
  return options;
}

export type LinkedPerson = { id: string; name: string; status: string; avatarUrl: string | null };

// Linked people get a dedicated People section (FX-5) instead of falling into
// "Other" — pull them out of the roll-up and enrich with status/avatar. Dedupe
// by id: a pair can hold two edges of different kinds (references + mentions),
// which would otherwise render the same person twice with a duplicate key.
export function linkedPeopleOf(
  rollup: ContactRollup,
  contactsById: Map<string, Contact> | undefined,
): LinkedPerson[] {
  const byId = new Map<string, LinkedPerson>();
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
}

// The header already names the company — drop its works-at row from the
// roll-up so the same fact never renders twice; and person rows move to the
// People section above, so exclude them from the linked-work buckets.
export function linkedSectionsOf(rollup: ContactRollup, companyId: string | null | undefined) {
  return rollup.sections
    .map((s) => ({
      ...s,
      rows: s.rows.filter(
        (r) =>
          !(r.other.type === "company" && r.other.id === companyId) && r.other.type !== "contact",
      ),
    }))
    .map((s) => ({ ...s, count: s.rows.length }))
    .filter((s) => s.rows.length > 0);
}
