// The offer card in the right panel (CALR-19, AC34): the message as it will be
// copied, the hold choice, Copy link (⌘C) / Copy as text (⇧⌘C) and, once the
// offer holds times, Release holds. Presentational: use-offer-mode.tsx acts.

import { useId } from "react";

import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { Kbd } from "../../../components/ui/kbd";
import { OFFER_HOLD_HOURS, offerText } from "../booking/offer";

export type OfferCardProps = {
  title: string;
  durationMinutes: number;
  timeZone: string;
  picks: number[];
  /** The offer's link once made (the first copy makes it). */
  url: string | null;
  hold: boolean;
  onHoldChange: (hold: boolean) => void;
  onCopyLink: () => void;
  onCopyText: () => void;
  onRelease?: () => void;
};

export function OfferCard(props: OfferCardProps) {
  const id = useId();
  const { picks, url } = props;
  const text = offerText({ ...props, url: url ?? "the link it makes" });
  return (
    <div className="flex flex-col gap-3 px-1 py-2">
      <h2 className="font-display text-lg font-medium text-foreground">
        Offer times · {props.title}
      </h2>
      {picks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Pick times on the week: <Kbd>↵</Kbd> adds, <Kbd>⇥</Kbd> next, <Kbd>⌫</Kbd> removes the
          last.
        </p>
      ) : (
        <p className="flex flex-col rounded-md bg-muted p-3 text-base text-foreground">
          {text.split("\n").map((line) => (
            <span key={line}>{line}</span>
          ))}
        </p>
      )}
      {url ? <span className="truncate text-sm text-muted-foreground">{url}</span> : null}
      <span className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={props.hold}
          disabled={url != null}
          onCheckedChange={(on) => props.onHoldChange(on === true)}
        />
        <label htmlFor={id} className="text-sm text-foreground">
          Hold them on your calendar until one is picked ({OFFER_HOLD_HOURS} hours)
        </label>
      </span>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={picks.length === 0} onClick={props.onCopyLink}>
          Copy link <Kbd>⌘C</Kbd>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={picks.length === 0}
          onClick={props.onCopyText}
        >
          Copy as text <Kbd>⇧⌘C</Kbd>
        </Button>
        {url && props.hold && props.onRelease ? (
          <Button type="button" variant="ghost" size="sm" onClick={props.onRelease}>
            Release holds
          </Button>
        ) : null}
      </div>
    </div>
  );
}
