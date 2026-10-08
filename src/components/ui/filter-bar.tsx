import { Check, ChevronRight, ListFilter, Plus, X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { Button } from "./button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import {
  conditionValueText,
  describeCondition,
  FILTER_OPERATOR_LABEL,
  type FilterCondition,
  type FilterDimension,
  type FilterOperator,
  type FilterOption,
  operatorsFor,
  replaceCondition,
  toggleFilterValue,
} from "./filter-model";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/*
 * FilterBar (DS-4) — generic filtering over a dimension registry the module
 * provides. Four pieces share one condition shape (filter-model.ts):
 *
 * - `FilterMenu`: the "+ Filter" popover. Pick a dimension, then its values;
 *   typing on the first step also lists matching values from every dimension,
 *   so "me" jumps straight to "Assignee › Me".
 * - `FilterChip`: one active condition, read as a sentence
 *   ("Assignee · is · Me ×"). The operator and the value are each clickable.
 * - `FilterBar`: the chip row, "+ Filter", and "23 of 76 · Clear".
 * - `FilterButton`: the toolbar's "Filter" trigger with a count badge.
 *
 * Nothing here knows about tasks; the module maps its fields to dimensions and
 * filters its rows with `matchesFilters`.
 */

type ValueListProps = {
  dimension: FilterDimension;
  selected: readonly string[];
  onToggle: (value: string) => void;
};

function OptionGlyph({ option }: { option: FilterOption }) {
  if (option.leading) return <span className="flex shrink-0 items-center">{option.leading}</span>;
  if (option.icon) {
    const Icon = option.icon;
    return <Icon aria-hidden className="size-icon-sm shrink-0 text-muted-foreground" />;
  }
  return null;
}

