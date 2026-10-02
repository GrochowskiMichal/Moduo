// Connective-tissue spine — deterministic auto-suggested links (block CT-6).
//
// The pure brain behind the LinkSuggestionStrip (AC11). The server RPC
// `links_suggest` gathers RAW per-signal candidate facts — shared tags, matching
// email domains, ±time-window co-activity — already excluding self / already-
// linked / previously-declined pairs. THIS reducer is the deterministic scorer:
// it aggregates the raw rows per candidate pair, weights each signal, drops any
// pair the caller has locally declined or linked (optimistic suppression), and
// ranks them so the strip can show ONE at rest. It is pure + deterministic and
// there is NO path here that writes a link — a suggestion is never auto-applied
// (AC11), only surfaced for a one-tap accept.

import {
  DEFAULT_RELATION_KIND,
  deriveLinkKey,
  type EntityRef,
  isSameEntity,
  type RelationKind,
} from "../../lib/entity-links";

/** The deterministic, non-ML signals a suggestion can be built from. */
export const SUGGESTION_SIGNALS = ["shared-tag", "email-domain", "time-window"] as const;
export type SuggestionSignal = (typeof SUGGESTION_SIGNALS)[number];

/**
 * Relative weight of each signal — shared tags are the strongest real affinity,
 * an exact email-domain match is a strong identity signal, and ±time-window
 * co-activity is the weakest (kept lowest so it never outranks a real signal;
 * a candidate for being cut post-alpha if its real-data precision can't beat
 * coin-flip — spine BRIEF Q4). Multiplied by the raw `strength` (e.g. number of
 * shared tags) the server reports for the signal.
 */
export const SIGNAL_WEIGHTS: Record<SuggestionSignal, number> = {
  "shared-tag": 100,
  "email-domain": 60,
  "time-window": 10,
};

/** One raw per-signal candidate row as returned by the `links_suggest` RPC. */
export type RawLinkSuggestion = {
  otherType: string;
  otherId: string;
  otherLabel: string;
  otherIcon: string | null;
  signal: SuggestionSignal;
  /** The kind the link would take if accepted (works-at for contact↔company). */
  suggestedKind: RelationKind;
  /** Signal-specific raw count (e.g. number of shared tags); coerced to >= 1. */
  strength: number;
};

/** A scored, de-duplicated suggestion — one candidate pair, ready for the strip. */
export type LinkSuggestion = {
  other: EntityRef;
  label: string;
  icon: string | null;
  /** Every signal that fired for this pair, strongest first. */
  signals: SuggestionSignal[];
  suggestedKind: RelationKind;
  /** Weighted total across all of the pair's signals; higher ranks first. */
  score: number;
};

export type ScoreSuggestionsOptions = {
  /** Pair keys (deriveLinkKey) the user has declined — suppressed from results. */
  declinedPairKeys?: Iterable<string>;
  /** Pair keys already linked locally (optimistic) — suppressed from results. */
  linkedPairKeys?: Iterable<string>;
};

function isKnownSignal(value: string): value is SuggestionSignal {
  return (SUGGESTION_SIGNALS as readonly string[]).includes(value);
}

type Accumulator = {
  other: EntityRef;
  label: string;
  icon: string | null;
  suggestedKind: RelationKind;
  /** Best weighted contribution seen per signal (dedupes repeat raw rows). */
  contributions: Map<SuggestionSignal, number>;
};

/**
 * Aggregate raw per-signal rows into ranked, de-duplicated suggestions. Pure +
 * deterministic: same input → same output, no side effects, never links anything.
 * Drops self-pairs, unknown signals, and any pair in `declinedPairKeys` /
 * `linkedPairKeys`. A pair with several signals (shared tag AND co-activity)
 * becomes ONE suggestion whose score sums each signal's best contribution.
 * Sorted by score desc, then label asc for a stable order.
 */
export function scoreSuggestions(
  focus: EntityRef,
  raw: RawLinkSuggestion[],
  options: ScoreSuggestionsOptions = {},
): LinkSuggestion[] {
  const declined = new Set(options.declinedPairKeys ?? []);
  const linked = new Set(options.linkedPairKeys ?? []);
  const byPair = new Map<string, Accumulator>();

  for (const row of raw) {
    if (!isKnownSignal(row.signal)) continue;
    const other: EntityRef = { type: row.otherType, id: row.otherId };
    if (isSameEntity(focus, other)) continue;
    const pairKey = deriveLinkKey(focus, other);
    if (declined.has(pairKey) || linked.has(pairKey)) continue;

    const strength = Number.isFinite(row.strength) && row.strength > 0 ? row.strength : 1;
    const contribution = SIGNAL_WEIGHTS[row.signal] * strength;

    let entry = byPair.get(pairKey);
    if (!entry) {
      entry = {
        other,
        label: row.otherLabel || other.type,
        icon: row.otherIcon ?? null,
        suggestedKind: DEFAULT_RELATION_KIND,
        contributions: new Map(),
      };
      byPair.set(pairKey, entry);
    }
    const prev = entry.contributions.get(row.signal) ?? 0;
    if (contribution > prev) entry.contributions.set(row.signal, contribution);
    // Prefer a meaningful kind (e.g. works-at) over the generic default.
    if (row.suggestedKind && row.suggestedKind !== DEFAULT_RELATION_KIND) {
      entry.suggestedKind = row.suggestedKind;
    }
  }

  const result: LinkSuggestion[] = [];
  for (const entry of byPair.values()) {
    const signals = [...entry.contributions.keys()].sort(
      (a, b) => (entry.contributions.get(b) ?? 0) - (entry.contributions.get(a) ?? 0),
    );
    const score = [...entry.contributions.values()].reduce((sum, v) => sum + v, 0);
    result.push({
      other: entry.other,
      label: entry.label,
      icon: entry.icon,
      signals,
      suggestedKind: entry.suggestedKind,
      score,
    });
  }
  result.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return result;
}

/** The single suggestion to show at rest (max one — AC11), or null when empty. */
export function topSuggestion(suggestions: LinkSuggestion[]): LinkSuggestion | null {
  return suggestions.length > 0 ? suggestions[0] : null;
}

const SIGNAL_REASON: Record<SuggestionSignal, string> = {
  "shared-tag": "Shares tags",
  "email-domain": "Same email domain",
  "time-window": "Edited around the same time",
};

/** A short, plain-words explanation of the strongest signal (no jargon). */
export function suggestionReason(suggestion: LinkSuggestion): string {
  const top = suggestion.signals[0];
  return top ? SIGNAL_REASON[top] : "Might be related";
}
