/**
 * Public published-note page (Wave-3 NO-9b, AC10) — the `/p/$token` route.
 *
 * A PUBLIC, unauthenticated reader for a note published to the web. It's a
 * direct child of the root route (a sibling of /auth), so it renders OUTSIDE
 * the app gate — no login, workspace, or runtime required. It fetches the
 * published subtree as JSON from the `notes-public` edge function (by token)
 * and renders `body_md` client-side with a hardened markdown renderer (Supabase
 * can't serve HTML from an edge function — see gotchas). Clean, no app chrome,
 * `noindex`. Tokens-only.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { publicUrlTransform, stripLeadingTitle } from "../../features/notes/public-render";

// Render a link only when its href survived the allow-list (react-markdown
// passes an empty href for dropped schemes); otherwise show the label as plain
// text (a moduo:// chip is a dead link to an anonymous visitor).
const MD_COMPONENTS: Components = {
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="nofollow noopener noreferrer">
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
};

const SUPABASE_URL: string =
  (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ||
  "https://wtoonrvuqumihpkbvwvs.supabase.co";

type PublicNote = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  bodyMd: string;
};

type PublicPayload = { rootId: string; notes: PublicNote[] };

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error" }
  | { status: "ok"; data: PublicPayload };

function displayTitle(title: string): string {
  return title.trim() || "Untitled";
}

/** Inject a robots=noindex meta while this page is mounted (SPA has no per-route
 * server meta); set the tab title to the note. */
function useNoindexTitle(title: string | null) {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const prevTitle = document.title;
    return () => {
      meta.remove();
      document.title = prevTitle;
    };
  }, []);
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}

export function PublishedNotePage() {
  const { token } = useParams({ from: "/p/$token" });
  const search = useSearch({ strict: false }) as { note?: string };
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/notes-public?token=${encodeURIComponent(token)}`,
        );
        if (!active) return;
        if (res.status === 404) return setState({ status: "not-found" });
        if (!res.ok) return setState({ status: "error" });
        const data = (await res.json()) as PublicPayload;
        if (!active) return;
        if (!data?.notes?.length) return setState({ status: "not-found" });
        setState({ status: "ok", data });
      } catch {
        if (active) setState({ status: "error" });
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const view = useMemo(() => {
    if (state.status !== "ok") return null;
    const { rootId, notes } = state.data;
    const byId = new Map(notes.map((n) => [n.id, n]));
    const byParent = new Map<string | null, PublicNote[]>();
    for (const n of notes) {
      const key = n.parentId && byId.has(n.parentId) ? n.parentId : null;
      const bucket = byParent.get(key) ?? [];
      bucket.push(n);
      byParent.set(key, bucket);
    }
    for (const list of byParent.values()) {
      list.sort((a, b) => displayTitle(a.title).localeCompare(displayTitle(b.title)) || (a.id < b.id ? -1 : 1));
    }
    const requested = search.note && byId.has(search.note) ? search.note : rootId;
    const target = byId.get(requested) ?? byId.get(rootId) ?? notes[0];
    return { rootId, byId, byParent, target };
  }, [state, search.note]);

  useNoindexTitle(view ? displayTitle(view.target.title) : null);

  if (state.status === "loading") {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Shell>
    );
  }
  if (state.status === "not-found") {
    return (
      <Shell>
        <div className="text-center">
          <h1 className="font-display text-xl font-semibold text-foreground">Page not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This link is no longer available. It may have been unpublished.
          </p>
        </div>
      </Shell>
    );
  }
  if (state.status === "error" || !view) {
    return (
      <Shell>
        <div className="text-center">
          <h1 className="font-display text-xl font-semibold text-foreground">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">Couldn't load this page. Try again shortly.</p>
        </div>
      </Shell>
    );
  }

  const { rootId, byParent, target } = view;
  const body = stripLeadingTitle(target.bodyMd, target.title).trim();

  const renderNav = (id: string, depth: number): ReactNode => {
    if (depth > 100) return null;
    const kids = byParent.get(id) ?? [];
    if (kids.length === 0) return null;
    return (
      <ul className="flex flex-col gap-0.5">
        {kids.map((c) => (
          <li key={c.id}>
            <Link
              to="/p/$token"
              params={{ token }}
              search={c.id === rootId ? {} : { note: c.id }}
              className={
                c.id === target.id
                  ? "block rounded-md px-2 py-1 text-sm font-medium text-foreground"
                  : "block rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              }
            >
              {c.icon ? `${c.icon} ` : ""}
              {displayTitle(c.title)}
            </Link>
            {renderNav(c.id, depth + 1)}
          </li>
        ))}
      </ul>
    );
  };

  const rootNote = view.byId.get(rootId);
  const hasChildren = (byParent.get(rootId) ?? []).length > 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-5xl gap-10 px-6 pb-32 pt-12">
        {hasChildren ? (
          <nav className="sticky top-12 hidden w-56 shrink-0 self-start text-sm md:block">
            <Link
              to="/p/$token"
              params={{ token }}
              search={{}}
              className={
                target.id === rootId
                  ? "mb-3 block font-semibold text-foreground"
                  : "mb-3 block font-semibold text-muted-foreground hover:text-foreground"
              }
            >
              {rootNote?.icon ? `${rootNote.icon} ` : ""}
              {displayTitle(rootNote?.title ?? "")}
            </Link>
            {renderNav(rootId, 0)}
          </nav>
        ) : null}
        <main className="min-w-0 flex-1">
          <h1 className="mb-4 font-display text-3xl font-semibold text-foreground">
            {target.icon ? `${target.icon} ` : ""}
            {displayTitle(target.title)}
          </h1>
          {body ? (
            <div className="notes-public-prose">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={publicUrlTransform}
                components={MD_COMPONENTS}
              >
                {body}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">This page is empty.</p>
          )}
          <footer className="mt-16 border-t border-border pt-4 text-xs text-muted-foreground">
            Published with{" "}
            <a
              href="https://moduo.app"
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Moduo
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="grid min-h-screen place-items-center bg-background px-6">{children}</div>;
}
