import { type OrbState, ThinkingOrb } from "thinking-orbs";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useRootAttribute } from "@/hooks/use-root-attribute";
import { cn } from "@/lib/utils";

/**
 * The long-wait mark, piloted on the data export (Libraries.dev `thinking-orbs`,
 * 2026-10-17): a small dotted orb in place of a spinner. Use it only for
 * waits of two seconds or more; shorter waits get no mark. Grey ink only,
 * never a hue (brand decision 40a). The words next to it say what's
 * happening, so the canvas is hidden from screen readers.
 *
 * - Size: by default the package's 20 px preset is drawn at the control
 *   rung's icon size (`icon-sm`, 14 px, DESIGN_RULES R1), so a button keeps
 *   its width when it swaps its icon for the orb, and density still applies.
 *   The package sets its size inline, hence the `!`. `size="tuned"` keeps the
 *   package's own 20 px.
 * - Theme: the package's `theme` names the background ("dark" draws light ink),
 *   so on a primary button, which inverts the page, the orb inverts too.
 * - Motion: frozen on one frame when Settings or the OS asks for reduced
 *   motion. The package also freezes on the OS setting by itself, so
 *   Settings' "Full" can't restart it while the OS says reduce.
 */
export function WaitOrb({
  state = "working",
  on = "surface",
  size = "control",
  className,
}: {
  /** Which animation plays: the package's names, e.g. `working`, `searching`, `connecting`. */
  state?: OrbState;
  /** What the orb sits on: the page or a card, or a primary (accent) button. */
  on?: "surface" | "primary";
  /** `control`: the 14 px icon rung. `tuned`: the package's own 20 px. */
  size?: "control" | "tuned";
  className?: string;
}) {
  const reduced = useReducedMotion();
  const page = useRootAttribute("data-theme") === "light" ? "light" : "dark";
  const background = on === "primary" ? (page === "light" ? "dark" : "light") : page;
  return (
    <ThinkingOrb
      state={state}
      size={20}
      theme={background}
      paused={reduced}
      aria-hidden
      data-slot="wait-orb"
      className={cn("shrink-0", size === "control" && "size-icon-sm!", className)}
    />
  );
}
