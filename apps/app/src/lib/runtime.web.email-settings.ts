/** The web runtime's mail settings items (MR-7, specs/mail-rebuild.md decision 16):
 *  owner-scoped rows read through RLS, written through two ops. Identical on desktop. */

import { normalizeEmailSettingsKind } from "@contracts/vocabularies";

import { readPaged } from "./paged-select";
import { DbError, runRpc, untypedDb } from "./runtime.db";
import type { EmailRuntime, EmailSettingsItem } from "./runtime.types.email";
import { supabaseClient } from "./runtime.web.client";

// The table and ops aren't in the generated Database types until the migration reaches prod.
const db = () => untypedDb(supabaseClient);

type Row = {
  id: string;
  kind: string;
  position: number | null;
  value: unknown;
  updated_at: string;
  deleted_at: string | null;
};

/** A row a newer build wrote with a kind this build doesn't know reads as null (skipped). */
export function emailSettingsRowToItem(raw: unknown): EmailSettingsItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Row;
  const kind = normalizeEmailSettingsKind(r.kind);
  if (!kind || typeof r.id !== "string" || typeof r.updated_at !== "string") return null;
  const value =
    r.value && typeof r.value === "object" && !Array.isArray(r.value)
      ? (r.value as Record<string, unknown>)
      : {};
  return {
    id: r.id,
    kind,
    position: typeof r.position === "number" ? r.position : 0,
    value,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

const COLUMNS = "id, kind, position, value, updated_at, deleted_at";

export const webEmailSettings: Pick<
  EmailRuntime,
  "listSettings" | "upsertSetting" | "deleteSetting"
> = {
  async listSettings(input) {
    const read = await readPaged<unknown, { message: string; code?: string }>({
      scope: "mail settings",
      cap: 5000,
      keyOf: (r) => (r as Row).id,
      page: async (offset, limit) => {
        let q = db().from("email_settings_items").select(COLUMNS);
        q = input?.since ? q.gt("updated_at", input.since) : q.is("deleted_at", null);
        const res = await q
          .order("updated_at")
          .order("id")
          .range(offset, offset + limit - 1);
        return { data: (res.data as unknown[] | null) ?? null, error: res.error };
      },
    });
    if (read.error) throw new DbError(read.error);
    const rows = read.rows;
    return rows.map(emailSettingsRowToItem).filter((x): x is EmailSettingsItem => !!x);
  },
  async upsertSetting({ id, kind, value, position }) {
    const data = await runRpc(
      db().rpc("email_op_settings_upsert", {
        p_id: id,
        p_kind: kind,
        p_value: value,
        p_position: position ?? null,
      }),
    );
    const item = emailSettingsRowToItem(Array.isArray(data) ? data[0] : data);
    if (!item) throw new Error("email_op_settings_upsert returned no row");
    return item;
  },
  async deleteSetting({ id }) {
    const data = await runRpc(db().rpc("email_op_settings_delete", { p_id: id }));
    return data === true;
  },
};
