// Framing shared by the home scene's server-rendered figures (components/home/Scene.astro) and
// its driver (motion/interlock.ts), so the static artwork and the live canvas sit on the same
// pixels when the driver takes over. Mark units, like everything in lib/stroke.ts.
import { DUSK_SVH } from "./dusk";

/** Room above the strokes for the module names, once the scene has named them. */
export const NAME_ROOM = 72;

/** The scroll the scene's own beats take, in svh (motion/interlock.ts: the mark grows, deals out
 *  six strokes, closes five windows, stands as the plate, grows into the ribbon). */
export const SCENE_SVH = 440;

/** The scene's height, in svh: one screen held, plus the hero's scroll, plus the scene's. */
export const SCENE_HEIGHT_SVH = 100 + DUSK_SVH + SCENE_SVH;

/** The opening share of the home scene's scroll that belongs to the hero, Dusk (motion/dusk.ts):
 *  the story runs through its chapters while the scene holds the first screen; at its end the
 *  scene takes the mark from the window's own bar. The scene's own beats (motion/interlock.ts)
 *  run on the rest, unchanged. */
export const HERO_LEAD = DUSK_SVH / (DUSK_SVH + SCENE_SVH);

/** First light's beats (motion/first-light.ts, motion/light-frame.ts), as fractions of its lead:
 *  the hero before Dusk (DESIGN.md §11), kept until Mike drops its files. */
export const HERO_BEATS = {
  open: [0, 0.56],
  dark: [0.42, 0.88],
  paper: [0.52, 1],
} as const;
