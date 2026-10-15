import { HoverCard as HoverCardPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";
import { FLOATING_SURFACE } from "./surface";

/*
 * HoverCard — shadcn's hover card on Radix, on the one floating surface
 * (surface.ts). A preview that opens on hover intent (Radix waits
 * `openDelay` before it opens and `closeDelay` before it closes, so moving the
 * pointer onto the card keeps it). References use it for their preview
 * (tasks-v3 §11: "hover preview: the card"). Keyboard focus on the trigger
 * opens it too. Nothing in it should be the only way to do something: it is a
 * preview, and touch has no hover.
 */

function HoverCard({
  openDelay = 300,
  closeDelay = 150,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return (
    <HoverCardPrimitive.Root
      data-slot="hover-card"
      openDelay={openDelay}
      closeDelay={closeDelay}
      {...props}
    />
  );
}

function HoverCardTrigger({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />;
}

function HoverCardContent({
  className,
  align = "start",
  sideOffset = 6,
  style,
  container,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content> & {
  /** Where the surface mounts (default: the body). */
  container?: HTMLElement | null;
}) {
  return (
    <HoverCardPrimitive.Portal container={container ?? undefined}>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(FLOATING_SURFACE, "w-80 p-3 outline-none", className)}
        style={{
          zIndex: "var(--z-popover)",
          boxShadow: "var(--shadow-md)",
          ...style,
        }}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
