/**
 * notes-public's request handling, as plain TypeScript so the tests run it.
 *
 * The published tree comes from `notes_public_subtree(token)` (migration
 * 20261020120000): the root plus only the sub-notes that inherit its sharing,
 * the chain can_access walks. A sub-note with its own sharing never reaches an
 * anonymous visitor through its parent's link.
 */

import { notesPublicTokenSchema } from "../_shared/contracts/http-bodies.ts";
import { parseOrError } from "../_shared/contracts/errors.ts";

/** The server function that answers a published tree (service role only). */
export const SUBTREE_RPC = "notes_public_subtree";

export type PublicNote = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  bodyMd: string;
  position: string;
  createdAt: string;
};

export type PublicTree = { rootId: string; notes: PublicNote[] };

export type NotesPublicDeps = {
  /** Runs `public.<fn>(args)` with the service role and returns its JSON result; throws on failure. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  onError?: (error: unknown) => void;
};

export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Task lines export a `<!-- moduo:task:<id> -->` stable-id comment; those ids
 * are internal pointers, meaningless (and leaky) to an anonymous visitor.
 * Scrub them at the trust boundary so NO public consumer ever sees them (the
 * client keeps its own strip only as a pre-deploy graceful-degrade guard). */
export function stripTaskIdComments(md: string): string {
  return md.replace(/\s*<!--\s*moduo:task:[A-Za-z0-9-]+\s*-->/g, "");
}

function json(body: unknown, status = 200, cache = true): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache ? "public, max-age=30" : "no-store",
    },
  });
}

function notFound(): Response {
  return json({ error: "not_found" }, 404);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toTree(raw: unknown): PublicTree | null {
  if (!raw || typeof raw !== "object") return null;
  const { rootId, notes } = raw as { rootId?: unknown; notes?: unknown };
  if (typeof rootId !== "string" || !Array.isArray(notes)) return null;
  return {
    rootId,
    notes: notes
      .filter((n): n is Record<string, unknown> => !!n && typeof n === "object" && typeof n.id === "string")
      .map((n) => ({
        id: n.id as string,
        parentId: typeof n.parentId === "string" ? n.parentId : null,
        title: str(n.title),
        icon: typeof n.icon === "string" ? n.icon : null,
        bodyMd: stripTaskIdComments(str(n.bodyMd)),
        // Authored sibling order (DF-13): the client sorts nav by (position,
        // createdAt) to mirror the in-app tree exactly.
        position: str(n.position),
        createdAt: str(n.createdAt),
      })),
  };
}

export async function handleNotesPublic(req: Request, deps: NotesPublicDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  const tokenParsed = parseOrError(notesPublicTokenSchema, new URL(req.url).searchParams.get("token")?.trim() ?? "");
  if (!tokenParsed.success) return notFound();

  let raw: unknown;
  try {
    raw = await deps.rpc(SUBTREE_RPC, { p_token: tokenParsed.data });
  } catch (error) {
    // Fail closed: never fall back to a wider read.
    deps.onError?.(error);
    return json({ error: "unavailable" }, 503, false);
  }
  // NULL: an unknown or revoked token, or a trashed/archived root.
  const tree = toTree(raw);
  return tree ? json(tree) : notFound();
}
