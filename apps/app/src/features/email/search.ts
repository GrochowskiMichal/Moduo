// Pure search logic (EM-9). The instant local envelope match + the local/server
// result merge. No I/O — unit-tested in search.test.ts. The cached-body scan and
// the server escalation live in the Rust engine (search.rs); this module shapes
// the query and reconciles the sources.

import type { EmailEnvelope } from "./model/email-types";

/** Split a query into lowercase AND-terms (all must match). */
export function searchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** The searchable text of an envelope: sender, address, recipients, subject, preview. */
function envelopeHaystack(env: EmailEnvelope): string {
  return [env.sender, env.senderEmail, env.to, env.cc ?? "", env.subject, env.preview]
    .join(" ")
    .toLowerCase();
}

/**
 * Instant local match over already-synced envelope fields (every token must hit).
 * The zero-latency half of local search — the cached-body scan (Rust) merges in a
 * beat later via [`mergeHits`].
 */
export function searchEnvelopes(envelopes: EmailEnvelope[], query: string): EmailEnvelope[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];
  return envelopes.filter((env) => {
    const hay = envelopeHaystack(env);
    return tokens.every((token) => hay.includes(token));
  });
}

/**
 * A per-account dedupe identity (brief §6: "grouped by account, deduped by
 * Message-ID"). Account-scoped so a Gmail message in both INBOX and All Mail folds
 * to one row, while the same Message-ID landing in two of your accounts stays two
 * rows (each keeps its own attribution). Falls back to the message key when a
 * Message-ID is absent.
 */
export function hitKey(env: EmailEnvelope): string {
  const messageId = env.messageId?.trim();
  return `${env.accountId}::${messageId || env.messageKey}`;
}

/**
 * Merge hit sources in priority order (instant envelopes, cached-body hits, server
 * hits), deduped by [`hitKey`] with the first source winning the kept row. Per-
 * account attribution is inherent (each row carries its `accountId`).
 */
export function mergeHits(...sources: EmailEnvelope[][]): EmailEnvelope[] {
  const byKey = new Map<string, EmailEnvelope>();
  for (const source of sources) {
    for (const env of source) {
      const key = hitKey(env);
      if (!byKey.has(key)) byKey.set(key, env);
    }
  }
  return [...byKey.values()];
}
