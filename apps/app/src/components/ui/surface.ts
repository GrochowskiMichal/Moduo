// The one floating-surface recipe (DS-6, tasks-v3 AC14.3; visual audit B12,
// the prototypes' `.menu`). Every popover, dropdown menu, context menu, select
// list and tooltip is the popover background with a 1 px hairline edge, the
// control radius and the `motion-pop` arrival (it grows from where it was
// opened). Size, padding and the shadow token stay with each primitive.
// Before DS-6 there were two: `rounded-md border-border` on the Radix menus and
// `rounded-lg border-hairline` on FilterBar, DisplayMenu and the tooltip's
// tw-animate entrance. `src/components/ui/surface.test.ts` fails on a third.

/** Popover, menu, select list and tooltip surface. */
export const FLOATING_SURFACE =
  "motion-pop rounded-md border border-hairline bg-popover text-popover-foreground";

/**
 * A menu never runs past the window: it caps at the room Radix measures on its
 * side and scrolls inside (DS-6; a long project picker was cut off at the
 * window's edge). The select list does the same through its own viewport.
 */
export const DROPDOWN_MENU_SCROLL =
  "max-h-(--radix-dropdown-menu-content-available-height) overflow-x-hidden overflow-y-auto";
export const CONTEXT_MENU_SCROLL =
  "max-h-(--radix-context-menu-content-available-height) overflow-x-hidden overflow-y-auto";
