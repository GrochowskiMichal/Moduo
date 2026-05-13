import { Plus, Search, Sparkles } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

import { dispatchOpenPalette } from "./global-command-palette";

type Props = {
  onCreate?: () => void;
};

function BarButton({
  onClick,
  label,
  children,
  accent,
}: {
  onClick?: () => void;
  label: string;
  children: React.ReactNode;
  accent?: "pink";
}) {
  const base =
    "flex h-8 w-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  const cls = accent
    ? `${base} bg-primary text-primary-foreground hover:brightness-110`
    : `${base} bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground`;
  return (
    <Tooltip>
      <TooltipTrigger
        className={cls}
        onClick={onClick}
        aria-label={label}
        data-accent={accent}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function GlobalBottomBar({ onCreate }: Props) {
  return (
    <div
      data-slot="global-bottom-bar"
      className="flex flex-row items-center justify-center gap-2"
      style={{ height: "var(--bar-h)" }}
      role="toolbar"
      aria-label="Global actions"
    >
      <BarButton accent="pink" label="Ask AI">
        <Sparkles className="size-4" aria-hidden />
      </BarButton>
      <BarButton onClick={() => dispatchOpenPalette()} label="Search">
        <Search className="size-4" aria-hidden />
      </BarButton>
      <BarButton onClick={onCreate} label="Create new">
        <Plus className="size-4" aria-hidden />
      </BarButton>
    </div>
  );
}
