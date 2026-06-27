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

/** A person. The center hub of the light CRM (specs/contacts.md §Product). */
export type Contact = {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  /** Primary email; additional addresses live in {@link emails}. */
  email: string | null;
  /** All known addresses (dedupe/suggest match on these; AC7). */
  emails: string[];
  phone: string | null;
  title: string | null;
  /** Denormalized company FK convenience (the canonical edge is the `works-at`
   * link; specs/contacts.md decision 3). */
  companyId: string | null;
  status: ContactStatus;
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
};
