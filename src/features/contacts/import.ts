// Contacts CSV import — the pure brain (block CO-3, specs/contacts.md AC6).
//
// "The adoption gate": a directory that lands populated, never a blank canvas.
// This module is the testable, side-effect-free core the dialog drives:
//   1. parseCsv        — a small, dependency-free RFC-4180-ish parser
//   2. guessColumnMapping — heuristic header → field mapping (user can correct)
//   3. buildImportRows — apply the mapping → ParsedContact per data row
//   4. planImport      — dedupe (email FIRST, then name+company) → a previewable
//      plan of create / merge / duplicate / error, NEVER a silent merge or dup
//   5. toImportPayload — the confirmed, deduped rows handed to contacts_op_import
//
// The dedupe + preview is the whole point of AC6: spreadsheets rot when an import
// silently merges or duplicates, so every row's fate is shown before the user
// confirms (decision 6). Name-less rows are previewed as errors and skipped.
//
// Pure + relative imports only (no `@/lib/*` value imports) so it stays in the
// vitest graph (docs/gotchas.md). The op is the single write; this is its plan.

import type { Company, Contact } from "./model";
import { normalizeContactStatus } from "./status";

// ── Column mapping ────────────────────────────────────────────────────────────

/** A CSV column maps to one contact field, a name part, or is ignored. */
export type ImportField =
  | "name"
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "title"
  | "company"
  | "status"
  | "ignore";

/** The pickable targets in the column-map step (order = display order). */
export const IMPORT_FIELDS: { value: ImportField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "title", label: "Title" },
  { value: "company", label: "Company" },
  { value: "status", label: "Status" },
  { value: "ignore", label: "Don’t import" },
];

// ── CSV parsing ───────────────────────────────────────────────────────────────

/** Candidate field delimiters, in preference order on a tie. */
const DELIMITERS = [",", ";", "\t", "|"] as const;

/**
 * Sniff the field delimiter from the header line — Excel and many European
 * locales export semicolon- (or tab-) delimited CSV, not comma. Counts each
 * candidate outside quotes on the first line and picks the most frequent;
 * defaults to comma when there's no delimiter (a single-column file).
 */
export function detectDelimiter(text: string): string {
  let firstLine = text;
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') q = !q;
    else if (c === "\n" && !q) {
      firstLine = text.slice(0, i);
      break;
    }
  }
  let best = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    let count = 0;
    let inQ = false;
    for (let i = 0; i < firstLine.length; i += 1) {
      const c = firstLine[i];
      if (c === '"') inQ = !inQ;
      else if (c === d && !inQ) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/**
 * Parse CSV text into a header row + data rows. Auto-detects the field delimiter
 * (comma / semicolon / tab / pipe), and handles quoted fields with embedded
 * delimiters / newlines and escaped `""` quotes, `\r\n` or `\n` line endings,
 * and a leading BOM. Fully-blank lines are dropped. No external dependency — a
 * CSV import shouldn't pull a parser lib into the bundle.
 */
export function parseCsv(input: string, delimiter?: string): { headers: string[]; rows: string[][] } {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const delim = delimiter ?? detectDelimiter(text);

  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delim) {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      endRecord();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Flush a trailing field/record when the file doesn't end in a newline.
  if (field !== "" || record.length > 0) endRecord();

  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ""));
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim());
  return { headers, rows: nonEmpty };
}

/** Collapse a header to comparable form: lowercase, alphanumerics only. */
function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Checked in priority order so compound headers resolve correctly:
// "company name" → company (not name), "first name" → firstName (not name).
const HEADER_RULES: { field: ImportField; match: (h: string) => boolean }[] = [
  { field: "email", match: (h) => h.includes("email") || h === "mail" },
  { field: "firstName", match: (h) => h.includes("firstname") || h.includes("givenname") || h === "first" },
  { field: "lastName", match: (h) => h.includes("lastname") || h.includes("surname") || h.includes("familyname") || h === "last" },
  { field: "phone", match: (h) => h.includes("phone") || h.includes("mobile") || h.includes("cell") || h === "tel" || h.includes("telephone") },
  { field: "company", match: (h) => h.includes("company") || h.includes("organization") || h.includes("organisation") || h.includes("employer") || h.includes("account") || h === "org" },
  { field: "title", match: (h) => h.includes("jobtitle") || h.includes("title") || h.includes("role") || h.includes("position") || h === "job" },
  { field: "status", match: (h) => h.includes("status") || h.includes("stage") },
  { field: "name", match: (h) => h.includes("fullname") || h.includes("displayname") || h.includes("name") || h.includes("contact") },
];

