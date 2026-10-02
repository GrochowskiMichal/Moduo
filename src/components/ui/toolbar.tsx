import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Layout primitive for an aligned control row — NOT new controls. Enforces one
 * height baseline, one gap, and a consistent left→right rhythm so a row of
 * mixed controls (Button, SegmentedControl, Select, IconButton) reads as one
 * toolbar instead of "stitched from different systems". Put view-shaping
 * controls in `Toolbar.Group` (left), then `Toolbar.Spacer`, then the primary
 * action via `Toolbar.Primary` (right). Keep every child on ONE control rung
 * (e.g. all `size="sm"`).
 *
 * DF-18 added the `gap` axis: every hand-rolled row this replaced ran tighter
 * than the default (`gap-0.5` for a prev/next icon pair, `gap-1` inside a
 * 256px rail). Without it, migration meant a `className="gap-1"` override at
 * every call site — i.e. a primitive that enforces nothing. Pick a step; don't
 * pass a raw `gap-*` class.
 */
const toolbarGapVariants = cva("flex items-center", {
  variants: {
    gap: {
      /** Adjacent icon buttons that read as one control (prev/next). */
      tight: "gap-0.5",
      /** Narrow rails where the default would overflow. */
      snug: "gap-1",
      default: "gap-1.5",
      /** The row itself: groups sit further apart than controls within a group. */
      row: "gap-2",
    },
  },
  // Matches `Toolbar`'s own default — the groups pass "default" explicitly, so
  // a bare `toolbarGapVariants()` never renders a row tighter than a real one.
  defaultVariants: { gap: "row" },
});

type ToolbarGap = NonNullable<VariantProps<typeof toolbarGapVariants>["gap"]>;

const ITEM_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * A nested widget that already runs its OWN roving focus (radix ToggleGroup,
 * RadioGroup, Tabs). It is ONE toolbar stop and it owns its arrow keys — the
 * toolbar must delegate rather than fight it.
 */
const NESTED_ROVING = '[data-slot="segmented-control"],[role="radiogroup"],[role="tablist"]';

/** Elements that consume arrow keys themselves — never steal from them. */
const OWNS_ARROWS = `${NESTED_ROVING},input,textarea,select,[contenteditable="true"]`;

/**
 * Deliberately NOT an `offsetParent` check: that reads as "invisible" for every
 * element under jsdom, which would silently turn the whole roving behaviour into
 * a no-op in tests while looking fine in the browser.
 *
 * The hidden-ancestor walk stops AT the toolbar: the app shell wraps panes in
 * `aria-hidden` wrappers that a document-wide `closest()` picks up (live-caught
 * on the calendar pane), and whether the surrounding surface is hidden is not
 * this row's business — if the toolbar renders at all, its controls are stops.
 */
