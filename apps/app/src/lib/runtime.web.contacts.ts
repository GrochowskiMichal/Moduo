/** The web runtime's contacts (Supabase). */

import {
  companyRowSchema,
  contactFieldDefRowSchema,
  contactRowSchema,
  mapKnownRows,
  requireRow,
} from "@contracts/rows";
import { isOpenTask, normalizeTaskStatusCategory } from "@contracts/vocabularies";
import type {
  Company,
  Contact,
  ContactChannel,
  ContactCustomValue,
  ContactDateEntry,
  ContactFieldDef,
} from "../features/contacts/model";
import { type OverdueFollowup, selectNeedsAttention } from "../features/contacts/needs-attention";
import { selectReconnect } from "../features/contacts/reconnect";
import { collectTruncations, READ_CAPS } from "./paged-select";
import { DbError, runQuery, runRpc } from "./runtime.db";
import type { ContactsRuntime } from "./runtime.types";
import { supabaseClient } from "./runtime.web.client";
import { entityLinkRowToModel, firstRow, selectCapped } from "./runtime.web.shared";

/** A Date as a local YYYY-MM-DD calendar date. */
function localDateOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today's local calendar date as YYYY-MM-DD. */
function localToday(): string {
  return localDateOf(new Date());
}

/**
 * Contacts with a follow-up task past its due date (AC11). One indexed read of
 * the workspace's follow-up links, then one batched read of their task endpoints
 * — no per-contact fan-out. Open tasks only (done/archived excluded).
 */
async function loadOverdueFollowups(workspaceId: string): Promise<OverdueFollowup[]> {
  const links = await runQuery(
    supabaseClient
      .from("entity_links")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("relation_kind", "follow-up")
      .is("deleted_at", null),
  );

  const taskToContact = new Map<string, string>();
  for (const l of links ?? []) {
    const contactId =
      l.source_type === "contact" ? l.source_id : l.target_type === "contact" ? l.target_id : null;
    const taskId =
      l.source_type === "task" ? l.source_id : l.target_type === "task" ? l.target_id : null;
    if (contactId && taskId) taskToContact.set(taskId, contactId);
  }
  const taskIds = [...taskToContact.keys()];
  if (taskIds.length === 0) return [];

  // Whole rows (a handful): the date and category columns exist only from
  // TV-D9 on, and naming one a database doesn't have fails the read.
  const tasks = await runQuery(
    supabaseClient
      .from("tasks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("id", taskIds)
      .is("deleted_at", null),
  );

  // The due date is a date since TV-D9 (due_on, the same for everyone). A row
  // from before it has only the timestamptz (stored from local midnight →
  // UTC), normalized back to a local calendar date before comparing. Backlog
  // is never late (REPLAN 53), so only open tasks count.
  const today = localToday();
  const overdue: OverdueFollowup[] = [];
  for (const t of tasks ?? []) {
    const open = isOpenTask({
      status: t.status,
      statusCategory: t.status_category ? normalizeTaskStatusCategory(t.status_category) : null,
    });
    const dueLocal =
      typeof t.due_on === "string"
        ? t.due_on
        : t.due_date
          ? localDateOf(new Date(t.due_date))
          : null;
    if (!dueLocal || !open) continue;
    if (dueLocal < today) {
      const contactId = taskToContact.get(t.id);
      if (contactId) overdue.push({ contactId, dueDate: dueLocal });
    }
  }
  return overdue;
}

// ── Contacts module row<->model mappers (block CO-1) ──────────────────────────

/** Parse a jsonb labelled-channel list defensively. */
function channelList(v: unknown): ContactChannel[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x: any) => ({
      label: String(x?.label ?? ""),
      value: String(x?.value ?? ""),
      primary: Boolean(x?.primary),
    }))
    .filter((c) => c.value !== "");
}
function dateList(v: unknown): ContactDateEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x: any) => ({ label: String(x?.label ?? ""), value: String(x?.value ?? "") }))
    .filter((d) => d.value !== "");
}
function customMap(v: unknown): Record<string, ContactCustomValue> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, ContactCustomValue> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (Array.isArray(val)) out[k] = val.map(String);
    else if (val != null) out[k] = String(val);
  }
  return out;
}

