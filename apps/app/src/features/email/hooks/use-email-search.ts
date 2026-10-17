// Hybrid search state (EM-9). Instant local match over the in-memory synced
// envelopes + a debounced cached-body scan (Rust sidecar), merged and reshaped
// into thread rows; plus explicit per-account server escalation with honest
// status. No triage coupling — the page renders `results` in place of the inbox.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { EmailEnvelope, EmailThread, SavedAccount } from "../model/email-types";
import { mergeHits, searchEnvelopes } from "../search";
import { shapeInboxThreads } from "../threads";

const LOCAL_DEBOUNCE_MS = 140;

export type ServerSearchState = {
  status: "idle" | "searching" | "ok" | "timeout" | "unsupported" | "error";
  count: number;
};

export type EmailSearchApi = {
  query: string;
  setQuery: (query: string) => void;
  /** True while a non-empty query is being searched. */
  active: boolean;
  /** Reshaped thread rows: instant-envelope ∪ cached-body ∪ escalated-server hits. */
  results: EmailThread[];
  /** Per-account escalation status (keyed by account id). */
  serverStates: Record<string, ServerSearchState>;
  /** Run the full-mailbox server search for one account. */
  escalate: (accountId: string) => void;
  clear: () => void;
};

export function useEmailSearch(opts: {
  runtime: ModuoRuntime | null;
  envelopes: EmailEnvelope[];
  accounts: SavedAccount[];
  isDesktop: boolean;
  /** The active account scope (null = Unified) — local + body search honor it so
   * the results match the escalation footer's per-account offer. */
  accountId?: string | null;
}): EmailSearchApi {
  const { runtime, envelopes, accounts, isDesktop, accountId = null } = opts;
  const [query, setQueryState] = useState("");
  const [bodyHits, setBodyHits] = useState<EmailEnvelope[]>([]);
  const [serverHits, setServerHits] = useState<Record<string, EmailEnvelope[]>>({});
  const [serverStates, setServerStates] = useState<Record<string, ServerSearchState>>({});
  // Tags async responses so a stale (superseded-query) result is dropped.
  const seqRef = useRef(0);

  const trimmed = query.trim();
  const active = trimmed.length > 0;

  const setQuery = useCallback((next: string) => {
    seqRef.current += 1; // invalidate in-flight body/server responses
    setQueryState(next);
  }, []);

  const clear = useCallback(() => {
    seqRef.current += 1;
    setQueryState("");
  }, []);

  // Any query change resets the escalation state (a new query = a fresh
  // per-account search) and drops stale body hits until the debounce refills them,
  // so the results/footer never show a prior query's status.
  useEffect(() => {
    setBodyHits([]);
    setServerHits({});
    setServerStates({});
  }, [trimmed]);

  // Debounced cached-body scan (Rust). The instant envelope match is synchronous
  // in the `results` memo below, so this only adds deep-body hits.
  useEffect(() => {
    if (!active || !isDesktop || !runtime) return;
    const seq = ++seqRef.current;
    const handle = setTimeout(() => {
      void runtime.email
        // Scope to the inbox surface (the instant match is inbox-only) + the active
        // account, so a body hit never surfaces Sent/Trash or another account.
        .searchBodies({ query: trimmed, accountId, folder: "inbox" })
        .then((hits) => {
          if (seqRef.current === seq) setBodyHits(hits as EmailEnvelope[]);
        })
        .catch(() => {
          if (seqRef.current === seq) setBodyHits([]);
        });
    }, LOCAL_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [trimmed, active, isDesktop, runtime, accountId]);

  const escalate = useCallback(
    (accountId: string) => {
      if (!runtime || !isDesktop || trimmed.length === 0) return;
      const seq = seqRef.current; // escalation belongs to the CURRENT query
      setServerStates((prev) => ({ ...prev, [accountId]: { status: "searching", count: 0 } }));
      void runtime.email
        .searchServer({ accountId, query: trimmed })
        .then((res) => {
          if (seqRef.current !== seq) return; // query changed mid-flight — drop
          const envs = (res.envelopes ?? []) as EmailEnvelope[];
          setServerHits((prev) => ({ ...prev, [accountId]: envs }));
          setServerStates((prev) => ({
            ...prev,
            [accountId]: { status: res.status, count: envs.length },
          }));
        })
        .catch(() => {
          if (seqRef.current !== seq) return;
          setServerStates((prev) => ({ ...prev, [accountId]: { status: "error", count: 0 } }));
        });
    },
    [runtime, isDesktop, trimmed],
  );

  const results = useMemo(() => {
    if (!active) return [];
    const scoped = accountId ? envelopes.filter((e) => e.accountId === accountId) : envelopes;
    const local = searchEnvelopes(scoped, trimmed);
    const server = Object.values(serverHits).flat();
    const merged = mergeHits(local, bodyHits, server);
    return shapeInboxThreads(merged, accounts);
  }, [active, envelopes, trimmed, bodyHits, serverHits, accounts, accountId]);

  return { query, setQuery, active, results, serverStates, escalate, clear };
}
