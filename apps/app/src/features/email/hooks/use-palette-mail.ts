// GS-9 — this device's mail for the ⌘K palette's Email group (Assumption 15).
// Desktop only: on open it reads the synced inbox envelopes, the connected
// accounts and the workspace's pulled-in threads (for their ids) once; each
// query matches the envelopes at once and asks the Rust body scan after the
// palette's debounce. Nothing here reaches Supabase but the `email_refs` read
// the Email page already makes. On web it answers null: `search_all`'s
// pulled-in threads are all there is (Q17).

import type { SearchAllRow } from "@contracts/search";
import { useEffect, useMemo, useState } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { EmailEnvelope, SavedAccount } from "../model/email-types";
import { localMailRows, mailBodyQuery } from "../search-palette";

const IS_DESKTOP = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const BODY_DEBOUNCE_MS = 150;
// The Email page's own read ceiling (use-email-module).
const ENVELOPE_LIMIT = 500;

type Corpus = {
  envelopes: EmailEnvelope[];
  accounts: SavedAccount[];
  refs: Array<{ id: string; threadKey: string }>;
};

const NO_HITS: { query: string | null; hits: EmailEnvelope[] } = { query: null, hits: [] };

export type PaletteMail = {
  /** This device's matches as Email rows; null on web (nothing to add). */
  rows: SearchAllRow[] | null;
  /** The body scan for this query hasn't answered yet. */
  searching: boolean;
};

export function usePaletteMail(opts: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  open: boolean;
  query: string;
  /** The palette asks for mail now (a searchable query, All or Email chip). */
  wanted: boolean;
  isDesktop?: boolean;
}): PaletteMail {
  const { runtime, workspaceId, open, query, wanted, isDesktop = IS_DESKTOP } = opts;
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [body, setBody] = useState(NO_HITS);
  const active = isDesktop && open && runtime !== null;

  // The inbox as this device holds it, read fresh each time ⌘K opens. A failed
  // read leaves no local mail; the server's pulled-in threads still answer.
  useEffect(() => {
    if (!active || !runtime) return;
    let live = true;
    void (async () => {
      try {
        const [accounts, listed, bundle] = await Promise.all([
          runtime.email.listAccounts(),
          runtime.email.listEnvelopes({ accountId: null, folder: "inbox", limit: ENVELOPE_LIMIT }),
          workspaceId ? runtime.email.listModule(workspaceId).catch(() => null) : null,
        ]);
        if (!live) return;
        setCorpus({
          accounts: (accounts ?? []) as SavedAccount[],
          envelopes: ((listed as { envelopes?: unknown } | null)?.envelopes ??
            []) as EmailEnvelope[],
          refs: (bundle?.refs ?? []).map((r) => ({ id: r.id, threadKey: r.threadKey })),
        });
      } catch {
        if (live) setCorpus(null);
      }
    })();
    // Closing ⌘K drops the copy; the next open reads the inbox again.
    return () => {
      live = false;
      setCorpus(null);
      setBody(NO_HITS);
    };
  }, [active, runtime, workspaceId]);

  // The cached-body scan (Rust), debounced, the last query winning.
  const bodyQuery = active && wanted ? mailBodyQuery(query) : null;
  useEffect(() => {
    if (!bodyQuery || !runtime) return;
    let live = true;
    const timer = setTimeout(() => {
      void runtime.email
        .searchBodies({ query: bodyQuery, accountId: null, folder: "inbox" })
        .then((hits) => {
          if (live) setBody({ query: bodyQuery, hits: (hits ?? []) as EmailEnvelope[] });
        })
        .catch(() => {
          if (live) setBody({ query: bodyQuery, hits: [] });
        });
    }, BODY_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [bodyQuery, runtime]);

  const bodyHits = body.query === bodyQuery ? body.hits : NO_HITS.hits;
  const rows = useMemo<SearchAllRow[] | null>(() => {
    if (!isDesktop) return null;
    if (!corpus || !bodyQuery) return [];
    return localMailRows({
      envelopes: corpus.envelopes,
      bodyHits,
      accounts: corpus.accounts,
      refs: corpus.refs,
      query,
    });
  }, [isDesktop, corpus, bodyQuery, bodyHits, query]);

  return { rows, searching: bodyQuery !== null && body.query !== bodyQuery };
}
