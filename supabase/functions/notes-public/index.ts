/**
 * Edge Function: notes-public — the JSON data API for a published note
 * (Wave-3 NO-9 / NO-9b; specs/notes.md assumption 8, revised).
 *
 * Returns a published note + its live descendant pages as JSON, by token. The
 * `/p/<token>` public SPA route renders `body_md` client-side (Supabase can't
 * serve HTML from an edge function — a GET returning text/html is rewritten to
 * text/plain; see gotchas). There is NO RLS hole: this runs as service_role and
 * only ever reads rows scoped to `published_at IS NOT NULL` + a matching
 * `publish_token` + not-deleted + not-archived — the token IS the capability.
 *
 * GET /notes-public?token=<publish_token>
 *   200 → { rootId, notes: [{ id, parentId, title, icon, bodyMd }] }  (the subtree)
 *   404 → { error: "not_found" }   (unknown / revoked token, trashed/archived root)
 * Deploy with verify_jwt = false — the endpoint is public by design.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import { getDefaultSecretKey } from "../_shared/secret-keys.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const DEFAULT_SECRET_KEY = getDefaultSecretKey();

const MAX_DEPTH = 100;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type NoteRow = {
  id: string;
  parent_id: string | null;
  title: string | null;
  icon: string | null;
  body_md: string | null;
  position: string | null;
  created_at: string | null;
  is_archived: boolean | null;
  deleted_at: string | null;
  published_at: string | null;
  publish_token: string | null;
};

/** Task lines export a `<!-- moduo:task:<id> -->` stable-id comment; those ids
 * are internal pointers, meaningless (and leaky) to an anonymous visitor.
 * Scrub them at the trust boundary so NO public consumer ever sees them (the
 * client keeps its own strip only as a pre-deploy graceful-degrade guard). */
function stripTaskIdComments(md: string): string {
  return md.replace(/\s*<!--\s*moduo:task:[A-Za-z0-9-]+\s*-->/g, "");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=30" },
  });
}

function notFound(): Response {
  return json({ error: "not_found" }, 404);
}

function subtreeIds(rootId: string, byParent: Map<string | null, NoteRow[]>): Set<string> {
  const out = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (out.has(id) || depth > MAX_DEPTH) return;
    out.add(id);
    for (const child of byParent.get(id) ?? []) walk(child.id, depth + 1);
  };
  walk(rootId, 0);
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  const token = new URL(req.url).searchParams.get("token")?.trim() ?? "";
  if (!token) return notFound();

  const db = createClient(SUPABASE_URL, DEFAULT_SECRET_KEY, { auth: { persistSession: false } });

  // Resolve the published ROOT by token (the capability). A revoked token
  // (publish_token cleared) or an archived/trashed root finds nothing.
  const rootRes = await db
    .from("notes")
    .select("id, parent_id, title, icon, body_md, position, created_at, is_archived, deleted_at, published_at, publish_token, workspace_id")
    .eq("publish_token", token)
    .not("published_at", "is", null)
    .is("deleted_at", null)
    .not("is_archived", "is", true)
    .maybeSingle();
  if (rootRes.error || !rootRes.data) return notFound();
  const root = rootRes.data as NoteRow & { workspace_id: string };

  // Fetch the workspace's live, non-archived notes and re-root at the published
  // note, so only its subtree is exposed.
  const allRes = await db
    .from("notes")
    .select("id, parent_id, title, icon, body_md, position, created_at, is_archived, deleted_at")
    .eq("workspace_id", root.workspace_id)
    .is("deleted_at", null);
  const all = (allRes.error ? [] : ((allRes.data as NoteRow[]) ?? [])).filter((n) => !n.is_archived);
  if (!all.some((n) => n.id === root.id)) all.push(root);

  const byId = new Map(all.map((n) => [n.id, n]));
  const byParent = new Map<string | null, NoteRow[]>();
  for (const n of all) {
    const key = n.parent_id && byId.has(n.parent_id) ? n.parent_id : null;
    (byParent.get(key) ?? byParent.set(key, []).get(key)!).push(n);
  }

  const inScope = subtreeIds(root.id, byParent);
  const notes = all
    .filter((n) => inScope.has(n.id))
    .map((n) => ({
      id: n.id,
      parentId: n.parent_id && inScope.has(n.parent_id) ? n.parent_id : null,
      title: n.title ?? "",
      icon: n.icon ?? null,
      bodyMd: stripTaskIdComments(n.body_md ?? ""),
      // Authored sibling order (DF-13) — the client sorts nav by (position,
      // createdAt) to mirror the in-app tree exactly.
      position: n.position ?? "",
      createdAt: n.created_at ?? "",
    }));

  return json({ rootId: root.id, notes });
});
