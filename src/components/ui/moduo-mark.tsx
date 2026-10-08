import type * as React from "react";

import { cn } from "@/lib/utils";

import {
  MODUO_MARK_PATHS,
  MODUO_MARK_SMALL_PATHS,
  MODUO_MARK_SMALL_VIEWBOX,
  MODUO_MARK_VIEWBOX,
} from "./moduo-mark-path";

type Props = React.SVGProps<SVGSVGElement> & {
  title?: string;
  /**
   * Use the small-size drawing (opened windows). Only for a mark displayed
   * under 24 px (brand decision 13); identical to the standard mark until the
   * small master exists.
   */
  small?: boolean;
};

/**
 * The moduo logomark as an inline SVG. Fills with `currentColor`, so wrapping
 * it in any text-color utility (e.g. `text-foreground`) makes it theme-adaptive
 * without needing two separate raster files. The path comes from the brand
 * master (brand/masters/mark.svg) via `bun run brand:export`; never edit it here.
 */
export function ModuoMark({
  className,
  title = "moduo",
  small = false,
  "aria-hidden": ariaHidden,
  ...props
}: Props) {
  const isDecorative = ariaHidden === true || ariaHidden === "true";
  const paths = small ? MODUO_MARK_SMALL_PATHS : MODUO_MARK_PATHS;
  return (
    <svg
      viewBox={small ? MODUO_MARK_SMALL_VIEWBOX : MODUO_MARK_VIEWBOX}
      xmlns="http://www.w3.org/2000/svg"
      className={cn("text-foreground", className)}
      role={isDecorative ? undefined : "img"}
      aria-hidden={ariaHidden}
      aria-label={isDecorative ? undefined : title}
      {...props}
    >
      {!isDecorative ? <title>{title}</title> : null}
      {paths.map((p) => (
        <path key={p.d} fill="currentColor" fillRule={p.fillRule} clipRule={p.fillRule} d={p.d} />
      ))}
    </svg>
  );
}
