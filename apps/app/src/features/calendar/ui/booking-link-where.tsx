import { Shuffle, Video, Webcam } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ModuoMark } from "@/components/ui/moduo-mark";
import { SELECTED_OPTION } from "@/components/ui/selection";
import { cn } from "@/lib/utils";

import type { VideoSetting } from "../booking/video";

// "Where" in the booking link editor: one option card per video choice, and
// the quiet connect lines (Google for Meet, Zoom) under them.

type VideoRow = {
  id: VideoSetting | "moduo_video";
  label: string;
  hint: string;
  mark: ReactNode;
  disabled?: boolean;
};

const MARK = "size-icon-sm";

function videoRows(
  googleOn: boolean,
  zoom: { configured: boolean; connected: boolean },
): VideoRow[] {
  const zoomHint = zoom.connected
    ? "Connected"
    : zoom.configured
      ? "Connect your Zoom account to use it"
      : "Not available yet";
  const choiceHint =
    googleOn && zoom.connected
      ? "The person booking picks Google Meet or Zoom"
      : googleOn
        ? "Connect Zoom too, or guests will only see Google Meet"
        : zoom.connected
          ? "Connect Google too, or guests will only see Zoom"
          : "The person booking picks Google Meet or Zoom";
  return [
    {
      id: "google_meet",
      label: "Google Meet",
      hint: googleOn ? "Connected" : "Needs Google",
      mark: <Video aria-hidden className={MARK} />,
    },
    {
      id: "zoom",
      label: "Zoom",
      hint: zoomHint,
      mark: <Webcam aria-hidden className={MARK} />,
      disabled: !zoom.configured && !zoom.connected,
    },
    {
      id: "guest_choice",
      label: "Their choice",
      hint: choiceHint,
      mark: <Shuffle aria-hidden className={MARK} />,
      disabled: !zoom.configured && !zoom.connected,
    },
    {
      id: "moduo_video",
      label: "Moduo video",
      hint: "Later",
      mark: <ModuoMark aria-hidden small className={cn(MARK, "text-muted-foreground")} />,
      disabled: true,
    },
  ];
}

function ConnectLine({
  text,
  action,
  busy,
  onClick,
}: {
  text: string;
  action: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2">
      <p className="text-sm text-muted-foreground">{text}</p>
      <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onClick}>
        {action}
      </Button>
    </div>
  );
}

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
  const needsGoogle =
    !googleOn && (video === "google_meet" || (video === "guest_choice" && !zoom.connected));
  const needsZoom = !zoom.connected && zoom.configured && video !== "google_meet";
  return (
    <section className="flex flex-col gap-2">
      <Eyebrow as="h2">Where</Eyebrow>
      <fieldset aria-label="Where" className="min-w-0 grid grid-cols-4 gap-2">
        {videoRows(googleOn, zoom).map((choice) => {
          const on = video === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              aria-pressed={on}
              disabled={choice.disabled}
              onClick={() => onVideo(choice.id as VideoSetting)}
              className={cn(
                "flex min-w-0 flex-col items-start gap-1.5 rounded-lg border border-hairline p-3 text-left outline-none",
                "transition-colors duration-(--motion-fade) ease-(--ease-out)",
                "focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
                on ? cn(SELECTED_OPTION, "hover:bg-state-selected-hover") : "hover:bg-state-hover",
              )}
            >
              <span className="flex size-6 items-center justify-center rounded-md bg-state-active text-foreground">
                {choice.mark}
              </span>
              <span className="font-display text-base text-foreground">{choice.label}</span>
              <span className="text-xs leading-snug text-muted-foreground">{choice.hint}</span>
            </button>
          );
        })}
      </fieldset>
      {needsGoogle ? (
        <ConnectLine
          text="Connect Google so this link can create a Meet while the app is closed."
          action="Connect Google"
          busy={busy}
          onClick={onConnect}
        />
      ) : null}
      {needsZoom ? (
        <ConnectLine
          text="Zoom meetings are made on your Zoom account."
          action="Connect Zoom"
          busy={busy}
          onClick={onConnectZoom}
        />
      ) : null}
      {zoom.connected ? (
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
