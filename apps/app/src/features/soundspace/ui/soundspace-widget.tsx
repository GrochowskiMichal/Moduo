// Soundspace on Home: build an ambient mix around your head. The stage places
// the sounds; the panel lists them with a level each, plays and pauses the
// space, sets a sleep timer and opens the picker. S is the stage and a play
// row; M puts the list beside the stage; L puts it under a bigger stage.
//
// The scene is saved in the widget's own config (`use-soundspace-scene.ts`).
// Playback is app-wide (`../store.ts`), so it keeps playing when you leave
// Home and the top-bar chip can pause it.

import { ChevronDown, Headphones, Moon, Pause, Play, Plus, Trash2, Volume2, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Eyebrow } from "@/components/ui/eyebrow";
import { IconButton } from "@/components/ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

import type { WidgetComponentProps } from "../../dashboard/registry/types";
import { binauralBeat, MAX_VOICES, MIXES, pointSound, type PointSoundId } from "../catalog";
import { binauralSubtitle, isFull, type Scene, voiceCount, voiceSubtitle } from "../model";
import { setSoundspaceSleep, SLEEP_OPTIONS, useSoundspacePlayback } from "../store";
import { BinauralCard, VoiceCard } from "./sound-card";
import { NOISE_SWATCH, SOUND_ICONS } from "./sound-icons";
import { SoundLibrary } from "./sound-library";
import { type Selection, Stage, type StageSize } from "./stage";
import { type SoundspaceActions, useSoundspaceScene } from "./use-soundspace-scene";

export function SoundspaceWidget({ widget, size, canWrite, updateConfig }: WidgetComponentProps) {
  const stageSize: StageSize = size === "S" || size === "L" ? size : "M";
  const { scene, playing, solo, selected, setSelected, moved, actions } = useSoundspaceScene({
    widget,
    canWrite,
    updateConfig,
  });
  const isEmpty = voiceCount(scene) === 0;
  const mixLabel = scene.mixName ?? (isEmpty ? "Soundspace" : "My space");

  const stage = (
    <Stage
      scene={scene}
      size={stageSize}
      playing={playing}
      solo={solo}
      selected={selected}
      onSelect={setSelected}
      onMove={actions.move}
      onVolumeStep={actions.stepVolume}
      onRemove={actions.removePoint}
      card={<SelectionCardBody scene={scene} selected={selected} solo={solo} actions={actions} />}
      coach={!moved}
      className={stageSize === "M" ? "aspect-square h-full max-w-[56%] shrink-0" : "min-h-0 flex-1"}
    />
  );
  const add = (variant: "primary" | "quiet") => (
    <AddSound scene={scene} variant={variant} disabled={!canWrite} actions={actions} />
  );
  const play = <PlayButton playing={playing} disabled={isEmpty} onClick={actions.togglePlay} />;

  if (stageSize === "S") {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2 px-2 pb-2">
        {stage}
        <div className="flex h-(--ctrl-h) shrink-0 items-center gap-2">
          {isEmpty ? null : play}
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{mixLabel}</span>
            {isEmpty ? null : ` · ${voiceCount(scene)}`}
          </span>
          {add("quiet")}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-0 gap-2 px-2 pb-2",
        stageSize === "M" ? "flex-row" : "flex-col",
      )}
    >
      {stage}
      <div
        className={cn(
          "flex min-w-0 flex-col",
          stageSize === "M" ? "min-h-0 flex-1" : "h-[34%] shrink-0",
        )}
      >
        {isEmpty ? (
          <EmptyPanel addButton={add("primary")} canWrite={canWrite} onMix={actions.loadMix} />
        ) : (
          <>
            <PanelHeader scene={scene} label={mixLabel} canWrite={canWrite} actions={actions} />
            <VoiceList
              scene={scene}
              twoColumns={stageSize === "L"}
              solo={solo}
              selected={selected}
              onSelect={setSelected}
              actions={actions}
            />
            <div className="flex h-10 shrink-0 items-center gap-2 border-t border-hairline pt-1">
              {play}
              <div className="flex w-24 items-center gap-2 text-muted-foreground">
                <Volume2 aria-hidden className="size-icon-sm shrink-0" />
                <Slider
                  size="sm"
                  thumbLabel="Volume of the whole space"
                  value={[Math.round(scene.master * 100)]}
                  max={100}
                  onValueChange={([m]) => actions.setMaster(m / 100)}
                />
              </div>
              <SleepChip />
              <span className="flex-1" />
              {add("quiet")}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SelectionCardBody({
  scene,
  selected,
  solo,
  actions,
}: {
  scene: Scene;
  selected: Selection;
  solo: PointSoundId | null;
  actions: SoundspaceActions;
}) {
  if (selected === "binaural") {
    return scene.binaural ? (
      <BinauralCard
        layer={scene.binaural}
        onPatch={actions.patchBinaural}
        onBeat={actions.setBinaural}
        onRemove={actions.removeBinaural}
      />
    ) : null;
  }
  const v = scene.voices.find((x) => x.id === selected);
  if (!v) return null;
  return (
    <VoiceCard
      voice={v}
      solo={solo}
      onPatch={(p) => actions.patchVoice(v.id, p)}
      onSolo={(on) => actions.solo(v.id, on)}
      onRemove={() => actions.removePoint(v.id)}
    />
  );
}

/** The Add button and the sound picker it opens. */
function AddSound({
  scene,
  variant,
  disabled,
  actions,
}: {
  scene: Scene;
  variant: "primary" | "quiet";
  disabled: boolean;
  actions: SoundspaceActions;
}) {
  const [open, setOpen] = useState(false);
  const primary = variant === "primary";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant={primary ? "default" : "secondary"}
          className={primary ? "self-start" : undefined}
          disabled={disabled || (!primary && isFull(scene))}
        >
          <Plus aria-hidden />
          {primary ? "Add sound" : "Add"}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        // Above or below the button (never over the stage, where the sound lands).
        side="top"
        collisionPadding={12}
        className="flex w-90 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SoundLibrary
          scene={scene}
          onAddPoint={(id) => {
            // A sound already in the space opens its card instead.
            if (!actions.addPoint(id)) setOpen(false);
          }}
          onSetBinaural={actions.setBinaural}
        />
      </PopoverContent>
    </Popover>
  );
}

function PlayButton({
  playing,
  disabled,
  onClick,
}: {
  playing: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={playing ? "Pause the space" : "Play the space"}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground outline-none",
        "transition-transform duration-(--motion-fast) ease-(--ease-out) hover:scale-105 active:scale-95",
        "focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40 disabled:hover:scale-100",
      )}
    >
      {playing ? (
        <Pause aria-hidden className="size-icon-sm fill-current" />
      ) : (
        <Play aria-hidden className="size-icon-sm translate-x-px fill-current" />
      )}
    </button>
  );
}

