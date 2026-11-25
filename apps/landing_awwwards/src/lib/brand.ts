// The logo artwork, read from the BRAND-1 exports at build time so the site never retypes it
// (brand decision 18) and follows the masters when Maciej redraws them.
import lockupSvg from "../../../../brand/exports/svg/lockup-current.svg?raw";
import markSvg from "../../../../brand/exports/svg/mark-current.svg?raw";

const paths = (svg: string) => [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
const viewBox = (svg: string) => /viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 0 1000 1000";

const [lockupMark, lockupWord] = paths(lockupSvg);

export const LOCKUP = {
  viewBox: viewBox(lockupSvg),
  mark: lockupMark,
  word: lockupWord,
};

export const MARK = {
  viewBox: viewBox(markSvg),
  /** The artwork's own bounds inside its 1000 box (measured), for a mark set beside type. */
  tight: "140 228 720 544",
  d: paths(markSvg)[0],
};
