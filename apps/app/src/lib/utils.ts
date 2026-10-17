import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge only knows Tailwind's own shadow scale, so it files our named
// @theme shadows (tokens.css) under shadow COLOUR: cn("shadow-control-raised",
// "shadow-none") kept both and the winner fell to CSS order. Teaching it the
// names makes an override replace them like any other shadow size.
const twMerge = extendTailwindMerge({
  extend: { theme: { shadow: ["control-raised", "overlay"] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
