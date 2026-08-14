import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * The title of an entity detail surface — a task, event, contact, company or
 * mail thread. Before DF-18 the same object carried five type scales across six
 * surfaces (13px → 30px, half of them on the display face); this is the single
 * scale, split only by the two panel genres that genuinely differ in width:
 *
 * - `rail` — the 320px right-hand inspector (task / event / thread reader).
 * - `page` — a centered `max-w-2xl` hub read as a record page (contact / company).
 *
 * Body face, not display: R4 files an entity's own name under **content**
 * ("task/note titles"), the same bucket as its description. Chrome headings
 * (page headers, settings sections) stay `font-display` and do NOT use this.
 *
 * Titles are often an editable `Input`; pass `asChild` to keep this recipe on
 * the control instead of wrapping it.
 */
const detailTitleVariants = cva("text-foreground font-sans", {
  variants: {
    size: {
      // Medium weight, not size, is what holds the title above the 13–14px meta
      // lines packed around it in a 320px rail (2 of the 3 rails already had it).
      rail: "text-md font-medium",
      page: "text-2xl",
    },
  },
  defaultVariants: { size: "rail" },
});

type DetailTitleProps = React.ComponentProps<"h2"> &
  VariantProps<typeof detailTitleVariants> & {
    asChild?: boolean;
  };

function DetailTitle({ className, size, asChild = false, ...props }: DetailTitleProps) {
  const Comp = asChild ? Slot.Root : "h2";
  return (
    <Comp
      data-slot="detail-title"
      className={cn(detailTitleVariants({ size }), className)}
      {...props}
    />
  );
}

export { DetailTitle, detailTitleVariants };
