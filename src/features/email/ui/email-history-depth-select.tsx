/**
 * History-depth picker (IM-2c, AC6/AC8) — used at connect time and again per
 * account in Settings → Integrations.
 *
 * One component for both so the two surfaces can't drift on wording: the
 * asymmetry between raising and lowering the depth is not guessable from a
 * dropdown, and a picker that doesn't say "nothing is deleted" reads like it
 * might delete mail.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import {
  asHistoryDepth,
  describeDepthChange,
  EMAIL_HISTORY_DEPTHS,
  historyDepthLabel,
  type EmailHistoryDepth,
} from "../history-depth";

type Props = {
  value: EmailHistoryDepth;
  onChange: (depth: EmailHistoryDepth) => void;
  disabled?: boolean;
  /** The stored depth, when this is an edit — drives the consequence line. */
  committed?: EmailHistoryDepth;
  /** A note to keep showing after a change has committed (the draft is gone by
   *  then, so `committed` alone would silently drop the reassurance). */
  note?: string;
  id?: string;
};

export function EmailHistoryDepthSelect({
  value,
  onChange,
  disabled,
  committed,
  note,
  id,
}: Props) {
  const consequence = (committed ? describeDepthChange(committed, value) : null) ?? note ?? null;

  return (
    <div className="space-y-1">
      <Select
        value={value}
        onValueChange={(next) => onChange(asHistoryDepth(next))}
        disabled={disabled}
      >
        {/* No `aria-label` here: on a combobox the label REPLACES the content, so
            it would suppress the selected value. Both call sites supply a visible
            <label htmlFor>. */}
        <SelectTrigger className="w-44" id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EMAIL_HISTORY_DEPTHS.map((depth) => (
            <SelectItem key={depth} value={depth}>
              {historyDepthLabel(depth)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* Reserve the line's space so committing a change doesn't reflow the row. */}
      <p className="min-h-4 text-xs text-muted-foreground" role="status">
        {consequence}
      </p>
    </div>
  );
}
