// The card beside a selected sound: its level, and four big quiet tiles —
// Pause, Solo (hear only this one), Wander (let it drift around its spot) and
// Remove. Distance is never a control here: you set it by dragging the sound
// nearer or farther on the stage, and the card's second line says where it is.

import {
  Crosshair,
  Headphones,
  Pause,
  Play,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { ComponentType } from "react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

import {
  BINAURAL_BEATS,
  binauralBeat,
  type BinauralId,
  pointSound,
  type PointSoundId,
} from "../catalog";
import { type BinauralLayer, distanceWord, type Voice, voiceSubtitle } from "../model";
import { NOISE_SWATCH, SOUND_ICONS } from "./sound-icons";

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

const WanderIcon: IconType = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    {...props}
  >
    <path d="M3 12c2.5-5 5.5 5 9 0s6.5 5 9 0" />
  </svg>
);

function VolumeRow({
  value,
  label,
  onChange,
}: {
  value: number;
  label: string;
  onChange: (v: number) => void;
}) {
  const Icon = value < 0.01 ? VolumeX : value < 0.5 ? Volume1 : Volume2;
  return (
    <div className="flex h-(--ctrl-h) items-center gap-2.5 rounded-md bg-state-hover px-2.5 text-muted-foreground">
      <Icon aria-hidden className="size-icon-sm shrink-0" />
      <Slider
        thumbLabel={label}
        value={[Math.round(value * 100)]}
        max={100}
        step={1}
        onValueChange={([v]) => onChange(v / 100)}
      />
      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-foreground">
        {Math.round(value * 100)}
      </span>
    </div>
  );
}

function Tile({
  icon: Icon,
  label,
  pressed,
  danger = false,
  onClick,
}: {
  icon: IconType;
  label: string;
  pressed?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex h-13 flex-1 flex-col items-center justify-center gap-1 rounded-md text-2xs outline-none",
        "transition-[background-color,color,transform] duration-(--motion-fast) ease-(--ease-out) active:scale-95",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        pressed
          ? "bg-foreground text-background hover:bg-foreground/90"
          : "bg-state-hover text-muted-foreground hover:bg-state-active hover:text-foreground",
        danger && "hover:bg-destructive/15 hover:text-destructive",
      )}
    >
      <Icon aria-hidden className="size-icon" />
      {label}
    </button>
  );
}

function CardHead({
  icon: Icon,
  swatch,
  name,
  sub,
}: {
  icon: IconType;
  swatch?: string;
  name: string;
  sub: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="relative grid size-8 shrink-0 place-items-center rounded-full bg-state-active text-foreground">
        <Icon aria-hidden className="size-icon-sm" />
        {swatch ? (
          <span
            aria-hidden
            className={cn(
              "absolute right-0 bottom-0 size-2 rounded-full ring-2 ring-popover",
              swatch,
            )}
          />
        ) : null}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{name}</span>
        <span className="truncate text-xs tabular-nums text-muted-foreground">{sub}</span>
      </span>
    </div>
  );
}

export function VoiceCard({
  voice,
  solo,
  onPatch,
  onSolo,
  onRemove,
}: {
  voice: Voice;
  solo: PointSoundId | null;
  onPatch: (patch: Partial<Voice>) => void;
  onSolo: (on: boolean) => void;
  onRemove: () => void;
}) {
  const def = pointSound(voice.id);
  const soloed = solo === voice.id;
  const hint = soloed
    ? "Only this sound plays while Solo is on"
    : voice.wander
      ? "Drifts slowly around the spot you chose"
      : `${distanceWord(voice.radius)} · drag it nearer your head to bring it closer`;
  return (
    <div className="flex flex-col gap-3">
      <CardHead
        icon={SOUND_ICONS[voice.id]}
        swatch={NOISE_SWATCH[voice.id]}
        name={def.name}
        sub={voiceSubtitle(voice, solo)}
      />
      <VolumeRow
        value={voice.volume}
        label={`${def.name} volume`}
        onChange={(volume) => onPatch({ volume })}
      />
      <div className="flex gap-1.5">
        <Tile
          icon={voice.on ? Pause : Play}
          label={voice.on ? "Pause" : "Play"}
          pressed={!voice.on}
          onClick={() => onPatch({ on: !voice.on })}
        />
        <Tile icon={Crosshair} label="Solo" pressed={soloed} onClick={() => onSolo(!soloed)} />
        <Tile
          icon={WanderIcon}
          label="Wander"
          pressed={voice.wander}
          onClick={() => onPatch({ wander: !voice.wander })}
        />
        <Tile icon={Trash2} label="Remove" danger onClick={onRemove} />
      </div>
      <p className="text-center text-2xs text-subtle-foreground">{hint}</p>
    </div>
  );
}

export function BinauralCard({
  layer,
  onPatch,
  onBeat,
  onRemove,
}: {
  layer: BinauralLayer;
  onPatch: (patch: Partial<BinauralLayer>) => void;
  onBeat: (id: BinauralId) => void;
  onRemove: () => void;
}) {
  const beat = binauralBeat(layer.id);
  return (
    <div className="flex flex-col gap-3">
      <CardHead icon={Headphones} name={beat.name} sub="Inside your head · headphones" />
      <VolumeRow
        value={layer.volume}
        label={`${beat.name} volume`}
        onChange={(volume) => onPatch({ volume })}
      />
      <SegmentedControl
        aria-label="Binaural beat"
        size="sm"
        fullWidth
        value={layer.id}
        items={BINAURAL_BEATS.map((b) => ({ value: b.id, label: b.short }))}
        onValueChange={(v) => onBeat(v as BinauralId)}
      />
      <div className="flex gap-1.5">
        <Tile
          icon={layer.on ? Pause : Play}
          label={layer.on ? "Pause" : "Play"}
          pressed={!layer.on}
          onClick={() => onPatch({ on: !layer.on })}
        />
        <Tile icon={Trash2} label="Remove" danger onClick={onRemove} />
      </div>
      <p className="text-center text-2xs text-subtle-foreground">
        {beat.hint} · each ear hears its own tone
      </p>
    </div>
  );
}
