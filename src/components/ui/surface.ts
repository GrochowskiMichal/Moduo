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
