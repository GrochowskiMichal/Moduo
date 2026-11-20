// MR-13 — ⌘K's Email group over the rebuilt engine (AC4, AC32). On open it
// reads the accounts, mailboxes (for `in:<folder>`), the saved searches and
// the pulled-in threads' ids once; each query is parsed (search/query.ts) and
// the engine answers it over FTS5 after the palette's debounce. "Search older
// mail on <account>" escalates one account to the server search. Null engine
// (web, or the engine switched off) answers nothing and the legacy path runs.

import type { SearchAllRow } from "@contracts/search";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { MailAccount, MailEngine } from "../../../lib/runtime.types.mail-engine";
import {
  engineMailRows,
  isSavedSearch,
  MAIL_PALETTE_LIMIT,
  readSavedSearches,
  type SavedSearch,
  savedSearchValue,
  type ServerHit,
  serverMailRows,
} from "../search/palette";
import {
  isMailQueryEmpty,
  type MailQuerySuggestion,
  mailQuerySuggestions,
  parseMailQuery,
  type SearchMailbox,
} from "../search/query";

const DEBOUNCE_MS = 150;

type Corpus = {
  accounts: MailAccount[];
  mailboxes: SearchMailbox[];
  refIdByThread: Map<string, string>;
  saved: SavedSearch[];
};

export type EscalationState = { accountId: string; status: "searching" | "ok" | "failed" };

export type PaletteEngineMail = {
  rows: SearchAllRow[];
  searching: boolean;
  suggestions: MailQuerySuggestion[];
  accounts: MailAccount[];
  escalation: EscalationState | null;
  escalate: (accountId: string) => void;
  saved: SavedSearch[];
  /** The query can be pinned to the rail (not empty, not pinned yet). */
  canSave: boolean;
  save: () => void;
};

export function usePaletteEngineMail(opts: {
  runtime: ModuoRuntime | null;
  engine: MailEngine | null;
  workspaceId: string | null;
  open: boolean;
  query: string;
  wanted: boolean;
}): PaletteEngineMail | null {
  const { runtime, engine, workspaceId, open, query, wanted } = opts;
  const active = engine !== null && open;
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [hits, setHits] = useState<{ query: string; rows: SearchAllRow[] } | null>(null);
  const [server, setServer] = useState<{ query: string; rows: SearchAllRow[] } | null>(null);
  const [escalation, setEscalation] = useState<EscalationState | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!active || !engine) return;
    let live = true;
    void (async () => {
      const accounts = await engine.listAccounts().catch(() => [] as MailAccount[]);
      const boxes = await Promise.all(
        accounts.map((a) => engine.listMailboxes(a.id).catch(() => [])),
      );
      const [bundle, settings] = await Promise.all([
        workspaceId && runtime ? runtime.email.listModule(workspaceId).catch(() => null) : null,
        runtime ? runtime.email.listSettings().catch(() => []) : [],
      ]);
      if (!live) return;
      setCorpus({
        accounts,
        mailboxes: boxes.flat().map((m) => ({ id: m.id, name: m.name, role: m.role })),
        refIdByThread: new Map((bundle?.refs ?? []).map((r) => [r.threadKey, r.id] as const)),
        saved: readSavedSearches(settings),
      });
    })();
    return () => {
      live = false;
      reqRef.current++;
      setCorpus(null);
      setHits(null);
      setServer(null);
      setEscalation(null);
    };
  }, [active, engine, runtime, workspaceId]);

  const ctx = useMemo(() => ({ mailboxes: corpus?.mailboxes ?? [] }), [corpus]);
  const parsed = useMemo(() => parseMailQuery(query, ctx), [query, ctx]);
  const searchable = active && wanted && !isMailQueryEmpty(parsed);

  useEffect(() => {
    if (!searchable || !engine || !corpus) return;
    const req = ++reqRef.current;
    const timer = setTimeout(() => {
      void engine
        .search({ query: parsed, limit: MAIL_PALETTE_LIMIT })
        .then((rows) => engineMailRows(rows, corpus.refIdByThread))
        .catch(() => [] as SearchAllRow[])
        .then((rows) => {
          if (req === reqRef.current) setHits({ query, rows });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchable, engine, corpus, parsed, query]);

  const escalate = useCallback(
    (accountId: string) => {
      if (!runtime || !query.trim()) return;
      const q = query.trim();
      setEscalation({ accountId, status: "searching" });
      runtime.email
        .searchServer({ accountId, query: q, limit: MAIL_PALETTE_LIMIT })
        .then((res) => {
          setServer({ query: q, rows: serverMailRows((res.envelopes ?? []) as ServerHit[]) });
          setEscalation({ accountId, status: res.status === "ok" ? "ok" : "failed" });
        })
        .catch(() => setEscalation({ accountId, status: "failed" }));
    },
    [runtime, query],
  );

  const saved = corpus?.saved ?? [];
  const canSave = !!runtime && searchable && !isSavedSearch(saved, query);
  const save = useCallback(() => {
    if (!runtime || !query.trim()) return;
    const id = crypto.randomUUID();
    const value = savedSearchValue(query);
    void runtime.email
      .upsertSetting({ id, kind: "saved_search", value, position: saved.length })
      .then(() =>
        setCorpus((c) =>
          c
            ? {
                ...c,
                saved: [
                  ...c.saved,
                  {
                    id,
                    name: String(value.name),
                    query: String(value.query),
                    position: saved.length,
                  },
                ],
              }
            : c,
        ),
      )
      .catch(() => {});
  }, [runtime, query, saved.length]);

  if (!engine) return null;
  const local = searchable && hits?.query === query ? hits.rows : [];
  const fromServer = server?.query === query.trim() ? server.rows : [];
  const localIds = new Set(local.map((r) => r.entity_id));
  return {
    rows: searchable ? [...local, ...fromServer.filter((r) => !localIds.has(r.entity_id))] : [],
    searching: searchable && hits?.query !== query,
    suggestions: active ? mailQuerySuggestions(query, { mailboxes: ctx.mailboxes }) : [],
    accounts: corpus?.accounts ?? [],
    escalation,
    escalate,
    saved,
    canSave,
    save,
  };
}
