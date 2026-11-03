// The sound picker: search, a row of categories and a grid of tiles. Picking a
// sound drops it around you (and starts playback, it's a click); picking one
// already in the space opens its card instead. One binaural beat at a time.

import { Check, Headphones, Search, Sparkles } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  BINAURAL_BEATS,
  type BinauralId,
  CATEGORIES,
  MAX_VOICES,
  POINT_SOUNDS,
  type PointSoundId,
} from "../catalog";
import { isFull, type Scene, voiceCount } from "../model";
import { NOISE_SWATCH, SOUND_ICONS } from "./sound-icons";

type CategoryId = (typeof CATEGORIES)[number]["id"];

interface Tile {
  key: string;
  name: string;
  hint: string;
  icon: typeof Headphones;
  swatch?: string;
  added: boolean;
  disabled: boolean;
  pick: () => void;
}

function TileButton({ tile: t }: { tile: Tile }) {
  const Icon = t.icon;
  return (
    <button
      type="button"
      disabled={t.disabled}
      onClick={t.pick}
      aria-label={t.added ? `${t.name}, in your space. Open its card` : `Add ${t.name}`}
      className={cn(
        "relative flex min-h-21 flex-col items-start gap-2 rounded-md border p-2.5 text-left outline-none",
        "transition-colors duration-(--motion-fade) focus-visible:ring-2 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-40",
        t.added
          ? "border-foreground/40 bg-state-active"
          : "border-hairline bg-state-hover/50 hover:border-foreground/20 hover:bg-state-hover",
      )}
    >
      <span className="relative grid size-7 place-items-center rounded-full bg-state-active text-foreground">
        <Icon aria-hidden className="size-icon-sm" />
        {t.swatch ? (
          <span
            aria-hidden
            className={cn(
              "absolute right-0 bottom-0 size-2 rounded-full ring-2 ring-popover",
              t.swatch,
            )}
          />
        ) : null}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{t.name}</span>
        <span className="text-2xs leading-snug text-muted-foreground">{t.hint}</span>
      </span>
      {t.added ? (
        <span className="absolute top-2 right-2 grid size-4 place-items-center rounded-full bg-foreground text-background">
          <Check aria-hidden className="size-icon-xs" strokeWidth={3} />
        </span>
      ) : null}
    </button>
  );
}

function matcher(query: string) {
  const q = query.trim().toLowerCase();
  return (text: string) => !q || text.toLowerCase().includes(q);
}

function pointTiles(
  scene: Scene,
  category: CategoryId,
  matches: (text: string) => boolean,
  onAdd: (id: PointSoundId) => void,
): Tile[] {
  if (category === "binaural") return [];
  const full = isFull(scene);
  return POINT_SOUNDS.filter(
    (s) =>
      (category === "all" || s.category === category) &&
      matches(`${s.name} ${s.hint} ${s.category}`),
  ).map((s) => {
    const added = scene.voices.some((v) => v.id === s.id);
    return {
      key: s.id,
      name: s.name,
      hint: s.hint,
      icon: SOUND_ICONS[s.id],
      swatch: NOISE_SWATCH[s.id],
      added,
      disabled: !added && full,
      pick: () => onAdd(s.id),
    };
  });
}

function binauralTiles(
  scene: Scene,
  category: CategoryId,
  matches: (text: string) => boolean,
  onSet: (id: BinauralId) => void,
): Tile[] {
  if (category !== "all" && category !== "binaural") return [];
  // Swapping one beat for another never needs a free slot.
  const blocked = isFull(scene) && !scene.binaural;
  return BINAURAL_BEATS.filter((b) => matches(`${b.name} ${b.hint} binaural`)).map((b) => {
    const added = scene.binaural?.id === b.id;
    return {
      key: b.id,
      name: b.name,
      hint: b.hint,
      icon: Headphones,
      added,
      disabled: !added && blocked,
      pick: () => onSet(b.id),
    };
  });
}

function footerFor(category: CategoryId, full: boolean) {
  if (category === "binaural") {
    return {
      icon: Headphones,
      text: "Binaural beats need headphones: each ear gets its own tone, so they sit inside your head and have no place.",
    };
  }
  if (full)
    return { icon: Sparkles, text: `That’s ${MAX_VOICES} sounds — remove one to add another.` };
  return {
    icon: Sparkles,
    text: "Generated live on your device, not a file on repeat: there’s no loop to hear.",
  };
}

export function SoundLibrary({
  scene,
  onAddPoint,
  onSetBinaural,
}: {
  scene: Scene;
  onAddPoint: (id: PointSoundId) => void;
  onSetBinaural: (id: BinauralId) => void;
}) {
  const [category, setCategory] = useState<CategoryId>("all");
  const [query, setQuery] = useState("");
  const matches = matcher(query);
  const tiles = [
    ...pointTiles(scene, category, matches, onAddPoint),
    ...binauralTiles(scene, category, matches, onSetBinaural),
  ];
  const footer = footerFor(category, isFull(scene));

  return (
    <div className="flex max-h-(--radix-popover-content-available-height) w-full flex-col">
      <div className="flex flex-col gap-2.5 p-3 pb-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-foreground">Add a sound</span>
          <span className="text-2xs tabular-nums text-subtle-foreground">
            {voiceCount(scene)} of {MAX_VOICES}
          </span>
        </div>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-icon-sm -translate-y-1/2 text-muted-foreground"
          />
          <Input
            size="sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rain, fire, pink noise…"
            aria-label="Search sounds"
            className="pl-8"
          />
        </div>
        <div
          role="tablist"
          aria-label="Categories"
          className="no-scrollbar flex gap-0.5 overflow-x-auto"
        >
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={category === c.id}
              onClick={() => setCategory(c.id)}
              className={cn(
                "h-(--ctrl-h-xs) shrink-0 rounded-full px-2.5 text-xs outline-none transition-colors duration-(--motion-fade)",
                "focus-visible:ring-2 focus-visible:ring-ring/50",
                category === c.id
                  ? "bg-control-raised text-foreground"
                  : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-1.5 overflow-y-auto px-3 pb-3 scrollbar-thin">
        {tiles.map((t) => (
          <TileButton key={t.key} tile={t} />
        ))}
        {tiles.length === 0 ? (
          <p className="col-span-2 py-6 text-center text-xs text-muted-foreground">
            No sound matches “{query.trim()}”.
          </p>
        ) : null}
      </div>
      <div className="flex items-start gap-2 border-t border-hairline px-3 py-2.5 text-2xs leading-snug text-subtle-foreground">
        <footer.icon aria-hidden className="mt-px size-icon-xs shrink-0 text-muted-foreground" />
        <span>{footer.text}</span>
      </div>
    </div>
  );
}