/** Best-guess a target field for every header; unrecognized → "ignore". */
export function guessColumnMapping(headers: string[]): ImportField[] {
  return headers.map((raw) => {
    const h = normHeader(raw);
    if (!h) return "ignore";
    for (const rule of HEADER_RULES) if (rule.match(h)) return rule.field;
    return "ignore";
  });
}

// ── Row extraction ────────────────────────────────────────────────────────────

/** A contact extracted from one CSV row via the column mapping. */
export type ParsedContact = {
  /** 0-based index into the data rows (excludes the header), for stable preview keys. */
  rowIndex: number;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  company: string | null;
  /** Raw status text as it appeared; normalized only in the payload. */
  status: string | null;
};

function firstNonEmpty(values: string[]): string | null {
  for (const v of values) {
    const t = v.trim();
    if (t) return t;
  }
  return null;
}

/**
 * Apply a column mapping to the data rows. When multiple columns map to the same
 * field the first non-empty wins; an explicit `name` column beats `firstName` +
 * `lastName`, which are otherwise joined. Trims everything.
 */
export function buildImportRows(
  headers: string[],
  rows: string[][],
  mapping: ImportField[],
): ParsedContact[] {
  const cols = (field: ImportField) =>
    mapping.map((m, idx) => (m === field ? idx : -1)).filter((idx) => idx >= 0);

  const idxName = cols("name");
  const idxFirst = cols("firstName");
  const idxLast = cols("lastName");
  const idxEmail = cols("email");
  const idxPhone = cols("phone");
  const idxTitle = cols("title");
  const idxCompany = cols("company");
  const idxStatus = cols("status");

  const pick = (row: string[], idxs: number[]) => firstNonEmpty(idxs.map((i) => row[i] ?? ""));

  return rows.map((row, rowIndex) => {
    let name = pick(row, idxName);
    if (!name) {
      const first = pick(row, idxFirst) ?? "";
      const last = pick(row, idxLast) ?? "";
      name = [first, last].filter(Boolean).join(" ") || null;
    }
    return {
      rowIndex,
      name: name ?? "",
      email: pick(row, idxEmail),
      phone: pick(row, idxPhone),
      title: pick(row, idxTitle),
      company: pick(row, idxCompany),
      status: pick(row, idxStatus),
    };
  });
}

// ── Dedupe + plan ─────────────────────────────────────────────────────────────

/**
 * What will happen to a parsed row on import:
 * - `create`    — a new contact
 * - `merge`     — matches an existing contact (its gaps get filled)
 * - `duplicate` — matches an earlier row in this same file (skipped)
 * - `error`     — unimportable (missing name) — skipped
 */
export type ImportAction = "create" | "merge" | "duplicate" | "error";

/** Why a row was matched (for the quiet preview reason text). */
export type MatchReason = "email" | "name+company";

export type ImportPlanEntry = ParsedContact & {
  action: ImportAction;
  /** Set when `action === "merge"`: the existing contact this fills. */
  matchedContactId?: string;
  /** Set for merge/duplicate. */
  reason?: MatchReason;
  /** Set when `action === "error"`. */
  error?: string;
};

export type ImportPlanSummary = {
  create: number;
  merge: number;
  duplicate: number;
  error: number;
  total: number;
};

export type ImportPlan = {
  entries: ImportPlanEntry[];
  summary: ImportPlanSummary;
};

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
function normEmail(s: string | null): string | null {
  const t = (s ?? "").trim().toLowerCase();
  return t || null;
}
function nameCompanyKey(name: string, company: string | null): string {
  return `${normName(name)} ${normName(company ?? "")}`;
}

/**
 * Build the previewable import plan. Dedupe order is **email first, then
 * normalized name+company** (decision 6) — against existing contacts AND against
 * earlier rows in the same file. Nothing is ever silently merged or duplicated:
 * every row carries an explicit action the dialog renders before the user
 * confirms.
 */
