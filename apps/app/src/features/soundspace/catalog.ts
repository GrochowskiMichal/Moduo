// Soundspace — the sound catalogue: every sound a person can add, the binaural
// beats, and the ready-made mixes. Pure data (no React, no Web Audio), so the
// model tests and the engine both read it. Each sound is generated live by the
// engine (`audio/generators.ts`), never streamed from a file.

export type SoundCategory = "nature" | "city" | "indoors" | "noise";

export const POINT_SOUND_IDS = [
  "birds",
  "rainfall",
  "stream",
  "pines",
  "crickets",
  "thunder",
  "shore",
  "street",
  "cafe",
  "train",
  "fire",
  "window",
  "keys",
  "pages",
  "purr",
  "white",
  "pink",
  "brown",
  "blue",
  "violet",
] as const;
export type PointSoundId = (typeof POINT_SOUND_IDS)[number];

export const BINAURAL_IDS = ["theta", "alpha", "beta", "gamma"] as const;
export type BinauralId = (typeof BINAURAL_IDS)[number];

export interface PointSound {
  id: PointSoundId;
  name: string;
  category: SoundCategory;
  /** One line in the library, under the name. */
  hint: string;
  /** Where it lands when added: degrees clockwise from the front, and 0.34–1 of the stage radius. */
  angle: number;
  radius: number;
  volume: number;
  /** Starts drifting around its spot (a bird moves; a fireplace doesn't). */
  wander?: boolean;
}

export interface BinauralBeat {
  id: BinauralId;
  name: string;
  short: string;
  hint: string;
  /** The difference between the two ears' tones. */
  beatHz: number;
}

export const POINT_SOUNDS: readonly PointSound[] = [
  {
    id: "birds",
    name: "Birdsong",
    category: "nature",
    hint: "Dawn chorus, never the same twice",
    angle: 40,
    radius: 0.9,
    volume: 0.5,
    wander: true,
  },
  {
    id: "rainfall",
    name: "Rainfall",
    category: "nature",
    hint: "Soft rain on leaves",
    angle: 180,
    radius: 0.95,
    volume: 0.55,
  },
  {
    id: "stream",
    name: "Stream",
    category: "nature",
    hint: "Water over stones",
    angle: -110,
    radius: 0.75,
    volume: 0.5,
  },
  {
    id: "pines",
    name: "Wind in pines",
    category: "nature",
    hint: "Gusts that come and go",
    angle: 120,
    radius: 0.95,
    volume: 0.45,
    wander: true,
  },
  {
    id: "crickets",
    name: "Crickets",
    category: "nature",
    hint: "A warm night outside",
    angle: 150,
    radius: 0.85,
    volume: 0.4,
  },
  {
    id: "thunder",
    name: "Distant thunder",
    category: "nature",
    hint: "Rolls in every minute or so",
    angle: -150,
    radius: 1,
    volume: 0.5,
  },
  {
    id: "shore",
    name: "Shoreline",
    category: "nature",
    hint: "Waves on pebbles",
    angle: -60,
    radius: 0.95,
    volume: 0.5,
  },
  {
    id: "street",
    name: "Wet street",
    category: "city",
    hint: "Tyres on rain-soaked asphalt",
    angle: -90,
    radius: 0.85,
    volume: 0.45,
  },
  {
    id: "cafe",
    name: "Café murmur",
    category: "city",
    hint: "Voices you can’t make out",
    angle: 60,
    radius: 0.65,
    volume: 0.4,
  },
  {
    id: "train",
    name: "Night train",
    category: "city",
    hint: "Wheels on rails, far off",
    angle: 165,
    radius: 1,
    volume: 0.45,
  },
  {
    id: "fire",
    name: "Fireplace",
    category: "indoors",
    hint: "Crackle and settling logs",
    angle: 70,
    radius: 0.55,
    volume: 0.65,
  },
  {
    id: "window",
    name: "Rain on window",
    category: "indoors",
    hint: "Drops on the glass beside you",
    angle: -55,
    radius: 0.6,
    volume: 0.55,
  },
  {
    id: "keys",
    name: "Keyboard",
    category: "indoors",
    hint: "Someone typing nearby",
    angle: 100,
    radius: 0.7,
    volume: 0.4,
  },
  {
    id: "pages",
    name: "Page turns",
    category: "indoors",
    hint: "A reader across the room",
    angle: -30,
    radius: 0.7,
    volume: 0.45,
  },
  {
    id: "purr",
    name: "Cat purr",
    category: "indoors",
    hint: "Close, slow and low",
    angle: 25,
    radius: 0.4,
    volume: 0.5,
  },
  {
    id: "white",
    name: "White noise",
    category: "noise",
    hint: "Every frequency, bright",
    angle: 0,
    radius: 0.9,
    volume: 0.3,
  },
  {
    id: "pink",
    name: "Pink noise",
    category: "noise",
    hint: "Balanced, like steady rain",
    angle: 0,
    radius: 0.9,
    volume: 0.3,
  },
  {
    id: "brown",
    name: "Brown noise",
    category: "noise",
    hint: "Deep, like a far waterfall",
    angle: 180,
    radius: 0.9,
    volume: 0.4,
  },
  {
    id: "blue",
    name: "Blue noise",
    category: "noise",
    hint: "Airy, leaning high",
    angle: 0,
    radius: 0.9,
    volume: 0.25,
  },
  {
    id: "violet",
    name: "Violet noise",
    category: "noise",
    hint: "A fine, high hiss",
    angle: 0,
    radius: 0.9,
    volume: 0.2,
  },
];