function isReachable(el: HTMLElement, root: HTMLElement) {
  for (
    let node: HTMLElement | null = el;
    node && node !== root.parentElement;
    node = node.parentElement
  ) {
    if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true") return false;
  }
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

/**
 * `role="toolbar"` is a promise: one tab stop, arrows move between the controls.
 * Before DF-18 the primitive made the announcement without keeping it, so a
 * screen-reader user pressing Arrow got whatever the surrounding surface did
 * (in Contacts, the list selection moved underneath them). This keeps it.
 *
 * A nested roving widget (a `SegmentedControl`) counts as a single stop and
 * keeps its own arrow handling — you tab out of one, you don't arrow out.
 */
function useRovingFocus(ref: React.RefObject<HTMLDivElement | null>) {
  const activeRef = React.useRef<HTMLElement | null>(null);

  const items = React.useCallback((): HTMLElement[] => {
    const root = ref.current;
    if (!root) return [];
    const seenGroups = new Set<Element>();
    const out: HTMLElement[] = [];
    for (const el of root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) {
      if (!isReachable(el, root)) continue;
      const group = el.closest<HTMLElement>(NESTED_ROVING);
      if (group) {
        if (seenGroups.has(group)) continue;
        seenGroups.add(group);
        // The widget's own roving winner is the stop. Before anything inside it
        // has been focused that winner is the group ROOT (radix parks tabindex
        // there), and missing that left the toolbar with two tab stops.
        out.push(
          group.querySelector<HTMLElement>('[tabindex="0"]') ??
            (group.matches(ITEM_SELECTOR) ? group : el),
        );
        continue;
      }
      out.push(el);
    }
    return out;
  }, [ref]);

  const sync = React.useCallback(() => {
    const list = items();
    if (list.length === 0) return;
    // If the remembered item unmounted or was disabled, fall back to the first —
    // a toolbar must never end up with zero tab stops.
    const active =
      activeRef.current && list.includes(activeRef.current) ? activeRef.current : list[0];
    activeRef.current = active;
    for (const el of list) {
      const next = el === active ? 0 : -1;
      // Write ONLY on change: the observer below watches `tabindex`, so an
      // unconditional assignment would re-trigger itself forever.
      if (el.tabIndex !== next) el.tabIndex = next;
    }
    // A nested roving widget can be tabbable at BOTH its root and its current
    // item (radix keeps the root at 0 as an entry point). Whichever of the two
    // isn't the toolbar's stop has to leave the tab order, or the row quietly
    // has two — live-caught on the Contacts directory row.
    const root = ref.current;
    if (root) {
      for (const group of root.querySelectorAll<HTMLElement>(NESTED_ROVING)) {
        if (!list.includes(group) && group.tabIndex === 0) group.tabIndex = -1;
      }
    }
  }, [items, ref]);

  React.useLayoutEffect(sync);

  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Nested roving widgets park their own tabindex in an effect AFTER our
    // layout effect, and a conditionally-rendered control changes the item list
    // without re-rendering the toolbar — both need re-syncing from the DOM.
    const observer = new MutationObserver(() => sync());
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["tabindex", "disabled", "hidden", "aria-hidden"],
    });
    return () => observer.disconnect();
  }, [ref, sync]);

  const onFocusCapture = React.useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const list = items();
      const target = event.target as HTMLElement;
      const hit = list.find((el) => el === target || el.contains(target));
      if (hit) {
        activeRef.current = hit;
        sync();
      }
    },
    [items, sync],
  );

  /** Step the toolbar's own stops. `from` may be a nested widget's root. */
  const step = React.useCallback(
    (key: string, from: HTMLElement) => {
      const list = items();
      if (list.length === 0) return false;
      const current = list.findIndex((el) => el === from || el.contains(from) || from.contains(el));
      if (current === -1) return false;
      const next =
        key === "Home"
          ? 0
          : key === "End"
            ? list.length - 1
            : key === "ArrowRight"
              ? (current + 1) % list.length
              : (current - 1 + list.length) % list.length;
      activeRef.current = list[next];
      sync();
      list[next].focus();
      return true;
    },
    [items, sync],
  );

  /**
   * Capture phase, and only for a nested roving widget sitting at its own edge.
   * Those widgets loop internally, so once focus entered the view switcher there
   * was no arrow key that got back out — live-caught on the Tasks plan header,
   * where it left the primary "New" button unreachable by keyboard entirely.
   * Intercepting before the widget sees the key turns its edge into the exit.
   */
  const onKeyDownCapture = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      const group = target?.closest<HTMLElement>(NESTED_ROVING);
      if (!group || !ref.current?.contains(group)) return;

      const inner = [...group.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
      const index = inner.findIndex((el) => el === target || el.contains(target));
      if (index === -1) return;
      const exiting = event.key === "ArrowRight" ? index === inner.length - 1 : index === 0;
      if (!exiting) return;

      event.preventDefault();
      event.stopPropagation();
      step(event.key, group);
    },
    [ref, step],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      // Inside a widget that owns arrows, the capture handler above already
      // decided whether this key is an exit; anything left is the widget's.
      if (target?.closest(OWNS_ARROWS)) return;
      if (!target) return;

      if (step(event.key, target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    [step],
  );

  return { onFocusCapture, onKeyDown, onKeyDownCapture };
}

function Toolbar({
  className,
  children,
  gap = "row",
  onKeyDown,
  onKeyDownCapture,
  onFocusCapture,
  ref,
  ...props
}: React.ComponentProps<"div"> & { gap?: ToolbarGap }) {
  const innerRef = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(ref, () => innerRef.current as HTMLDivElement);
  const roving = useRovingFocus(innerRef);

  return (
    <div
      ref={innerRef}
      role="toolbar"
      data-slot="toolbar"
      className={cn(toolbarGapVariants({ gap }), className)}
      onFocusCapture={(event) => {
        roving.onFocusCapture(event);
        onFocusCapture?.(event);
      }}
      onKeyDownCapture={(event) => {
        roving.onKeyDownCapture(event);
        onKeyDownCapture?.(event);
      }}
      onKeyDown={(event) => {
        roving.onKeyDown(event);
        onKeyDown?.(event);
      }}
      {...props}
    >
      {children}
    </div>
  );
}

function ToolbarGroup({
  className,
  gap = "default",
  ...props
}: React.ComponentProps<"div"> & { gap?: ToolbarGap }) {
  return (
    <div
      data-slot="toolbar-group"
      className={cn(toolbarGapVariants({ gap }), className)}
      {...props}
    />
  );
}

function ToolbarSpacer() {
  return <div className="flex-1" aria-hidden />;
}

function ToolbarPrimary({
  className,
  gap = "default",
  ...props
}: React.ComponentProps<"div"> & { gap?: ToolbarGap }) {
  return (
    <div
      data-slot="toolbar-primary"
      className={cn(toolbarGapVariants({ gap }), className)}
      {...props}
    />
  );
}

Toolbar.Group = ToolbarGroup;
Toolbar.Spacer = ToolbarSpacer;
Toolbar.Primary = ToolbarPrimary;

export { Toolbar, toolbarGapVariants };
