/**
 * Edge Function: notes-public — the JSON data API for a published note
 * (Wave-3 NO-9 / NO-9b; specs/notes.md assumption 8, revised).
 *
 * Returns a published note + the live sub-notes that inherit its sharing, as
 * JSON, by token. The `/p/<token>` public SPA route renders `body_md`
 * client-side (Supabase can't serve HTML from an edge function — a GET
 * returning text/html is rewritten to text/plain; see gotchas). There is NO RLS
 * hole: this calls the service-role-only `notes_public_subtree(token)`, which
 * reads only a published, live root by its token and the sub-notes that follow
 * its sharing — the token IS the capability. Handling lives in ./handler.ts.
 *
 * GET /notes-public?token=<publish_token>
 *   200 → { rootId, notes: [{ id, parentId, title, icon, bodyMd, position, createdAt }] }
 *   404 → { error: "not_found" }   (unknown / revoked token, trashed/archived root)
 *   503 → { error: "unavailable" } (the read failed; nothing is shown)
 * Deploy with verify_jwt = false — the endpoint is public by design.
 */

import { getDefaultSecretKey } from "../_shared/secret-keys.ts";
import { serviceRpc } from "../_shared/service-rpc.ts";
import { handleNotesPublic } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const DEFAULT_SECRET_KEY = getDefaultSecretKey();

Deno.serve((req: Request) =>
  handleNotesPublic(req, {
    rpc: (fn, args) => serviceRpc({ baseUrl: SUPABASE_URL, key: DEFAULT_SECRET_KEY }, fn, args),
    onError: (error) => console.error("[notes-public] subtree read failed:", error),
  }),
);