export const BINAURAL_BEATS: readonly BinauralBeat[] = [
  { id: "theta", name: "Theta · 6 Hz", short: "θ 6", hint: "Drowsy, drifting", beatHz: 6 },
  { id: "alpha", name: "Alpha · 10 Hz", short: "α 10", hint: "Relaxed, calm focus", beatHz: 10 },
  { id: "beta", name: "Beta · 18 Hz", short: "β 18", hint: "Alert, active work", beatHz: 18 },
  { id: "gamma", name: "Gamma · 40 Hz", short: "γ 40", hint: "High attention", beatHz: 40 },
];

export const CATEGORIES: readonly { id: SoundCategory | "all" | "binaural"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "nature", label: "Nature" },
  { id: "city", label: "City" },
  { id: "indoors", label: "Indoors" },
  { id: "noise", label: "Noise" },
  { id: "binaural", label: "Binaural" },
];

export interface Mix {
  id: string;
  name: string;
  voices: readonly (readonly [PointSoundId, number, number, number])[];
  binaural: readonly [BinauralId, number] | null;
}

/** Ready-made scenes: [sound, angle, radius, volume]. */
export const MIXES: readonly Mix[] = [
  {
    id: "rainy",
    name: "Rainy study",
    voices: [
      ["window", -55, 0.55, 0.6],
      ["fire", 65, 0.5, 0.7],
      ["brown", 180, 0.92, 0.3],
    ],
    binaural: ["alpha", 0.35],
  },
  {
    id: "cabin",
    name: "Cabin night",
    voices: [
      ["fire", 15, 0.45, 0.8],
      ["pines", -120, 0.95, 0.5],
      ["crickets", 140, 0.85, 0.4],
      ["thunder", -165, 1, 0.45],
    ],
    binaural: null,
  },
  {
    id: "city",
    name: "City at 2am",
    voices: [
      ["street", -90, 0.8, 0.55],
      ["cafe", 45, 0.6, 0.4],
      ["train", 170, 0.98, 0.45],
      ["pink", 0, 0.92, 0.2],
    ],
    binaural: null,
  },
  {
    id: "deep",
    name: "Deep work",
    voices: [
      ["pink", 0, 0.9, 0.3],
      ["stream", -60, 0.7, 0.45],
    ],
    binaural: ["beta", 0.45],
  },
];

/** Sounds playing at once, binaural included: past this the mix turns to mud. */
export const MAX_VOICES = 8;

const POINT_BY_ID = new Map(POINT_SOUNDS.map((s) => [s.id, s]));
const BINAURAL_BY_ID = new Map(BINAURAL_BEATS.map((b) => [b.id, b]));

export function pointSound(id: PointSoundId): PointSound {
  return POINT_BY_ID.get(id)!;
}

export function binauralBeat(id: BinauralId): BinauralBeat {
  return BINAURAL_BY_ID.get(id)!;
}

export function isPointSoundId(v: unknown): v is PointSoundId {
  return typeof v === "string" && POINT_BY_ID.has(v as PointSoundId);
}

export function isBinauralId(v: unknown): v is BinauralId {
  return typeof v === "string" && BINAURAL_BY_ID.has(v as BinauralId);
}
