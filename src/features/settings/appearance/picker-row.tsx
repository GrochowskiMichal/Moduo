import type { ReactNode } from "react";

import { cn } from "../../../lib/utils";

type Props = {
  title: string;
  description?: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
};

export function AppearancePickerRow({ title, description, htmlFor, className, children }: Props) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-border py-5 first:pt-0 last:border-b-0 last:pb-0",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
            {title}
          </label>
        ) : (
          <span className="text-sm font-medium text-foreground">{title}</span>
        )}
        {description ? (
          <span className="text-xs text-muted-foreground">{description}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
