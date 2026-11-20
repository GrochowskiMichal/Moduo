// GS-9 — Email in the ⌘K palette (specs/global-search.md AC12, Assumption 15,
// Q17, Q17b). Pure: unit-tested in search-palette.test.ts.
//
// The inbox never leaves the desktop (EM-3), so mail isn't on `search_all`
// except the threads deliberately pulled into Moduo (`email_refs`, owner-only).
// On desktop the rebuilt engine's search (`use-palette-engine-mail`) adds this
// device's own mail to the Email group here, in the client. On web nothing is
// added.

import type { SearchAllRow } from "@contracts/search";

const MAIL_TYPES = new Set(["email_thread", "email"]);
/** The most a group counts ("Show all 50+"), as the server caps `type_total`. */
const TOTAL_CAP = 50;

const isMail = (row: SearchAllRow) => MAIL_TYPES.has(row.entity_type);
const timeOf = (row: SearchAllRow) => {
  const ms = Date.parse(row.updated_at);
  return Number.isNaN(ms) ? 0 : ms;
};

/**
 * The server's answer with this device's mail folded into its Email group.
 * `local` null (web) returns the server's rows untouched. Otherwise the Email
 * rows are this device's and the server's pulled-in threads, one row per
 * thread (this device's copy wins, keeping the server's Top mark), newest
 * first, after every other row; each counts the group's total for "Show all N",
 * the server's unsent matches included.
 */
export function mergeMailRows(
  server: readonly SearchAllRow[],
  local: readonly SearchAllRow[] | null,
): SearchAllRow[] {
  if (local === null) return [...server];
  const others = server.filter((r) => !isMail(r));
  const serverMail = server.filter(isMail);
  const serverById = new Map(serverMail.map((r) => [r.entity_id, r] as const));
  const localIds = new Set(local.map((r) => r.entity_id));
  const mail = [
    ...local.map((r) => (serverById.get(r.entity_id)?.top ? { ...r, top: true } : r)),
    ...serverMail.filter((r) => !localIds.has(r.entity_id)),
  ].sort((a, b) => timeOf(b) - timeOf(a));
  const serverTotal = serverMail.reduce((n, r) => Math.max(n, r.type_total), 0);
  const unsent = Math.max(0, serverTotal - serverMail.length);
  const total = Math.min(TOTAL_CAP, mail.length + unsent);
  return [
    ...others,
    ...mail.map((r) => ({ ...r, entity_type: "email_thread", type_total: total })),
  ];
}
