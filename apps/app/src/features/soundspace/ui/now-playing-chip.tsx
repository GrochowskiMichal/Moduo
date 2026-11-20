// The top-bar chip for a Soundspace that is playing (or paused, after it
// played): moving bars and the mix's name, so the space can be paused from any
// module. It also owns the engine's life: when the app shell goes away
// (sign-out, or a workspace switch remounting the chrome), the sound stops.

import { Pause, Play } from "lucide-react";
import { useEffect } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { voiceCount } from "../model";
import { pauseSoundspace, playSoundspace, stopSoundspace, useSoundspacePlayback } from "../store";

export function SoundspaceNowPlayingChip() {
  const pb = useSoundspacePlayback();
  useEffect(() => () => stopSoundspace(), []);

  if (!pb.ownerId || !pb.scene || voiceCount(pb.scene) === 0) return null;
  const { ownerId, scene, playing } = pb;
  const name = scene.mixName ?? "Soundspace";
  const label = playing ? `Pause ${name}` : `Play ${name}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={() => (playing ? pauseSoundspace() : playSoundspace(ownerId, scene))}
          className={cn(
            "group/np flex h-(--ctrl-h-sm) items-center gap-2 rounded-md px-2 text-xs outline-none motion-view",
            "transition-colors duration-(--motion-fade) hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50",
            playing ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <span className="relative grid size-3 place-items-center">
            <span
              aria-hidden
              className={cn(
                "flex h-2.5 items-end gap-px group-hover/np:hidden",
                playing && "soundspace-eq",
              )}
            >
              {[0, 1, 2].map((i) => (
                <i
                  key={i}
                  className={cn(
                    "block h-full w-0.5 rounded-full bg-current",
                    !playing && "scale-y-50",
                  )}
                />
              ))}
            </span>
            {playing ? (
              <Pause
                aria-hidden
                className="hidden size-icon-xs fill-current group-hover/np:block"
              />
            ) : (
              <Play aria-hidden className="hidden size-icon-xs fill-current group-hover/np:block" />
            )}
          </span>
          <span className="hidden max-w-32 truncate @2xs:inline">{name}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
