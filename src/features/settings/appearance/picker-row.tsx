import type { ReactNode } from "react";

import { cn } from "../../../lib/utils";

type Props = {
  title: string;
  description?: string;
  htmlFor?: string;
  /** A small qualifier shown next to the title, e.g. "This device" for
   *  per-device settings that don't sync across your devices. */
  tag?: string;
  className?: string;
  children: ReactNode;
};

export function AppearancePickerRow({
  title,
  description,
  htmlFor,
  tag,
  className,
  children,
}: Props) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-border py-5 first:pt-0 last:border-b-0 last:pb-0",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          {htmlFor ? (
            <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
              {title}
            </label>
          ) : (
            <span className="text-sm font-medium text-foreground">{title}</span>
          )}
          {tag ? (
            <span className="rounded-full border border-border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              {tag}
            </span>
          ) : null}
        </div>
        {description ? (
          <span className="text-xs text-muted-foreground">{description}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
