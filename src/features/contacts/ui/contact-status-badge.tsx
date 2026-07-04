// Contact status — color + label, never color alone (AC12, DESIGN_RULES R-color).
// A small dot in the status tone plus the (renamable) label. The dot carries a
// tooltip-able title so the dense directory dot is still legible.

import { cn } from "@/lib/utils";
import { contactStatusMeta, type ContactStatusTone } from "../status";

/** Status tone → the semantic token that tints the dot (never a raw hue). */
const TONE_DOT: Record<ContactStatusTone, string> = {
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  muted: "bg-muted-foreground",
};

export function ContactStatusDot({ status, className }: { status: string; className?: string }) {
  const meta = contactStatusMeta(status);
  return (
    <span
      className={cn("inline-block size-2 shrink-0 rounded-full", TONE_DOT[meta.tone], className)}
      title={meta.label}
      aria-label={`Status: ${meta.label}`}
    />
  );
}

export function ContactStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = contactStatusMeta(status);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm text-muted-foreground", className)}>
      <span className={cn("inline-block size-2 shrink-0 rounded-full", TONE_DOT[meta.tone])} aria-hidden />
      {meta.label}
    </span>
  );
}
