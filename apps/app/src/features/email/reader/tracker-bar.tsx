// The tracker bar above an HTML message (specs/mail-v3.md §8, AC25): shown only
// when remote images are blocked or trackers were stripped. "**{n} trackers
// blocked** · images off", Load images (this message), Always (this sender, on
// this Mac: the engine's `images_allow:<address>`), and at the end, in dark
// mode, the Original colours toggle.

import { Eye, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

export type TrackerBarProps = {
  trackers: number;
  /** Remote images still blocked (0 once they load). */
  imagesBlocked: number;
  senderName: string;
  onLoadImages: () => void;
  /** Absent when the engine can't remember senders. */
  onAlways?: () => void;
  /** Dark mode and HTML mail: the toggle between Moduo's dark surface and the mail's own colours. */
  colours?: { original: boolean; onToggle: () => void } | null;
};

const trackerWords = (n: number) => `${n} tracker${n === 1 ? "" : "s"} blocked`;

function ColoursToggle({ colours }: { colours: NonNullable<TrackerBarProps["colours"]> }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-pressed={colours.original}
      title="This message is drawn on Moduo's dark surface"
      onClick={colours.onToggle}
    >
      <Eye aria-hidden />
      {colours.original ? "Back to dark" : "Original colours"}
    </Button>
  );
}

export function TrackerBar({
  trackers,
  imagesBlocked,
  senderName,
  onLoadImages,
  onAlways,
  colours,
}: TrackerBarProps) {
  const shield = trackers > 0 || imagesBlocked > 0;
  if (!shield && !colours) return null;
  if (!shield && colours) {
    return (
      <div className="flex justify-end">
        <ColoursToggle colours={colours} />
      </div>
    );
  }
  return (
    <div
      role="status"
      aria-label="Privacy"
      className="flex min-w-0 items-center gap-2 rounded-md bg-tag-chip-surface py-1 pr-1 pl-2.5 text-xs text-muted-foreground"
    >
      <ShieldCheck aria-hidden className="size-icon-sm shrink-0" />
      <span
        className="min-w-0 flex-1 truncate"
        title={`Remote images are off, so ${senderName} can't tell you opened this.`}
      >
        {trackers > 0 ? (
          <b className="font-medium text-foreground">{trackerWords(trackers)}</b>
        ) : null}
        {trackers > 0 && imagesBlocked > 0 ? " · " : null}
        {imagesBlocked > 0 ? "images off" : null}
      </span>
      {imagesBlocked > 0 ? (
        <>
          <Button size="sm" variant="ghost" onClick={onLoadImages}>
            Load images
          </Button>
          {onAlways ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Always load images from ${senderName}`}
              onClick={onAlways}
            >
              Always
            </Button>
          ) : null}
        </>
      ) : null}
      {colours ? <ColoursToggle colours={colours} /> : null}
    </div>
  );
}
