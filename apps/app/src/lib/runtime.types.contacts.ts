/** The runtime port's contacts (implemented in runtime.web.contacts.ts). */

import type { ContactImportResult, ContactImportRow } from "../features/contacts/import";
import type {
  Company,
  Contact,
  ContactChannel,
  ContactCustomValue,
  ContactDateEntry,
  ContactFieldDef,
  ContactFieldType,
  ContactsModuleBundle,
} from "../features/contacts/model";
import type { NeedsAttentionItem } from "../features/contacts/needs-attention";
import type { ReconnectItem } from "../features/contacts/reconnect";
import type { EntityLink, EntityRef, LinkOrigin, RelationKind } from "./entity-links";

/** Partial patch for `setContactDetails` — camelCase keys mirror the SQL op. */
export type ContactDetailsPatch = Partial<{
  name: string;
  title: string | null;
  notesInline: string;
  status: string;
  isFavorite: boolean;
  companyId: string | null;
  emails: ContactChannel[];
  phones: ContactChannel[];
  addresses: ContactChannel[];
  urls: ContactChannel[];
  dates: ContactDateEntry[];
  custom: Record<string, ContactCustomValue>;
}>;

/** Partial patch for `setCompanyDetails`. */
export type CompanyDetailsPatch = Partial<{
  name: string;
  website: string | null;
  domains: string[];
  notesInline: string;
  custom: Record<string, ContactCustomValue>;
}>;

/**
 * Contacts module (light CRM) — block CO-1. People + companies are hub
 * entities whose pages roll up from the spine. Cloud-first: web hits Supabase
 * directly; desktop delegates to the web runtime (same code path). All
 * invariant-bearing writes go through `contacts_op_*` / `companies_op_*` RPCs
 * (permission guard + write + `entities` registry upsert + attributed activity
 * in one transaction); reads are direct SELECTs over the indexed tables.
 */
export type ContactsRuntime = {
  /** People + companies for the directory (CO-2 builds the UI on this). */
  list(workspaceId: string): Promise<ContactsModuleBundle>;
  createContact(input: {
    workspaceId: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    title?: string | null;
    companyId?: string | null;
    status?: string;
    notesInline?: string;
  }): Promise<Contact>;
  updateContact(input: {
    workspaceId: string;
    contactId: string;
    name?: string;
    email?: string | null;
    phone?: string | null;
    title?: string | null;
    notesInline?: string;
    /** Pass to set/clear the denormalized company FK (canonical edge is the link). */
    setCompany?: { companyId: string | null };
  }): Promise<Contact>;
  /** Optimistic, flat status change (AC3). Accepts any renamed/custom label. */
  setStatus(input: { workspaceId: string; contactId: string; status: string }): Promise<Contact>;
  createCompany(input: {
    workspaceId: string;
    name: string;
    domains?: string[];
    website?: string | null;
    notesInline?: string;
  }): Promise<Company>;
  updateCompany(input: {
    workspaceId: string;
    companyId: string;
    name?: string;
    domains?: string[];
    website?: string | null;
    notesInline?: string;
  }): Promise<Company>;
  /**
   * Link a contact/company to any other entity via the spine, attributed to
   * Contacts (`contacts_op_link`). Idempotent + direction-agnostic.
   */
  link(input: {
    workspaceId: string;
    contact: EntityRef;
    target: EntityRef;
    relationKind?: RelationKind;
    origin?: LinkOrigin;
    contactLabel?: string;
    targetLabel?: string;
    targetIcon?: string | null;
  }): Promise<EntityLink>;
  /** Soft-delete a link the contact owns (Undo-friendly; idempotent). */
  unlink(input: { workspaceId: string; linkId: string }): Promise<EntityLink | null>;
  /** Soft-delete a contact: drops its links + tombstones the registry entry. */
  deleteContact(input: { workspaceId: string; contactId: string }): Promise<Contact>;
  /**
   * Un-delete a soft-deleted contact (the delete toast's Undo, DF-5):
   * revives exactly the links the delete dropped + un-tombstones the
   * registry entry.
   */
  restoreContact(input: { workspaceId: string; contactId: string }): Promise<Contact>;
  /**
   * Soft-delete a company (FX-7): clears members' denormalized company_id,
   * drops every link touching it (works-at included), tombstones the registry
   * entry. Member contacts survive — only their company chip clears.
   */
  deleteCompany(input: { workspaceId: string; companyId: string }): Promise<Company>;
  /**
   * Bulk CSV import (AC6) — one attributed, activity-logged op. The client
   * parses + previews dedupe; this writes the confirmed plan (create / merge
   * rows) in a single transaction and returns the counts + affected ids.
   */
  importContacts(input: {
    workspaceId: string;
    rows: ContactImportRow[];
  }): Promise<ContactImportResult>;
  /**
   * Contacts that need attention (AC11) — overdue follow-ups, no-touch active
   * contacts (>14d), stale leads (>30d). The "Needs attention" dashboard widget
   * read; an indexed contacts + follow-up-links + tasks read, shaped by the pure
   * selector. Degrades to fewer signals before the contacts migration deploys.
   */
  needsAttention(input: { workspaceId: string }): Promise<NeedsAttentionItem[]>;
  /** Contacts you've gone quiet on (oldest last-touch first) — the Reconnect widget. */
  reconnect(input: { workspaceId: string }): Promise<ReconnectItem[]>;
  /**
   * Apply a partial detail patch to a contact (the inline-edit card's save) —
   * any of name/title/notesInline/status/isFavorite/companyId + the labelled
   * lists (emails/phones/addresses/urls/dates) + custom. Derives the scalar
   * email/phone from each list's primary. (v2.)
   */
  setContactDetails(input: {
    workspaceId: string;
    contactId: string;
    patch: ContactDetailsPatch;
  }): Promise<Contact>;
  /** Toggle the per-workspace favorite flag. */
  setFavorite(input: { workspaceId: string; contactId: string; value: boolean }): Promise<Contact>;
  /** Apply a partial detail patch to a company (name/website/domains/notes/custom). */
  setCompanyDetails(input: {
    workspaceId: string;
    companyId: string;
    patch: CompanyDetailsPatch;
  }): Promise<Company>;
  /** Create/upsert a workspace custom-field definition (the "add field" picker). */
  addFieldDef(input: {
    workspaceId: string;
    key: string;
    label?: string;
    type?: ContactFieldType;
    options?: string[];
    position?: number;
  }): Promise<ContactFieldDef>;
  /** Remove a custom-field definition (values remain in the blobs, just unsurfaced). */
  deleteFieldDef(input: { workspaceId: string; fieldId: string }): Promise<void>;
};
