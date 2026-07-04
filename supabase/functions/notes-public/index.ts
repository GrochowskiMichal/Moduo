/**
 * Edge Function: notes-public — the public renderer for a published note
 * (Wave-3 NO-9, AC10; specs/notes.md assumption 8).
 *
 * A revocable, read-only public page for a note and its live descendant pages.
 * No app chrome, `noindex`, rendered from the derived `body_md` (the CRDT is
 * never parsed server-side). There is NO RLS hole: this function runs as
 * service_role and only ever reads rows scoped to `published_at IS NOT NULL`
 * with a matching `publish_token` — the token IS the capability.
 *
 * Routes (GET):
 *   /notes-public?token=<publish_token>            → the published root
 *   /notes-public?token=<publish_token>&note=<id>  → a page within its subtree
 * Any other note id, a revoked/unknown token, or a trashed/archived target 404s.
 *
 * Security: markdown → HTML via `marked` with raw-HTML ESCAPED and links
 * scheme-allow-listed (http/https/mailto only; `moduo://` chips render as plain
 * labels). Deploy with verify_jwt = false — the page is public by design.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";
import { Marked } from "https://esm.sh/marked@12?target=deno";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAX_DEPTH = 100;

type NoteRow = {
  id: string;
  parent_id: string | null;
  title: string | null;
  icon: string | null;
  body_md: string | null;
  is_archived: boolean | null;
  deleted_at: string | null;
  published_at: string | null;
  publish_token: string | null;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only http(s)/mailto survive; everything else (moduo://, javascript:, data:)
 * is refused — those are the XSS / broken-link vectors on a public page. */
function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^(https?:|mailto:)/i.test(h)) return h;
  return null;
}

/** A `marked` instance hardened for untrusted markdown: raw HTML is escaped
 * (never passed through) and links are scheme-allow-listed. */
function makeRenderer(): Marked {
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      // Block + inline raw HTML both flow here — escape so no tag reaches output.
      html(token: unknown) {
        const text = typeof token === "string" ? token : ((token as { text?: string })?.text ?? "");
        return escapeHtml(text);
      },
      link(token: { href?: string; title?: string | null; text?: string }) {
        const href = safeHref(token.href ?? "");
        // Escaped label (no re-parse of inner tokens — keeps this renderer free
        // of `this.parser` binding, which matters on the untestable Deno path).
        const label = escapeHtml(token.text ?? "");
        if (!href) return label; // moduo:// chip → plain label
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        return `<a href="${escapeHtml(href)}"${title} rel="nofollow noopener noreferrer">${label}</a>`;
      },
      image(token: { href?: string; title?: string | null; text?: string }) {
        const href = safeHref(token.href ?? "");
        const alt = escapeHtml(token.text ?? "");
        if (!href) return alt;
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        return `<img src="${escapeHtml(href)}" alt="${alt}"${title} loading="lazy" />`;
      },
    },
  });
  return marked;
}

function displayTitle(title: string | null): string {
  const t = (title ?? "").trim();
  return t || "Untitled";
}

/** The live, non-archived subtree of `rootId` (root included), depth-first by
 * a stable id order (positions aren't needed for correctness, only nav order —
 * we sort by title then id for a deterministic list). */
function subtreeIds(rootId: string, byParent: Map<string | null, NoteRow[]>): string[] {
  const out: string[] = [];
  const walk = (id: string, depth: number) => {
    out.push(id);
    if (depth >= MAX_DEPTH) return;
    for (const child of byParent.get(id) ?? []) walk(child.id, depth + 1);
  };
  walk(rootId, 0);
  return out;
}

