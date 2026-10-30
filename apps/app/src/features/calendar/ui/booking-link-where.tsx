import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";

import { videoBlocker, type VideoSetting } from "../booking/video";
import { OptionChip } from "./booking-link-parts";

// "Where" in the booking link editor: one chip per video choice, and one quiet
// line under them only when the choice needs a login that isn't connected
// (Create link waits for it). Zoom choices show only once Zoom is set up here.

type Props = {
  video: VideoSetting;
  googleOn: boolean;
  zoom: { configured: boolean; connected: boolean };
  busy: boolean;
  onVideo: (video: VideoSetting) => void;
  onConnect: () => void;
  onConnectZoom: () => void;
  onDisconnectZoom: () => void;
};

export function BookingLinkWhere({
  video,
  googleOn,
  zoom,
  busy,
  onVideo,
  onConnect,
  onConnectZoom,
  onDisconnectZoom,
}: Props) {
  const zoomHere = zoom.configured || zoom.connected;
  const choices: { id: VideoSetting; label: string }[] = [
    { id: "google_meet", label: "Google Meet" },
    ...(zoomHere
      ? [
          { id: "zoom" as const, label: "Zoom" },
          { id: "guest_choice" as const, label: "Their choice" },
        ]
      : []),
  ];
  const blocker = videoBlocker(video, { google_meet: googleOn, zoom: zoom.connected });
  const needsGoogle = !googleOn && video !== "zoom";
  const needsZoom = !zoom.connected && video !== "google_meet";
  return (
    <section className="flex flex-col gap-2">
      <Eyebrow as="h2">Where</Eyebrow>
      <fieldset aria-label="Where" className="flex min-w-0 flex-wrap gap-1.5">
        {choices.map((choice) => (
          <OptionChip key={choice.id} on={video === choice.id} onClick={() => onVideo(choice.id)}>
            {choice.label}
          </OptionChip>
        ))}
      </fieldset>
      {blocker ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <p className="text-warning">{blocker}</p>
          {needsGoogle ? (
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onConnect}>
              Connect Google
            </Button>
          ) : null}
          {needsZoom ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={onConnectZoom}
            >
              Connect Zoom
            </Button>
          ) : null}
        </div>
      ) : zoom.connected && video !== "google_meet" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit text-muted-foreground"
          disabled={busy}
          onClick={onDisconnectZoom}
        >
          Disconnect Zoom
        </Button>
      ) : null}
    </section>
  );
}
