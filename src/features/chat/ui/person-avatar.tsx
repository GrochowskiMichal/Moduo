// A workspace person's avatar with an optional presence dot. Monochrome
// initials fallback (accent is reserved — DESIGN_RULES R5); online = the
// success status token, offline = a hollow ring, never color alone (the
// tooltip/aria label says it in words).

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { ChatPerson } from "../model";

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function PresenceDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "block size-2 shrink-0 rounded-full ring-2 ring-card",
        online ? "bg-success" : "border border-muted-foreground/60 bg-card",
        className,
      )}
      aria-hidden
    />
  );
}

export function PersonAvatar({
  person,
  size = "default",
  online,
  className,
}: {
  person: ChatPerson | undefined;
  size?: "sm" | "default" | "lg";
  /** undefined = don't show presence at all. */
  online?: boolean;
  className?: string;
}) {
  const name = person?.name ?? "Former member";
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <Avatar size={size}>
        {person?.avatarUrl ? <AvatarImage src={person.avatarUrl} alt="" /> : null}
        <AvatarFallback className="font-display">{initialsOf(name)}</AvatarFallback>
      </Avatar>
      {online === undefined ? null : (
        <PresenceDot online={online} className="absolute -right-0.5 -bottom-0.5" />
      )}
    </span>
  );
}