function page(opts: {
  title: string;
  bodyHtml: string;
  navHtml: string;
  status?: number;
}): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${escapeHtml(opts.title)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1c1c1e;
    background: #ffffff;
  }
  .wrap { display: flex; max-width: 1040px; margin: 0 auto; gap: 40px; padding: 48px 24px 120px; }
  nav { flex: 0 0 220px; position: sticky; top: 48px; align-self: flex-start; font-size: 14px; }
  nav .home { display: block; font-weight: 600; margin-bottom: 12px; color: #1c1c1e; text-decoration: none; }
  nav ul { list-style: none; margin: 0; padding: 0; }
  nav li { margin: 2px 0; }
  nav a { color: #6b7280; text-decoration: none; display: block; padding: 3px 0; }
  nav a:hover { color: #1c1c1e; }
  nav a.active { color: #1c1c1e; font-weight: 600; }
  main { flex: 1 1 auto; min-width: 0; }
  main h1, main h2, main h3 { line-height: 1.25; font-weight: 650; margin: 1.6em 0 0.5em; }
  main h1 { font-size: 2rem; margin-top: 0; }
  main h2 { font-size: 1.5rem; }
  main h3 { font-size: 1.2rem; }
  main p { margin: 0.7em 0; }
  main ul, main ol { padding-left: 1.4em; }
  main li { margin: 0.2em 0; }
  main a { color: #2563eb; }
  main code { background: rgba(0,0,0,0.06); padding: 0.15em 0.35em; border-radius: 4px; font-size: 0.9em; }
  main pre { background: rgba(0,0,0,0.05); padding: 14px 16px; border-radius: 8px; overflow-x: auto; }
  main pre code { background: none; padding: 0; }
  main blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid rgba(0,0,0,0.15); color: #4b5563; }
  main table { border-collapse: collapse; width: 100%; margin: 1em 0; display: block; overflow-x: auto; }
  main th, main td { border: 1px solid rgba(0,0,0,0.12); padding: 6px 10px; text-align: left; }
  main img { max-width: 100%; height: auto; border-radius: 8px; }
  main input[type="checkbox"] { margin-right: 6px; }
  .foot { margin-top: 64px; font-size: 13px; color: #9ca3af; }
  .foot a { color: #9ca3af; }
  @media (max-width: 720px) {
    .wrap { flex-direction: column; gap: 20px; padding: 28px 18px 80px; }
    nav { position: static; flex-basis: auto; }
  }
  @media (prefers-color-scheme: dark) {
    body { color: #e6e6ea; background: #111113; }
    nav .home, nav a.active { color: #e6e6ea; }
    nav a { color: #9ca3af; }
    main code { background: rgba(255,255,255,0.10); }
    main pre { background: rgba(255,255,255,0.06); }
    main a { color: #7aa2ff; }
    main blockquote { border-left-color: rgba(255,255,255,0.2); color: #9ca3af; }
    main th, main td { border-color: rgba(255,255,255,0.14); }
  }
</style>
</head>
<body>
<div class="wrap">
<nav>${opts.navHtml}</nav>
<main>
${opts.bodyHtml}
<div class="foot">Published with <a href="https://moduo.app" rel="nofollow noopener noreferrer">Moduo</a></div>
</main>
</div>
</body>
</html>`;
  return new Response(html, {
    status: opts.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "public, max-age=60",
    },
  });
}

function notFound(): Response {
  return page({
    title: "Not found",
    navHtml: "",
    bodyHtml: `<h1>Page not found</h1><p>This link is no longer available. It may have been unpublished.</p>`,
    status: 404,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  const url = new URL(req.url);
  const token = url.searchParams.get("token")?.trim() ?? "";
  const requested = url.searchParams.get("note")?.trim() || null;
  if (!token) return notFound();

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Resolve the published ROOT by token (the capability). Scoped hard to a
  // live, published row — a revoked token (publish_token cleared) finds nothing.
  const rootRes = await db
    .from("notes")
    .select("id, parent_id, title, icon, body_md, is_archived, deleted_at, published_at, publish_token, workspace_id")
    .eq("publish_token", token)
    .not("published_at", "is", null)
    .is("deleted_at", null)
    // Archiving clears the token server-side, so this rarely matters — but a
    // stale token on an archived root must never serve (archive = offline).
    .not("is_archived", "is", true)
    .maybeSingle();
  if (rootRes.error || !rootRes.data) return notFound();
  const root = rootRes.data as NoteRow & { workspace_id: string };

  // Fetch the workspace's live, non-archived notes to build the subtree.
  const allRes = await db
    .from("notes")
    .select("id, parent_id, title, icon, body_md, is_archived, deleted_at")
    .eq("workspace_id", root.workspace_id)
    .is("deleted_at", null);
  const all = (allRes.error ? [] : ((allRes.data as NoteRow[]) ?? [])).filter((n) => !n.is_archived);
  // The root is authoritative even if the bundle query hiccuped.
  if (!all.some((n) => n.id === root.id)) all.push(root);

  const byId = new Map(all.map((n) => [n.id, n]));
  const byParent = new Map<string | null, NoteRow[]>();
  for (const n of all) {
    // Re-root at the published root: only descendants reachable from it count;
    // a parent outside the subtree is treated as a root for grouping.
    const key = n.parent_id && byId.has(n.parent_id) ? n.parent_id : null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(n);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => displayTitle(a.title).localeCompare(displayTitle(b.title)) || (a.id < b.id ? -1 : 1));
  }

  const inScope = new Set(subtreeIds(root.id, byParent));

  // The target page = the root, or a requested descendant that IS in the subtree.
  const targetId = requested && inScope.has(requested) ? requested : root.id;
  if (requested && !inScope.has(requested)) return notFound();
  const target = byId.get(targetId) ?? root;

  const marked = makeRenderer();
  const bodyMd = (target.body_md ?? "").trim();
  const rendered = bodyMd
    ? (marked.parse(bodyMd) as string)
    : `<p style="color:#9ca3af">This page is empty.</p>`;
  const heading = `<h1>${target.icon ? escapeHtml(target.icon) + " " : ""}${escapeHtml(displayTitle(target.title))}</h1>`;

  // Nav = the published subtree, nested, current page highlighted.
  const renderNav = (id: string, depth: number): string => {
    if (depth > MAX_DEPTH) return "";
    const kids = (byParent.get(id) ?? []).filter((c) => inScope.has(c.id));
    if (kids.length === 0) return "";
    const items = kids
      .map((c) => {
        const href = `?token=${encodeURIComponent(token)}${c.id === root.id ? "" : `&note=${encodeURIComponent(c.id)}`}`;
        const cls = c.id === targetId ? ' class="active"' : "";
        const label = `${c.icon ? escapeHtml(c.icon) + " " : ""}${escapeHtml(displayTitle(c.title))}`;
        return `<li><a href="${href}"${cls}>${label}</a>${renderNav(c.id, depth + 1)}</li>`;
      })
      .join("");
    return `<ul>${items}</ul>`;
  };
  const rootHref = `?token=${encodeURIComponent(token)}`;
  const rootActive = targetId === root.id ? ' class="home active"' : ' class="home"';
  const navHtml = `<a href="${rootHref}"${rootActive}>${root.icon ? escapeHtml(root.icon) + " " : ""}${escapeHtml(displayTitle(root.title))}</a>${renderNav(root.id, 0)}`;

  return page({
    title: displayTitle(target.title),
    navHtml,
    bodyHtml: heading + rendered,
  });
});
