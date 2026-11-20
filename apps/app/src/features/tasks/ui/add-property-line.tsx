// The quiet "+" line under a panel's properties (MOD-114, round-2b
// `.addprop`): the fields not shown yet, named on one line that never wraps,
// "+n" for the rest (call 42). The task details and the Project view share it
// (MOD-151: one solution across the module's panels). The whole line is one
// control: it opens a menu of every hidden field, and picking one adds its
// row, empty, with its editor open.

import { type LucideIcon, Plus } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { cn } from "../../../lib/utils";
import { namesThatFit } from "../detail-properties";

/** One field the line offers: its key, its name and its menu icon. */
export type AddPropertyItem<K extends string> = { key: K; label: string; icon: LucideIcon };

/**
 * "+ Energy · Scheduled · Reminder · +3": whole names, then "+n" for what
 * doesn't fit. A hidden copy of the names (clipped, so it never widens the
 * panel) gives their widths.
 */
export function AddPropertyLine<K extends string>({
  items,
  onPick,
}: {
  /** The hidden fields, in panel order. */
  items: readonly AddPropertyItem<K>[];
  onPick: (key: K) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const namesRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState(items.length);
  // The last count set, so a re-measure that changes nothing draws nothing.
  const fitRef = useRef(fit);
  // A pick opens its row's editor, which takes focus: the menu mustn't hand
  // it back to this line as it closes (gotchas/ui.md, SH-1's capture).
  const picked = useRef(false);
  const key = items.map((i) => i.key).join(" ");

  // Re-measure whenever the names change.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const button = buttonRef.current;
    const names = namesRef.current;
    const measure = measureRef.current;
    if (!box || !button || !names || !measure) return;
    // Fractional widths: offsetWidth rounds, and six rounded names can add
    // up to a pixel or two past the line.
    const width = (el: Element | null) => el?.getBoundingClientRect().width ?? 0;
    const run = () => {
      const widths = [...measure.querySelectorAll("[data-name]")].map(width);
      const more = width(measure.querySelector("[data-more]"));
      // The "+" and the button's padding take the rest of the line.
      const chrome = width(button) - width(names);
      const line = width(box);
      const room = line > 0 ? line - chrome : 0;
      const next = namesThatFit(room, widths, more);
      if (next !== fitRef.current) {
        fitRef.current = next;
        setFit(next);
      }
    };
    run();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(run);
    observer.observe(box);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [key]);

  const shown = items.slice(0, Math.min(fit, items.length));
  const rest = items.length - shown.length;
  // The name holds the words on the line (label in name, WCAG 2.5.3).
  const label = `Add a property: ${shown.map((i) => i.label).join(", ")}${
    rest > 0 ? `, +${rest}` : ""
  }`;
  const names = (list: readonly AddPropertyItem<K>[], measuring: boolean) =>
    list.map((item, i) => (
      <span key={item.key} data-name={measuring ? item.key : undefined} className="shrink-0">
        {i > 0 ? (
          <span aria-hidden className="px-1">
            ·
          </span>
        ) : null}
        {item.label}
      </span>
    ));

  return (
    <div ref={boxRef} className="relative flex min-w-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            ref={buttonRef}
            type="button"
            aria-label={label}
            className={cn(
              // PropertyValue's quiet control on the sm rung (round-2b `.addprop`).
              // It pulls out 4 px, not 6: the panel's scroll box pads 4, and
              // more would clip the hover fill.
              "-ml-1 flex min-h-(--ctrl-h-sm) min-w-0 max-w-full items-center gap-2 rounded-md px-1.5 py-0.5",
              "font-sans text-sm text-subtle-foreground outline-none",
              "transition-colors duration-(--motion-fade) ease-(--ease-out)",
              "hover:bg-state-hover hover:text-foreground aria-expanded:bg-state-active aria-expanded:text-foreground",
              "focus-visible:ring-2 focus-visible:ring-ring/50",
            )}
          >
            <Plus className="size-icon-sm shrink-0" aria-hidden />
            <span
              ref={namesRef}
              data-slot="add-property-names"
              className="flex min-w-0 items-center overflow-hidden whitespace-nowrap"
            >
              {names(shown, false)}
              {rest > 0 ? <span className="shrink-0 ps-1.5 tabular-nums">+{rest}</span> : null}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-48"
          onCloseAutoFocus={(e) => {
            if (!picked.current) return;
            picked.current = false;
            e.preventDefault();
          }}
        >
          {items.map(({ key: k, label: name, icon: Icon }) => (
            <DropdownMenuItem
              key={k}
              onSelect={() => {
                picked.current = true;
                onPick(k);
              }}
            >
              <Icon aria-hidden />
              {name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* The widths: every name and a "+n", laid out but unseen and clipped. */}
      <span aria-hidden className="pointer-events-none invisible absolute size-0 overflow-hidden">
        <span ref={measureRef} className="flex w-max font-sans text-sm whitespace-nowrap">
          {names(items, true)}
          <span data-more className="shrink-0 ps-1.5 tabular-nums">
            +{items.length}
          </span>
        </span>
      </span>
    </div>
  );
}
