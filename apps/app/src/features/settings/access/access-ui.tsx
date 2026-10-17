import type { ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "../../../components/ui/avatar";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";

export function PersonAvatar({
  name,
  avatarUrl,
  size = "sm",
  className,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: "sm" | "default";
  className?: string;
}) {
  const letter = name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <Avatar size={size} className={cn("shrink-0", className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
      <AvatarFallback>{letter}</AvatarFallback>
    </Avatar>
  );
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** The pane header: title row + supporting line + right-aligned actions. */
export function PaneHeader({
  leading,
  title,
  subtitle,
  actions,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      {leading}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2 font-display text-base text-foreground">
          {title}
        </div>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

/** The plain-language "why" strip under a matrix. */
export function ExplainStrip({ children }: { children: ReactNode }) {
  return (
    <p
      aria-live="polite"
      className="min-h-10 rounded-md bg-muted px-3 py-2.5 text-sm text-muted-foreground"
    >
      {children}
    </p>
  );
}

/** Sticky footer that appears only with unsaved changes. */
export function SaveBar({
  dirty,
  saving,
  impact,
  error,
  onDiscard,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  impact?: string | null;
  error?: string | null;
  onDiscard: () => void;
  onSave: () => void;
}) {
  if (!dirty && !error) return null;
  return (
    <div className="sticky bottom-0 -mx-1 flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm text-foreground">{error ? "Not saved" : "Unsaved changes"}</span>
        {error ? (
          <span className="text-xs text-destructive">{error}</span>
        ) : impact ? (
          <span className="truncate text-xs text-muted-foreground">{impact}</span>
        ) : null}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
        Discard
      </Button>
      <Button type="button" size="sm" onClick={onSave} disabled={saving || !dirty}>
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

/** Turn an op/RLS error into a sentence a person can act on. */
export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (/row-level security/i.test(raw)) return "Your role doesn't allow this.";
  if (/function .* does not exist|could not find the function/i.test(raw)) {
    return "This needs the latest Moduo update. Reload and try again.";
  }
  return raw || "Something went wrong. Try again.";
}
