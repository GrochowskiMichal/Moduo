// Connective-tissue spine — deterministic auto-suggested links (block CT-6).
//
// The pure, unit-tested brain behind the quiet "Link?" strip. Raw candidate
// gathering is server-side (the `links_suggest` RPC, see
// supabase/migrations/20260627120000_spine_link_suggestions.sql) over signals
// that have real tables; THIS module owns the deterministic scoring, ranking,
// decline-suppression, the max-one-at-rest pick (AC11), and the accept-input
// shaper — the half the unit tests prove (Assumption 10).
//
// Crucially there is NO function here that writes a link. A suggestion is data;
// accepting one requires the caller to explicitly invoke
// `runtime.spine.createLink(origin='suggest')` with {@link acceptSuggestionInput}.
// Nothing is ever linked without a tap — the load-bearing guarantee of AC11.

// Relative (not `@/`) so vitest resolves these VALUE imports — vitest has no
// path-alias config, and a value import across `@/` fails at runtime even though
// it typechecks (see docs/gotchas.md).
import {
  DEFAULT_RELATION_KIND,
  coerceRelationKind,
  deriveLinkKey,
  isSelfLink,
  type EntityRef,
  type LinkOrigin,
  type RelationKind,
} from "../../lib/entity-links";

/**
 * The closed set of deterministic signals a suggestion may rest on. ML /
 * embedding similarity is explicitly out of scope (Assumption 7); every signal
 * here is a checkable fact (a shared tag, a matching email domain, a time
 * window), so a suggestion can always be explained in one human sentence.
 */
export const SUGGESTION_SIGNALS = ["shared-tag", "address-match", "time-window"] as const;
export type SuggestionSignal = (typeof SUGGESTION_SIGNALS)[number];

/** Origin stamped on a link created by accepting a suggestion (AC11). */
export const SUGGESTION_ORIGIN: LinkOrigin = "suggest";

/**
 * Per-signal score weights. `shared-tag` is the strongest deterministic signal;
 * `address-match` (a contact's email domain matching a company's) is strong and
 * implies a specific kind (`works-at`); `time-window` is a weak BOOSTER only —
 * the server never emits a candidate on time proximity alone, so a pure time
 * coincidence is never surfaced as a suggestion (anti-theater; spine BRIEF Q4).
 */
export const SUGGESTION_WEIGHTS: Record<SuggestionSignal, number> = {
  "shared-tag": 10,
  "address-match": 8,
  "time-window": 2,
};

/** Diminishing-returns cap on how many shared tags add to a candidate's score. */
export const SHARED_TAG_CAP = 3;

/**
 * A raw candidate row as returned by the `links_suggest` RPC (snake→camel). The
 * signal flags are facts the server computed; the score is derived here.
 */
export type SuggestionCandidate = {
  target: EntityRef;
  label: string;
  icon: string | null;
  /** The relation kind the strongest signal implies (e.g. `works-at` for a domain match). */
  suggestedKind: RelationKind;
  /** How many tags the focus and the candidate share (0 if the tag signal didn't fire). */
  sharedTagCount: number;
  /** A contact↔company email-domain match fired. */
  addressMatch: boolean;
  /** Created within the focus entity's ±time window (a score booster only). */
  nearInTime: boolean;
};

/** A scored, ranked, display-ready suggestion. */
export type LinkSuggestion = SuggestionCandidate & {
  /** Direction-agnostic pair key (focus↔target) — the dedupe + decline key. */
  pairKey: string;
  /** Which signals fired, strongest first (drives the human-readable reason). */
  signals: SuggestionSignal[];
  score: number;
};

/** The deterministic signals a candidate rests on, in descending weight order. */
export function signalsFor(candidate: SuggestionCandidate): SuggestionSignal[] {
  const out: SuggestionSignal[] = [];
  if (candidate.sharedTagCount > 0) out.push("shared-tag");
  if (candidate.addressMatch) out.push("address-match");
  if (candidate.nearInTime) out.push("time-window");
  return out;
}

