// Contacts module (light CRM) — data model. Wave 1, block CO-1.
//
// People and companies are hub entities: they own almost no native depth (~90%
// roll-up; specs/contacts.md §Scope). The contact record is deliberately thin —
// fixed fields + a renamable flat status + a one-line scratch note. Rich notes
// live in the Notes module (linked), pipelines/deal-stages are explicitly out of
// scope (a "deal" is a task/note linked to a contact).
//
// Mirrors the Supabase shape in
// supabase/migrations/20260626120000_contacts_module.sql. Both `contact` and
// `company` register in the central `entities` spine registry, so they are
// addressable by `(entity_type, entity_id)` and immediately linkable/mentionable
// (specs/contacts.md AC1).

/**
 * A contact's flat status. Stored as a lowercase id; the default set
 * (Lead / Active / Dormant / Archived) is renamable in settings but NEVER gains
 * stages, required transitions, or automation (specs/contacts.md AC3 — the
 * enterprise-CRM gravity well we refuse). A renamed/custom status is just
 * another string; see {@link normalizeContactStatus} / {@link contactStatusMeta}.
 */
export type ContactStatus = string;

/**
 * A labelled, repeatable contact channel — email / phone / address / url
 * (specs/contacts-v2.md). `label` is a small preset (work/home/mobile/…) or a
 * custom string; `primary` marks the value the scalar fast-path mirrors.
 */
export type ContactChannel = {
  label: string;
  value: string;
  primary?: boolean;
};

/** A labelled date entry — birthday / anniversary / custom (value = YYYY-MM-DD). */
export type ContactDateEntry = {
  label: string;
  value: string;
};

/** Custom-field value: scalar, or an array for multi-select. */
export type ContactCustomValue = string | string[];

export type ContactFieldType =
  | "text"
  | "number"
  | "date"
  | "select"
  | "multi_select"
  | "url"
  | "checkbox";

/** A user-defined custom-field definition (workspace-scoped; values live on the row). */
export type ContactFieldDef = {
  id: string;
  workspaceId: string;
  key: string;
  label: string;
  type: ContactFieldType;
  options: string[];
  position: number;
};

/** A person. The center hub of the light CRM (specs/contacts.md §Product). */
export type Contact = {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  /** Primary email (the dedupe/suggest fast-path; mirrors the primary of {@link emails}). */
  email: string | null;
  /** Labelled emails (v2). The flat dedupe key is the `email` scalar. */
  emails: ContactChannel[];
  /** Primary phone (mirrors the primary of {@link phones}). */
  phone: string | null;
  phones: ContactChannel[];
  addresses: ContactChannel[];
  urls: ContactChannel[];
  /** Birthday + other dates (label 'birthday' is special — drives reminders). */
  dates: ContactDateEntry[];
  title: string | null;
  /** Denormalized company FK convenience (canonical edge is the `works-at` link). */
  companyId: string | null;
  /** Optional, renamable label — '' means no status (never forced; v2 decision 3). */
  status: ContactStatus;
  /** User-defined custom-field values, keyed by field-def key. */
  custom: Record<string, ContactCustomValue>;
  isFavorite: boolean;
  /** One-line scratch only — rich notes live in the Notes module (decision 9). */
  notesInline: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/** A company. A company hub rolls up its people + their linked work (AC8). */
export type Company = {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  /** Email domains — the deterministic email-domain→company suggestion key (AC7). */
  domains: string[];
  website: string | null;
  custom: Record<string, ContactCustomValue>;
  notesInline: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/** Everything the directory + hubs need in one read (CO-2 builds on this). */
export type ContactsModuleBundle = {
  contacts: Contact[];
  companies: Company[];
  /** Workspace custom-field definitions (the "add field" picker source). */
  fieldDefs: ContactFieldDef[];
};