function EmptyPanel({
  addButton,
  canWrite,
  onMix,
}: {
  addButton: ReactNode;
  canWrite: boolean;
  onMix: (id: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-2.5 px-2">
      <p className="text-md font-medium text-foreground">Build the sound around you</p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Layer rain, fire, noise or binaural beats, then drag each one around your head. Nearer is
        louder and drier; farther is softer, with more room.
      </p>
      {addButton}
      <div className="mt-1 flex flex-col gap-1.5">
        <Eyebrow>Or start from</Eyebrow>
        <div className="flex flex-wrap gap-1.5">
          {MIXES.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={!canWrite}
              onClick={() => onMix(m.id)}
              className="h-(--ctrl-h-xs) rounded-full bg-state-hover px-2.5 text-xs text-muted-foreground outline-none transition-colors duration-(--motion-fade) hover:bg-state-active hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The mix menu (load a ready-made mix, clear the space) and the voice count. */
function PanelHeader({
  scene,
  label,
  canWrite,
  actions,
}: {
  scene: Scene;
  label: string;
  canWrite: boolean;
  actions: SoundspaceActions;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-(--ctrl-h-sm) min-w-0 items-center gap-1 rounded-md px-2 text-sm font-medium text-foreground outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="truncate">{label}</span>
            <ChevronDown aria-hidden className="size-icon-xs shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuLabel>Mixes</DropdownMenuLabel>
          {MIXES.map((m) => (
            <DropdownMenuItem
              key={m.id}
              disabled={!canWrite}
              onSelect={() => actions.loadMix(m.id)}
            >
              {m.name}
              <span className="ml-auto text-2xs text-subtle-foreground">
                {m.voices.length + (m.binaural ? 1 : 0)} sounds
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!canWrite} onSelect={actions.clearAll}>
            <Trash2 aria-hidden />
            Clear the space
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="ml-auto pr-1 text-2xs tabular-nums text-subtle-foreground">
        {voiceCount(scene)} of {MAX_VOICES}
      </span>
    </div>
  );
}

function VoiceList({
  scene,
  twoColumns,
  solo,
  selected,
  onSelect,
  actions,
}: {
  scene: Scene;
  twoColumns: boolean;
  solo: PointSoundId | null;
  selected: Selection;
  onSelect: (s: Selection) => void;
  actions: SoundspaceActions;
}) {
  const toggle = (s: Selection) => onSelect(selected === s ? null : s);
  return (
    <ul
      className={cn(
        "min-h-0 flex-1 overflow-y-auto py-0.5 scrollbar-thin",
        twoColumns ? "grid grid-cols-2 content-start gap-x-2 gap-y-0.5" : "flex flex-col gap-0.5",
      )}
    >
      {scene.voices.map((v) => (
        <VoiceRow
          key={v.id}
          name={pointSound(v.id).name}
          icon={SOUND_ICONS[v.id]}
          swatch={NOISE_SWATCH[v.id]}
          sub={voiceSubtitle(v, solo)}
          volume={v.volume}
          on={v.on}
          selected={selected === v.id}
          dimmed={!!solo && solo !== v.id}
          onSelect={() => toggle(v.id)}
          onVolume={(volume) => actions.patchVoice(v.id, { volume })}
          onRemove={() => actions.removePoint(v.id)}
        />
      ))}
      {scene.binaural ? (
        <VoiceRow
          name={binauralBeat(scene.binaural.id).name}
          icon={Headphones}
          sub={binauralSubtitle(scene.binaural)}
          volume={scene.binaural.volume}
          on={scene.binaural.on}
          selected={selected === "binaural"}
          dimmed={!!solo}
          onSelect={() => toggle("binaural")}
          onVolume={(volume) => actions.patchBinaural({ volume })}
          onRemove={actions.removeBinaural}
        />
      ) : null}
    </ul>
  );
}

function SleepChip() {
  const { sleepMinutes } = useSoundspacePlayback();
  const i = SLEEP_OPTIONS.indexOf(sleepMinutes);
  const next = SLEEP_OPTIONS[(i + 1) % SLEEP_OPTIONS.length];
  return (
    <button
      type="button"
      onClick={() => setSoundspaceSleep(next)}
      aria-label={
        sleepMinutes
          ? `Sleep timer: pauses in ${sleepMinutes} minutes. Change`
          : "Sleep timer off. Set one"
      }
      className={cn(
        "flex h-(--ctrl-h-xs) shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs outline-none transition-colors duration-(--motion-fade)",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        sleepMinutes
          ? "bg-control-raised text-foreground"
          : "bg-state-hover text-muted-foreground hover:text-foreground",
      )}
    >
      <Moon aria-hidden className="size-icon-xs" />
      {sleepMinutes ? `${sleepMinutes} min` : "Off"}
    </button>
  );
}

function VoiceRow({
  name,
  icon: Icon,
  swatch,
  sub,
  volume,
  on,
  selected,
  dimmed,
  onSelect,
  onVolume,
  onRemove,
}: {
  name: string;
  icon: typeof Volume2;
  swatch?: string;
  sub: string;
  volume: number;
  on: boolean;
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
  onVolume: (v: number) => void;
  onRemove: () => void;
}) {
  return (
    <li
      className={cn(
        "group/row flex h-10 items-center gap-1.5 rounded-md pr-1 transition-[background-color,opacity] duration-(--motion-fade)",
        selected ? "bg-state-active" : "hover:bg-state-hover",
        dimmed && "opacity-45",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={selected}
        className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-md pl-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span
          className={cn(
            "relative grid size-7 shrink-0 place-items-center rounded-full bg-state-active",
            on ? "text-foreground" : "text-subtle-foreground",
          )}
        >
          <Icon aria-hidden className="size-icon-sm" />
          {swatch ? (
            <span
              aria-hidden
              className={cn(
                "absolute right-0 bottom-0 size-2 rounded-full ring-2 ring-card",
                swatch,
              )}
            />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm text-foreground">{name}</span>
          <span className="truncate text-2xs tabular-nums text-muted-foreground">{sub}</span>
        </span>
      </button>
      <Slider
        size="sm"
        thumbLabel={`${name} volume`}
        className="w-16 shrink-0"
        value={[Math.round(volume * 100)]}
        max={100}
        onValueChange={([v]) => onVolume(v / 100)}
      />
      <IconButton
        icon={X}
        label={`Remove ${name}`}
        tooltip={null}
        onClick={onRemove}
        className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
      />
    </li>
  );
}