/**
 * Deterministic score for a candidate: the sum of its fired signals' weights,
 * with the shared-tag contribution scaled by the (capped) shared-tag count. A
 * candidate with no fired signal scores 0 (and is dropped by {@link buildSuggestions}).
 */
export function scoreCandidate(candidate: SuggestionCandidate): number {
  let score = 0;
  if (candidate.sharedTagCount > 0) {
    score += SUGGESTION_WEIGHTS["shared-tag"] * Math.min(candidate.sharedTagCount, SHARED_TAG_CAP);
  }
  if (candidate.addressMatch) score += SUGGESTION_WEIGHTS["address-match"];
  if (candidate.nearInTime) score += SUGGESTION_WEIGHTS["time-window"];
  return score;
}

/**
 * A one-line, sentence-case reason for the strip — paired with an icon in the
 * UI, never a color-only signal (R8, R5). Leads with the most specific signal.
 */
export function suggestionReason(signals: SuggestionSignal[]): string {
  if (signals.includes("address-match")) return "Same email domain";
  if (signals.includes("shared-tag")) {
    return signals.includes("time-window") ? "Shared tag, around the same time" : "Shared tag";
  }
  if (signals.includes("time-window")) return "Created around the same time";
  return "Might be related";
}

/**
 * Build the ranked, decline-suppressed, scored suggestion list for a focus
 * entity. Pure and deterministic — no I/O, no writes. Drops self-pairs, any
 * candidate whose pair the user already declined (the server suppresses declines
 * too; this is the client-side guarantee the unit test pins), duplicate pairs,
 * and any candidate with no fired signal (no theater).
 */
export function buildSuggestions(
  focus: EntityRef,
  candidates: SuggestionCandidate[],
  declinedPairKeys: Iterable<string> = [],
): LinkSuggestion[] {
  const declined = declinedPairKeys instanceof Set ? declinedPairKeys : new Set(declinedPairKeys);
  const seen = new Set<string>();
  const out: LinkSuggestion[] = [];

  for (const candidate of candidates) {
    if (isSelfLink(focus, candidate.target)) continue;
    const pairKey = deriveLinkKey(focus, candidate.target);
    if (declined.has(pairKey) || seen.has(pairKey)) continue;
    const signals = signalsFor(candidate);
    if (signals.length === 0) continue;
    seen.add(pairKey);
    out.push({
      ...candidate,
      suggestedKind: coerceRelationKind(candidate.suggestedKind),
      pairKey,
      signals,
      score: scoreCandidate(candidate),
    });
  }

  // Strongest first; stable tiebreak by label so the at-rest pick is deterministic.
  out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return out;
}

/**
 * The single suggestion shown at rest — max one (AC11) — or null if there are
 * none. The strip advances to the next only after the user accepts or dismisses.
 */
export function selectTopSuggestion(suggestions: LinkSuggestion[]): LinkSuggestion | null {
  return suggestions[0] ?? null;
}

/** Arguments for `runtime.spine.createLink` — the shape {@link acceptSuggestionInput} returns. */
export type AcceptSuggestionInput = {
  source: EntityRef;
  target: EntityRef;
  relationKind: RelationKind;
  origin: LinkOrigin;
  sourceLabel?: string;
  sourceIcon?: string | null;
  targetLabel?: string;
  targetIcon?: string | null;
};

/**
 * Shape the `createLink` arguments for accepting a suggestion — always stamped
 * `origin='suggest'` and carrying the suggested relation kind. Returns DATA; it
 * never performs the write. The caller must explicitly invoke the op, so a
 * suggestion can never be applied silently (AC11: "nothing is ever linked
 * without a tap").
 */
export function acceptSuggestionInput(
  focus: EntityRef,
  suggestion: LinkSuggestion,
  opts?: { focusLabel?: string; focusIcon?: string | null },
): AcceptSuggestionInput {
  return {
    source: focus,
    target: suggestion.target,
    relationKind: suggestion.suggestedKind ?? DEFAULT_RELATION_KIND,
    origin: SUGGESTION_ORIGIN,
    sourceLabel: opts?.focusLabel,
    sourceIcon: opts?.focusIcon ?? null,
    targetLabel: suggestion.label,
    targetIcon: suggestion.icon,
  };
}
