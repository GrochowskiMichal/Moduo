// A row's flags (specs/mail-v3.md §3): at most three, then "+N" naming the
// rest. Glyph flags carry their label for screen readers; state flags
// ("Not sent", "Sending…", "Back", "New reply") show their word.

import {
  AlertCircle,
  BellOff,
  CalendarDays,
  Clock3,
  FileText,
  Hourglass,
  type LucideIcon,
  Paperclip,
  Pin,
  Send,
  SquareCheck,
  Star,
  WifiOff,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { type MailRowFlag, type MailRowFlagId, visibleFlags } from "./mail-row-model";

const ICON: Record<MailRowFlagId, LucideIcon> = {
  not_sent: AlertCircle,
  outbox: Send,
  new_reply: Clock3,
  back: Clock3,
  waiting: Hourglass,
  priority: Star,
  pinned: Pin,
  task: SquareCheck,
  note: FileText,
  invite: CalendarDays,
  attachment: Paperclip,
  muted: BellOff,
  snoozed: Clock3,
};

const TONE = {
  destructive: "text-destructive",
  warning: "text-warning",
} as const;

function Flag({ flag }: { flag: MailRowFlag }) {
  const Icon =
    flag.id === "outbox" && flag.text === "Waiting for connection" ? WifiOff : ICON[flag.id];
  const tone = flag.tone ? TONE[flag.tone] : "text-muted-foreground";
  if (flag.text) {
    return (
      <span
        data-flag={flag.id}
        title={flag.label === flag.text ? undefined : flag.label}
        className={cn("inline-flex shrink-0 items-center gap-0.5 text-xs whitespace-nowrap", tone)}
      >
        <Icon aria-hidden className="size-3" />
        {flag.text}
      </span>
    );
  }
  return (
    <span data-flag={flag.id} title={flag.label} className={cn("inline-flex shrink-0", tone)}>
      <Icon aria-label={flag.label} className="size-3.5" />
    </span>
  );
}

export function MailRowFlags({ flags }: { flags: readonly MailRowFlag[] }) {
  if (flags.length === 0) return null;
  const { shown, hidden } = visibleFlags(flags);
  return (
    <span data-row-flags className="flex shrink-0 items-center gap-1">
      {shown.map((f) => (
        <Flag key={f.id} flag={f} />
      ))}
      {hidden.length > 0 ? (
        <span
          data-flag-more
          title={hidden.map((f) => f.label).join(", ")}
          className="text-xs text-muted-foreground tabular-nums"
        >
          +{hidden.length}
          <span className="sr-only">, {hidden.map((f) => f.label).join(", ")}</span>
        </span>
      ) : null}
    </span>
  );
}