function contactRowToModel(raw: unknown): Contact {
  const r = requireRow(contactRowSchema, raw, "contact");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ownerId: r.owner_id ?? "",
    name: r.name ?? "",
    email: r.email ?? null,
    emails: channelList(r.emails),
    phone: r.phone ?? null,
    phones: channelList(r.phones),
    addresses: channelList(r.addresses),
    urls: channelList(r.urls),
    dates: dateList(r.dates),
    title: r.title ?? null,
    companyId: r.company_id ?? null,
    status: r.status ?? "",
    custom: customMap(r.custom),
    isFavorite: r.is_favorite === true,
    notesInline: r.notes_inline ?? "",
    avatarUrl: r.avatar_url ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

function companyRowToModel(raw: unknown): Company {
  const r = requireRow(companyRowSchema, raw, "company");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    ownerId: r.owner_id ?? "",
    name: r.name ?? "",
    domains: Array.isArray(r.domains) ? r.domains : [],
    website: r.website ?? null,
    custom: customMap(r.custom),
    notesInline: r.notes_inline ?? "",
    avatarUrl: r.avatar_url ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

function contactFieldDefRowToModel(raw: unknown): ContactFieldDef {
  const r = requireRow(contactFieldDefRowSchema, raw, "contact field");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    key: r.key,
    label: r.label ?? r.key,
    type: r.type ?? "text",
    options: Array.isArray(r.options) ? r.options.map(String) : [],
    position: typeof r.position === "number" ? r.position : Number(r.position) || 0,
  };
}

// ── Contacts module (specs/contacts.md block CO-1) ──────────────────────────
// Writes go through contacts_op_* / companies_op_* RPCs (permission guard +
// write + entities-registry upsert + attributed activity in one transaction);
// reads are direct, indexed SELECTs over contacts / companies.
export const webContacts: ContactsRuntime = {
  async list(workspaceId) {
    const [contactsRes, companiesRes, defsRes] = await Promise.all([
      selectCapped<any>({
        scope: "people",
        cap: READ_CAPS.contacts,
        build: (opts) =>
          supabaseClient
            .from("contacts")
            .select("*", opts)
            .eq("workspace_id", workspaceId)
            .is("deleted_at", null),
        order: (q) => q.order("name").order("id"),
      }),
      selectCapped<any>({
        scope: "companies",
        cap: READ_CAPS.companies,
        build: (opts) =>
          supabaseClient
            .from("companies")
            .select("*", opts)
            .eq("workspace_id", workspaceId)
            .is("deleted_at", null),
        order: (q) => q.order("name").order("id"),
      }),
      selectCapped<any>({
        scope: "fields",
        cap: READ_CAPS.contactFieldDefs,
        build: (opts) =>
          supabaseClient
            .from("contact_field_defs")
            .select("*", opts)
            .eq("workspace_id", workspaceId),
        order: (q) => q.order("position").order("id"),
      }),
    ]);
    if (contactsRes.error) throw new DbError(contactsRes.error);
    if (companiesRes.error) throw new DbError(companiesRes.error);
    // Field defs are additive — degrade to none if the v2 migration isn't deployed yet.
    const fieldDefs = defsRes.error ? [] : mapKnownRows(defsRes.rows, contactFieldDefRowToModel);
    return {
      contacts: mapKnownRows(contactsRes.rows, contactRowToModel),
      companies: mapKnownRows(companiesRes.rows, companyRowToModel),
      fieldDefs,
      truncated: collectTruncations(
        contactsRes.truncation,
        companiesRes.truncation,
        defsRes.error ? null : defsRes.truncation,
      ),
    };
  },

  async createContact({ workspaceId, name, email, phone, title, companyId, status, notesInline }) {
    const data = await runRpc(
      supabaseClient.rpc("contacts_op_create", {
        p_workspace_id: workspaceId,
        p_name: name,
        p_email: email ?? null,
        p_phone: phone ?? null,
        p_title: title ?? null,
        p_company_id: companyId ?? null,
        p_status: status ?? "",
        p_notes_inline: notesInline ?? "",
      }),
    );
    return contactRowToModel(firstRow(data, "contacts_op_create"));
  },

  async setContactDetails({ workspaceId, contactId, patch }) {
    const data = await runRpc(
      supabaseClient.rpc("contacts_op_set_details", {
        p_workspace_id: workspaceId,
        p_contact_id: contactId,
        p_patch: patch,
      }),
    );
    return contactRowToModel(firstRow(data, "contacts_op_set_details"));
  },

  async setFavorite({ workspaceId, contactId, value }) {
    const data = await runRpc(
      supabaseClient.rpc("contacts_op_set_favorite", {
        p_workspace_id: workspaceId,
        p_contact_id: contactId,
        p_value: value,
      }),
    );
    return contactRowToModel(firstRow(data, "contacts_op_set_favorite"));
  },

  async setCompanyDetails({ workspaceId, companyId, patch }) {
    const data = await runRpc(
      supabaseClient.rpc("companies_op_set_details", {
        p_workspace_id: workspaceId,
        p_company_id: companyId,
        p_patch: patch,
      }),
    );
    return companyRowToModel(firstRow(data, "companies_op_set_details"));
  },

  async addFieldDef({ workspaceId, key, label, type, options, position }) {
    const data = await runRpc(
      supabaseClient.rpc("contacts_op_add_field_def", {
        p_workspace_id: workspaceId,
        p_key: key,
        p_label: label ?? key,
        p_type: type ?? "text",
        p_options: options ?? [],
        p_position: position ?? 0,
      }),
    );
    return contactFieldDefRowToModel(firstRow(data, "contacts_op_add_field_def"));
  },

  async deleteFieldDef({ workspaceId, fieldId }) {
    await runRpc(
      supabaseClient.rpc("contacts_op_delete_field_def", {
        p_workspace_id: workspaceId,
        p_field_id: fieldId,
      }),
    );
  },

  async updateContact({
    workspaceId,
    contactId,
    name,
    email,
    phone,
    title,
    notesInline,
    setCompany,
  }) {
    const data = await runRpc(
      supabaseClient.rpc("contacts_op_update", {
        p_workspace_id: workspaceId,
        p_contact_id: contactId,
        p_name: name ?? null,
        p_email: email ?? null,
        p_phone: phone ?? null,
        p_title: title ?? null,
        p_notes_inline: notesInline ?? null,
        p_set_company: setCompany !== undefined,
        p_company_id: setCompany?.companyId ?? null,
      }),
    );
    return contactRowToModel(firstRow(data, "contacts_op_update"));
  },

  async setStatus({ workspaceId, contactId, status }) {
    const data = await runRpc(
      supabaseClient.rpc("contacts_op_set_status", {
        p_workspace_id: workspaceId,
        p_contact_id: contactId,
        p_status: status,
      }),
    );
    return contactRowToModel(firstRow(data, "contacts_op_set_status"));
  },

  async createCompany({ workspaceId, name, domains, website, notesInline }) {
    const data = await runRpc(
      supabaseClient.rpc("companies_op_create", {
        p_workspace_id: workspaceId,
        p_name: name,
        p_domains: domains ?? [],
        p_website: website ?? null,
        p_notes_inline: notesInline ?? "",
      }),
    );
    return companyRowToModel(firstRow(data, "companies_op_create"));
  },

  async updateCompany({ workspaceId, companyId, name, domains, website, notesInline }) {
    const data = await runRpc(
      supabaseClient.rpc("companies_op_update", {
        p_workspace_id: workspaceId,
        p_company_id: companyId,
        p_name: name ?? null,
        p_domains: domains ?? null,
        p_website: website ?? null,
        p_notes_inline: notesInline ?? null,
      }),
    );
    return companyRowToModel(firstRow(data, "companies_op_update"));
  },

  async link({
    workspaceId,
    contact,
    target,
    relationKind,
    origin,
    contactLabel,
    targetLabel,
    targetIcon,
  }) {
    const data = await runRpc(
      supabaseClient.rpc("contacts_op_link", {
        p_workspace_id: workspaceId,
        p_contact_type: contact.type,
        p_contact_id: contact.id,
        p_target_type: target.type,
        p_target_id: target.id,
        p_relation_kind: relationKind ?? "references",
        p_origin: origin ?? "manual",
        p_contact_label: contactLabel ?? null,
        p_target_label: targetLabel ?? null,
        p_target_icon: targetIcon ?? null,
      }),
    );
    return entityLinkRowToModel(firstRow(data, "contacts_op_link"));
  },

  async unlink({ workspaceId, linkId }) {
    const data = await runRpc(
      supabaseClient.rpc("contacts_op_unlink", {
        p_workspace_id: workspaceId,
        p_link_id: linkId,
      }),
    );
    const row = Array.isArray(data) ? data[0] : data;
    return row?.id ? entityLinkRowToModel(row) : null;
  },

  async deleteContact({ workspaceId, contactId }) {
    const data = await runRpc(
      supabaseClient.rpc("contacts_op_delete", {
        p_workspace_id: workspaceId,
        p_contact_id: contactId,
      }),
    );
    return contactRowToModel(firstRow(data, "contacts_op_delete"));
  },

  async restoreContact({ workspaceId, contactId }) {
    const data = await runRpc(
      supabaseClient.rpc("contacts_op_restore", {
        p_workspace_id: workspaceId,
        p_contact_id: contactId,
      }),
    );
    return contactRowToModel(firstRow(data, "contacts_op_restore"));
  },

  async deleteCompany({ workspaceId, companyId }) {
    const data = await runRpc(
      supabaseClient.rpc("companies_op_delete", {
        p_workspace_id: workspaceId,
        p_company_id: companyId,
      }),
    );
    return companyRowToModel(firstRow(data, "companies_op_delete"));
  },

  async importContacts({ workspaceId, rows }) {
    const data = await runRpc(
      supabaseClient.rpc("contacts_op_import", {
        p_workspace_id: workspaceId,
        p_rows: rows,
      }),
    );
    const r = (data ?? {}) as {
      created?: number;
      merged?: number;
      created_ids?: string[];
      merged_ids?: string[];
    };
    return {
      created: r.created ?? 0,
      merged: r.merged ?? 0,
      createdIds: r.created_ids ?? [],
      mergedIds: r.merged_ids ?? [],
    };
  },

  async needsAttention({ workspaceId }) {
    const data = await runQuery(
      supabaseClient
        .from("contacts")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null),
    );
    const contacts = mapKnownRows(data, contactRowToModel);
    const overdue = await loadOverdueFollowups(workspaceId);
    return selectNeedsAttention({ contacts, overdue, now: new Date() });
  },

  async reconnect({ workspaceId }) {
    const data = await runQuery(
      supabaseClient
        .from("contacts")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null),
    );
    const contacts = mapKnownRows(data, contactRowToModel);
    // Last-touch proxy = the contact's updated_at (the cheap signal; CO-2 deferral).
    const lastTouch: Record<string, string | null> = {};
    for (const c of contacts) lastTouch[c.id] = c.updatedAt;
    return selectReconnect({
      contacts,
      lastTouchByContactId: lastTouch,
      now: new Date(),
      limit: 6,
      minDays: 30,
    });
  },
};
