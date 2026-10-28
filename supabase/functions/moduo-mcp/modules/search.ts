/**
 * Global search for agents (GS-7, specs/global-search.md AC11, Q18): one
 * `search` tool over `search_all`, the rows ⌘K shows, for what the key may see.
 *
 * Connector-side mirror of the spine manifest's `search.all` read
 * (src/features/spine/ops-manifest.ts). `search_all` resolves the key itself:
 * the service-role client carries x-moduo-key-id, so perm_actor_id() is the
 * key's person and each module function applies the key's scope on that
 * module before its limit. The tool knows no types: whatever modules
 * `search_all` merges, their rows come through, and a row whose module the key
 * can't view is dropped here as well (MCP_ENTITY_TYPE_MODULES; a type no module
 * owns is out of reach for every key, as for links).
 *
 * Not a module with a key scope of its own: any key with View on a searchable
 * module lists it.
 */

import { appOrigin } from "../../_shared/app-origin.ts";
import { keyCanSeeEntityType, keyVisibleEntityTypes } from "../../_shared/contracts/mcp-key-scopes.ts";
import type { ConnectorModule } from "../registry.ts";
import { clampLimit, str } from "../tasks-helpers.ts";

type Row = Record<string, any>;

/** U+E000 / U+E001 around a match in a SearchHit snippet; agents read **bold**. */
const SNIPPET_MARKS = /[]/g;

/** The web app's origin: the APP_URL secret when it is one of ours, else app.moduo.app. */
function webOrigin(): string {
  const deno = (globalThis as { Deno?: { env: { get(name: string): string | undefined } } }).Deno;
  return appOrigin(deno?.env.get("APP_URL"));
}

/**
 * Where an item opens in the web app: the routes and search params of the
 * app's entity-open map (apps/app/src/lib/entity-open.ts, which Deno can't
 * import). Null for a type the app opens no other way yet (a chat message).
 */
function openPath(type: string, id: string): string | null {
  const q = encodeURIComponent(id);
  switch (type) {
    case "note":
      return `/notes?id=${q}`;
    case "task":
    case "bucket":
    case "project":
      return `/tasks?id=${q}`;
    case "contact":
    case "company":
      return `/contacts?type=${type}&id=${q}`;
    case "event":
      return `/calendar?event=${q}`;
    case "email_thread":
      return `/email?thread=${q}`;
    case "chat_channel":
      return `/chat?c=${q}`;
    default:
      return null;
  }
}

export const searchConnectorModule: ConnectorModule = {
  module: "search",
  keyAccess: {
    allows: (key) => keyVisibleEntityTypes(key.scopes).length > 0,
    needs: "View on at least one module it searches",
  },
  tools: [
    {
      name: "search",
      description:
        "Search everything you can open in Moduo at once, best first: the same results as the app's ⌘K for this key (words in any order, word-starts, accents ignored; quotes for a phrase, -word to exclude). Each result has its type, id, title, where it lives, a snippet with the match in **bold** when the match is in the text, whether it is archived, and a link that opens it in the app. Use a module's own tools to read or change what you find.",
      access: "view",
      hints: "read",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query." },
          types: {
            type: "array",
            items: { type: "string" },
            description: "Only these result types, e.g. [\"note\", \"task\"] (optional; default every type the key can see).",
          },
          limit: { type: "number", description: "Max results (default 20, max 50)." },
        },
        required: ["query"],
      },
      handler: async (args, ctx) => {
        const limit = clampLimit(args, 20, 50);
        const types = Array.isArray(args.types) ? args.types.filter((t): t is string => typeof t === "string") : [];
        // A key has no item open, so no context boost (search_all ignores one for keys anyway).
        const { data, error } = await ctx.db.rpc("search_all", {
          p_workspace_id: ctx.key.workspaceId,
          p_query: str(args, "query"),
          p_types: types.length ? types : null,
          p_limit_per_type: limit,
          p_context_type: null,
          p_context_id: null,
        });
        if (error) throw new Error(error.message);
        const origin = webOrigin();
        return ((data ?? []) as Row[])
          .filter((h) => typeof h.entity_type === "string" && keyCanSeeEntityType(ctx.key.scopes, h.entity_type))
          .slice(0, limit)
          .map((h) => {
            const path = openPath(h.entity_type, String(h.entity_id));
            return {
              type: h.entity_type,
              id: h.entity_id,
              title: String(h.title ?? "").trim() || "Untitled",
              context: h.context ?? null,
              snippet: typeof h.snippet === "string" ? h.snippet.replace(SNIPPET_MARKS, "**") : null,
              archived: h.archived === true,
              url: path ? `${origin}${path}` : null,
            };
          });
      },
    },
  ],
};
