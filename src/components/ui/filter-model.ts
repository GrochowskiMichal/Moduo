// The pure half of FilterBar (DS-4): the condition shape, its normalising
// edits and a generic matcher. No React, so a module can filter rows, persist
// conditions through the view-prefs helper and test both without rendering.

import type * as React from "react";

export type FilterIcon = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** is / is not / is any of. "is any of" is never picked by hand: a condition
 *  becomes it when a second value is added under "is", and turns back into
 *  "is" when it drops to one value (see `normalizeCondition`). */
export type FilterOperator = "is" | "is_not" | "any_of";

export const FILTER_OPERATOR_LABEL: Record<FilterOperator, string> = {
  is: "is",
  is_not: "is not",
  any_of: "is any of",
};

const DEFAULT_OPERATORS: readonly FilterOperator[] = ["is", "is_not", "any_of"];

export type FilterOption = {
  value: string;
  label: string;
  /** A leading glyph in pickers. */
  icon?: FilterIcon;
  /** A leading node in pickers when an icon won't do: a tag's colour dot, an
   *  avatar. Wins over `icon`. */
  leading?: React.ReactNode;
  /** A muted trailing count in pickers (how many items carry this value). */
  count?: number;
  /** Extra words type-to-jump matches (an email for a person, a synonym). */
  keywords?: string[];
};

/** One filterable dimension, provided by the module (its "registry"). */
export type FilterDimension = {
  id: string;
  label: string;
  icon?: FilterIcon;
  options: FilterOption[];
  /** The operators this dimension offers; the first is the default. Omit for
   *  is / is not / any of. A yes/no dimension passes `["is"]`. */
  operators?: FilterOperator[];
  /** Whether more than one value can be picked. Default true. */
  multiple?: boolean;
};

/** One active filter. Plain data, so it serialises as-is. */
export type FilterCondition = {
  dimension: string;
  operator: FilterOperator;
  values: string[];
};

function allowedOperators(dimension: FilterDimension): readonly FilterOperator[] {
  return dimension.operators?.length ? dimension.operators : DEFAULT_OPERATORS;
}

/** The operators the chip's operator menu offers for a value count: "is" for
 *  one value and "is any of" for several are the same choice, so only the one
 *  that fits the count is listed. */
export function operatorsFor(dimension: FilterDimension, valueCount: number): FilterOperator[] {
  const out: FilterOperator[] = [];
  for (const op of allowedOperators(dimension)) {
    const fitted: FilterOperator =
      valueCount > 1 && op === "is" ? "any_of" : valueCount <= 1 && op === "any_of" ? "is" : op;
    if (!out.includes(fitted)) out.push(fitted);
  }
  return out;
}

/**
 * Brings a condition back to a valid shape, or returns null when it filters
 * nothing (no values left). Dedupes values, keeps one value on a single-pick
 * dimension, falls back to the default operator when the stored one isn't
 * offered, and keeps "is" ⇄ "is any of" in step with the value count.
 */
export function normalizeCondition(
  condition: FilterCondition,
  dimension: FilterDimension,
): FilterCondition | null {
  let values = [...new Set(condition.values)];
  if (dimension.multiple === false) values = values.slice(-1);
  if (values.length === 0) return null;
  const offered = operatorsFor(dimension, values.length);
  const fitted: FilterOperator =
    values.length > 1 && condition.operator === "is"
      ? "any_of"
      : values.length === 1 && condition.operator === "any_of"
        ? "is"
        : condition.operator;
  const operator = offered.includes(fitted) ? fitted : offered[0];
  if (operator === undefined) return null;
  return { dimension: dimension.id, operator, values };
}

/** Adds or removes one value on a dimension's condition, creating the
 *  condition (default operator) when the dimension has none yet. On a
 *  single-pick dimension a new value replaces the old one. */
export function toggleFilterValue(
  conditions: readonly FilterCondition[],
  dimension: FilterDimension,
  value: string,
): FilterCondition[] {
  const index = conditions.findIndex((c) => c.dimension === dimension.id);
  if (index === -1) {
    const created = normalizeCondition(
      {
        dimension: dimension.id,
        operator: allowedOperators(dimension)[0] ?? "is",
        values: [value],
      },
      dimension,
    );
    return created ? [...conditions, created] : [...conditions];
  }
  const current = conditions[index];
  if (!current) return [...conditions];
  const has = current.values.includes(value);
  const values =
    dimension.multiple === false
      ? has
        ? []
        : [value]
      : has
        ? current.values.filter((v) => v !== value)
        : [...current.values, value];
  return replaceCondition(conditions, index, { ...current, values }, dimension);
}

/** Swaps the condition at `index` for `next` (normalised), dropping it when
 *  `next` is null or ends up empty. */
export function replaceCondition(
  conditions: readonly FilterCondition[],
  index: number,
  next: FilterCondition | null,
  dimension: FilterDimension,
): FilterCondition[] {
  const normalized = next ? normalizeCondition(next, dimension) : null;
  const out = [...conditions];
  if (normalized) out.splice(index, 1, normalized);
  else out.splice(index, 1);
  return out;
}

/**
 * Reads conditions back from storage or a URL: keeps only well-formed ones on
 * a dimension the module still offers, normalised. Anything else (a renamed
 * dimension, an unknown operator, non-string values, junk) is dropped rather
 * than thrown on. Values aren't checked against the dimension's options, so
 * an option that loads later (a tag, a member) still applies; the chip shows
 * an unknown value raw.
 */
export function sanitizeConditions(
  raw: unknown,
  dimensions: readonly FilterDimension[],
): FilterCondition[] {
  if (!Array.isArray(raw)) return [];
  const out: FilterCondition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { dimension, operator, values } = item as Record<string, unknown>;
    const dim = dimensions.find((d) => d.id === dimension);
    if (!dim || typeof operator !== "string" || !Array.isArray(values)) continue;
    if (!(operator in FILTER_OPERATOR_LABEL)) continue;
    const normalized = normalizeCondition(
      {
        dimension: dim.id,
        operator: operator as FilterOperator,
        values: values.filter((v): v is string => typeof v === "string"),
      },
      dim,
    );
    if (normalized) out.push(normalized);
  }
  return out;
}

/**
 * Whether an item passes every condition (AND across conditions). `valuesOf`
 * returns the item's values on a dimension: one for a single-valued field
 * (`[task.priority]`), several for a multi-valued one (its tag ids), none when
 * empty. is / is any of pass when they share a value; is not passes when they
 * share none.
 */
export function matchesFilters<T>(
  item: T,
  conditions: readonly FilterCondition[],
  valuesOf: (item: T, dimension: string) => readonly string[],
): boolean {
  return conditions.every((condition) => {
    const own = valuesOf(item, condition.dimension);
    const shared = condition.values.some((v) => own.includes(v));
    return condition.operator === "is_not" ? !shared : shared;
  });
}

/** The chip's value text: up to two labels, then "+N". An option the module
 *  no longer lists shows its raw value. */
export function conditionValueText(condition: FilterCondition, dimension: FilterDimension): string {
  const labels = condition.values.map(
    (v) => dimension.options.find((o) => o.value === v)?.label ?? v,
  );
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

/** The whole condition as one sentence, for accessible names. */
export function describeCondition(condition: FilterCondition, dimension: FilterDimension): string {
  const labels = condition.values.map(
    (v) => dimension.options.find((o) => o.value === v)?.label ?? v,
  );
  return `${dimension.label} ${FILTER_OPERATOR_LABEL[condition.operator]} ${labels.join(", ")}`;
}
