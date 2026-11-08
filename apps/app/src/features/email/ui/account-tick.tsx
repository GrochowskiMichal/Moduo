// The account marker (specs/mail-improve.md §2, AC5): a small filled 4×10 px tick in the
// account's hue, the same on list rows and in the rail. Shown only with more than one
// account; its tooltip names the account (screen readers hear the name in the row's).

import type { LabelColor } from "@/components/tag-colors";
import { cn } from "@/lib/utils";

export function AccountTick({
  hue,
  name,
  dim = false,
}: {
  hue: LabelColor;
  name: string;
  /** Read rows: half strength. */
  dim?: boolean;
}) {
  return (
    <span
      aria-hidden
      data-account-tick
      data-label={hue}
      title={name}
      className={cn("tag-dot h-2.5 w-1 shrink-0 rounded-full", dim && "opacity-50")}
    />
  );
}