/** A dimension's values with a check on the picked ones. */
function ValueItems({ dimension, selected, onToggle }: ValueListProps) {
  return (
    <CommandGroup>
      {dimension.options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <CommandItem
            key={option.value}
            value={`${dimension.id}:${option.value}`}
            keywords={[option.label, ...(option.keywords ?? [])]}
            onSelect={() => onToggle(option.value)}
            aria-checked={on}
          >
            <OptionGlyph option={option} />
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.count !== undefined ? (
              <span className="shrink-0 font-sans text-xs tabular-nums text-muted-foreground">
                {option.count}
              </span>
            ) : null}
            <Check
              aria-hidden
              className={cn(
                "size-icon-sm shrink-0 text-foreground",
                on ? "opacity-100" : "opacity-0",
              )}
            />
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

const POPOVER_CLASS = "w-64 rounded-lg border-hairline p-0";

type FilterMenuProps = {
  dimensions: readonly FilterDimension[];
  value: readonly FilterCondition[];
  onValueChange: (next: FilterCondition[]) => void;
  /** The trigger, rendered as the popover's anchor (asChild). */
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * The add-filter popover: dimension → value, with type-to-jump. Picking a value
 * on a multi-value dimension keeps the menu open so you can tick several;
 * a single-value dimension closes it. Backspace on an empty search steps back
 * from a dimension's values to the dimension list.
 */
function FilterMenu({
  dimensions,
  value,
  onValueChange,
  children,
  align = "start",
  open: openProp,
  defaultOpen = false,
  onOpenChange,
}: FilterMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;
  const [dimensionId, setDimensionId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
    if (!next) {
      setDimensionId(null);
      setQuery("");
    }
  };

  const dimension = dimensions.find((d) => d.id === dimensionId) ?? null;
  const selectedOn = (dim: FilterDimension) =>
    value.find((c) => c.dimension === dim.id)?.values ?? [];

  const toggle = (dim: FilterDimension, optionValue: string) => {
    onValueChange(toggleFilterValue(value, dim, optionValue));
    if (dim.multiple === false) setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className={POPOVER_CLASS}>
        <Command loop label={dimension ? `Filter by ${dimension.label}` : "Filter by"}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={dimension ? `${dimension.label}…` : "Filter…"}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && query === "" && dimension) {
                e.preventDefault();
                setDimensionId(null);
              }
            }}
          />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            {dimension ? (
              <ValueItems
                dimension={dimension}
                selected={selectedOn(dimension)}
                onToggle={(v) => toggle(dimension, v)}
              />
            ) : (
              <>
                <CommandGroup>
                  {dimensions.map((dim) => {
                    const Icon = dim.icon;
                    return (
                      <CommandItem
                        key={dim.id}
                        value={`dimension:${dim.id}`}
                        keywords={[dim.label]}
                        onSelect={() => {
                          setDimensionId(dim.id);
                          setQuery("");
                        }}
                      >
                        {Icon ? (
                          <Icon
                            aria-hidden
                            className="size-icon-sm shrink-0 text-muted-foreground"
                          />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">{dim.label}</span>
                        <ChevronRight
                          aria-hidden
                          className="size-icon-sm shrink-0 text-muted-foreground"
                        />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                {/* Type-to-jump: with a query, every dimension's values join
                    the list, so a value is one Enter away. */}
                {query.trim()
                  ? dimensions.map((dim) => (
                      <CommandGroup key={dim.id} heading={dim.label}>
                        {dim.options.map((option) => {
                          const on = selectedOn(dim).includes(option.value);
                          return (
                            <CommandItem
                              key={option.value}
                              value={`jump:${dim.id}:${option.value}`}
                              keywords={[option.label, ...(option.keywords ?? [])]}
                              onSelect={() => toggle(dim, option.value)}
                              aria-checked={on}
                              aria-label={`${dim.label} › ${option.label}`}
                            >
                              <OptionGlyph option={option} />
                              <span className="flex min-w-0 flex-1 items-center gap-1">
                                <span className="shrink-0 text-muted-foreground">
                                  {dim.label} ›
                                </span>
                                <span className="truncate">{option.label}</span>
                              </span>
                              <Check
                                aria-hidden
                                className={cn(
                                  "size-icon-sm shrink-0 text-foreground",
                                  on ? "opacity-100" : "opacity-0",
                                )}
                              />
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    ))
                  : null}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const SEGMENT_CLASS = cn(
  "inline-flex h-full items-center gap-1.5 px-2",
  "transition-colors duration-(--motion-fade) ease-(--ease-out)",
  "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
);

type FilterChipProps = {
  dimension: FilterDimension;
  condition: FilterCondition;
  /** The edited condition, or null when it should go (× or no values left). */
  onChange: (next: FilterCondition | null) => void;
  className?: string;
};

/** One active condition as a sentence: dimension · operator · value · ×. */
function FilterChip({ dimension, condition, onChange, className }: FilterChipProps) {
  const [valuesOpen, setValuesOpen] = React.useState(false);
  const sentence = describeCondition(condition, dimension);
  const operators = operatorsFor(dimension, condition.values.length);
  const Icon = dimension.icon;

  return (
    <fieldset
      aria-label={sentence}
      data-slot="filter-chip"
      className={cn(
        "inline-flex h-(--ctrl-h-sm) min-w-0 shrink-0 items-center divide-x divide-hairline overflow-hidden rounded-md bg-state-active font-sans text-sm text-foreground",
        className,
      )}
    >
      <span className={cn(SEGMENT_CLASS, "pr-1.5")}>
        {Icon ? <Icon aria-hidden className="size-icon-xs shrink-0 text-muted-foreground" /> : null}
        {dimension.label}
      </span>

      {operators.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(SEGMENT_CLASS, "text-muted-foreground hover:bg-state-hover")}
            aria-label={`Operator: ${FILTER_OPERATOR_LABEL[condition.operator]}`}
          >
            {FILTER_OPERATOR_LABEL[condition.operator]}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={condition.operator}
              onValueChange={(op) => onChange({ ...condition, operator: op as FilterOperator })}
            >
              {operators.map((op) => (
                <DropdownMenuRadioItem key={op} value={op}>
                  {FILTER_OPERATOR_LABEL[op]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className={cn(SEGMENT_CLASS, "text-muted-foreground")}>
          {FILTER_OPERATOR_LABEL[condition.operator]}
        </span>
      )}

      <Popover open={valuesOpen} onOpenChange={setValuesOpen}>
        <PopoverTrigger
          className={cn(SEGMENT_CLASS, "min-w-0 hover:bg-state-hover")}
          aria-label={`${dimension.label} values: ${conditionValueText(condition, dimension)}`}
        >
          <span className="max-w-48 truncate">{conditionValueText(condition, dimension)}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className={POPOVER_CLASS}>
          <Command loop label={dimension.label}>
            <CommandInput placeholder={`${dimension.label}…`} />
            <CommandList>
              <CommandEmpty>No matches.</CommandEmpty>
              <ValueItems
                dimension={dimension}
                selected={condition.values}
                onToggle={(v) => {
                  const next = toggleFilterValue([condition], dimension, v)[0] ?? null;
                  onChange(next);
                  if (dimension.multiple === false || !next) setValuesOpen(false);
                }}
              />
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <button
        type="button"
        className={cn(
          SEGMENT_CLASS,
          "px-1.5 text-muted-foreground hover:bg-state-hover hover:text-foreground",
        )}
        aria-label={`Remove filter: ${sentence}`}
        onClick={() => onChange(null)}
      >
        <X aria-hidden className="size-icon-xs" />
      </button>
    </fieldset>
  );
}

type FilterBarProps = {
  dimensions: readonly FilterDimension[];
  value: readonly FilterCondition[];
  onValueChange: (next: FilterCondition[]) => void;
  /** Items left after filtering; shown as "23 of 76" with `totalCount`. */
  matchCount?: number;
  /** Items in the scope before filtering. */
  totalCount?: number;
  className?: string;
};

/**
 * The active-filter row under a toolbar. Renders nothing while no filter is
 * active (the toolbar's FilterButton is the way in then). A condition on a
 * dimension the module no longer offers is skipped, not shown raw.
 */
function FilterBar({
  dimensions,
  value,
  onValueChange,
  matchCount,
  totalCount,
  className,
}: FilterBarProps) {
  const chips = value.flatMap((condition, index) => {
    const dimension = dimensions.find((d) => d.id === condition.dimension);
    return dimension ? [{ condition, dimension, index }] : [];
  });
  if (chips.length === 0) return null;

  return (
    <div data-slot="filter-bar" className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {chips.map(({ condition, dimension, index }) => (
        <FilterChip
          key={`${condition.dimension}:${index}`}
          dimension={dimension}
          condition={condition}
          onChange={(next) => onValueChange(replaceCondition(value, index, next, dimension))}
        />
      ))}
      <FilterMenu dimensions={dimensions} value={value} onValueChange={onValueChange}>
        <Button
          variant="ghost"
          size="sm"
          className="px-2 text-muted-foreground hover:text-foreground data-[state=open]:bg-state-active"
        >
          <Plus aria-hidden className="size-icon-xs" />
          Filter
        </Button>
      </FilterMenu>
      <span className="ms-auto inline-flex items-center gap-1.5 font-sans text-xs text-muted-foreground">
        {matchCount !== undefined && totalCount !== undefined ? (
          <>
            <span className="tabular-nums">
              {matchCount} of {totalCount}
            </span>
            <span aria-hidden>·</span>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => onValueChange([])}
          className="rounded-sm outline-none transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Clear
        </button>
      </span>
    </div>
  );
}

type FilterButtonProps = Omit<FilterMenuProps, "children"> & {
  className?: string;
};

/** The toolbar's "Filter" control: opens FilterMenu, with a badge counting
 *  the active conditions. */
function FilterButton({ className, ...menuProps }: FilterButtonProps) {
  const active = menuProps.value.length;
  return (
    <FilterMenu align="start" {...menuProps}>
      <Button
        variant="ghost"
        size="sm"
        className={cn("px-2 data-[state=open]:bg-state-active", className)}
        aria-label={active ? `Filter, ${active} active` : "Filter"}
      >
        <ListFilter aria-hidden />
        Filter
        {active ? (
          <span
            aria-hidden
            className="inline-grid h-4 min-w-4 place-items-center rounded-full bg-foreground px-1 font-sans text-2xs font-semibold tabular-nums text-background"
          >
            {active}
          </span>
        ) : null}
      </Button>
    </FilterMenu>
  );
}

export type { FilterBarProps, FilterButtonProps, FilterChipProps, FilterMenuProps };
export { FilterBar, FilterButton, FilterChip, FilterMenu };
