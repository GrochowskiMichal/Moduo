import {
  AudioWaveform,
  Bird,
  BookOpen,
  Bug,
  Car,
  Cat,
  CloudDrizzle,
  CloudLightning,
  CloudRain,
  Coffee,
  Droplets,
  Flame,
  Keyboard,
  type LucideIcon,
  TrainFront,
  TreePine,
  WavesHorizontal,
} from "lucide-react";

import type { PointSoundId } from "../catalog";

export const SOUND_ICONS: Record<PointSoundId, LucideIcon> = {
  birds: Bird,
  rainfall: CloudRain,
  stream: Droplets,
  pines: TreePine,
  crickets: Bug,
  thunder: CloudLightning,
  shore: WavesHorizontal,
  street: Car,
  cafe: Coffee,
  train: TrainFront,
  fire: Flame,
  window: CloudDrizzle,
  keys: Keyboard,
  pages: BookOpen,
  purr: Cat,
  white: AudioWaveform,
  pink: AudioWaveform,
  brown: AudioWaveform,
  blue: AudioWaveform,
  violet: AudioWaveform,
};

/** The colour dot that tells the five noises apart (accent tokens). */
export const NOISE_SWATCH: Partial<Record<PointSoundId, string>> = {
  white: "bg-foreground",
  pink: "bg-[var(--pink-base)]",
  brown: "bg-[var(--amber-active)]",
  blue: "bg-[var(--blue-base)]",
  violet: "bg-[var(--violet-base)]",
};
