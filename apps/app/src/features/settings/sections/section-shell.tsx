import type { ReactNode } from "react";

import { cn } from "../../../lib/utils";

type Props = {
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
};

export function SettingsSectionShell({ title, description, className, children }: Props) {
  return (
    <div className={cn("mx-auto flex w-full max-w-3xl flex-col gap-6", className)}>
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-2xl text-foreground">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </header>
      {children}
    </div>
  );
}