export function planImport(
  rows: ParsedContact[],
  existingContacts: Contact[],
  existingCompanies: Company[],
): ImportPlan {
  const companyNameById = new Map(existingCompanies.map((c) => [c.id, c.name]));

  // Existing-contact indexes.
  const byEmail = new Map<string, string>();
  const byNameCompany = new Map<string, string>();
  for (const c of existingContacts) {
    for (const e of [c.email, ...c.emails.map((x) => x.value)]) {
      const ne = normEmail(e);
      if (ne && !byEmail.has(ne)) byEmail.set(ne, c.id);
    }
    const key = nameCompanyKey(c.name, companyNameById.get(c.companyId ?? "") ?? null);
    if (!byNameCompany.has(key)) byNameCompany.set(key, c.id);
  }

  // Within-file seen sets (only rows we decide to create count as "seen").
  const seenEmail = new Set<string>();
  const seenNameCompany = new Set<string>();

  const entries: ImportPlanEntry[] = rows.map((row) => {
    if (!row.name.trim()) {
      return { ...row, action: "error", error: "Missing name" };
    }
    const email = normEmail(row.email);
    const key = nameCompanyKey(row.name, row.company);
    const emailSeen = Boolean(email && seenEmail.has(email));

    // Remember this row's keys so any LATER row with the same email or
    // name+company is flagged a duplicate — whether this row creates OR merges.
    // (A second row pointing at the same existing contact must preview as a
    // duplicate, never a second merge — else we'd double-write + double-count.)
    const remember = () => {
      if (email) seenEmail.add(email);
      seenNameCompany.add(key);
    };

    // 1. Duplicate of an earlier row in this same file (email first, then key).
    if (emailSeen || seenNameCompany.has(key)) {
      return { ...row, action: "duplicate", reason: emailSeen ? "email" : "name+company" };
    }
    // 2. Existing-contact match (email first, then name+company).
    if (email && byEmail.has(email)) {
      remember();
      return { ...row, action: "merge", matchedContactId: byEmail.get(email), reason: "email" };
    }
    if (byNameCompany.has(key)) {
      remember();
      return { ...row, action: "merge", matchedContactId: byNameCompany.get(key), reason: "name+company" };
    }
    // 3. A brand-new contact.
    remember();
    return { ...row, action: "create" };
  });

  const summary: ImportPlanSummary = {
    create: entries.filter((e) => e.action === "create").length,
    merge: entries.filter((e) => e.action === "merge").length,
    duplicate: entries.filter((e) => e.action === "duplicate").length,
    error: entries.filter((e) => e.action === "error").length,
    total: entries.length,
  };
  return { entries, summary };
}

// ── Payload for the op ────────────────────────────────────────────────────────

/** One row handed to `contacts_op_import` (camelCase keys; mirrors the SQL reads). */
export type ContactImportRow = {
  op: "create" | "merge";
  /** Set only for `op === "merge"`. */
  contactId?: string;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  /** Company name; the op resolves-or-creates the company by name. */
  company: string | null;
  /** Normalized status id, or null to let the op default to "lead". */
  status: string | null;
};

/** What `contacts_op_import` returns (counts + the new/affected ids). */
export type ContactImportResult = {
  created: number;
  merged: number;
  createdIds: string[];
  mergedIds: string[];
};

/**
 * The confirmed, deduped rows to actually write: every `create` and every
 * `merge` (into an existing contact). `duplicate` and `error` rows are dropped —
 * the user already saw them in the preview.
 */
export function toImportPayload(plan: ImportPlan): ContactImportRow[] {
  const out: ContactImportRow[] = [];
  for (const e of plan.entries) {
    if (e.action === "create") {
      out.push({
        op: "create",
        name: e.name,
        email: e.email,
        phone: e.phone,
        title: e.title,
        company: e.company,
        status: e.status ? normalizeContactStatus(e.status) : null,
      });
    } else if (e.action === "merge" && e.matchedContactId) {
      out.push({
        op: "merge",
        contactId: e.matchedContactId,
        name: e.name,
        email: e.email,
        phone: e.phone,
        title: e.title,
        company: e.company,
        // The op fills only gaps and never changes an existing contact's status,
        // so a merge carries none.
        status: null,
      });
    }
  }
  return out;
}
