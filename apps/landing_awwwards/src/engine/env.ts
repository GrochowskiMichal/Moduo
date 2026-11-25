import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";

gsap.registerPlugin(CustomEase);

export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const isTouch = () => matchMedia("(hover: none), (pointer: coarse)").matches;
export const isMobile = () => matchMedia("(max-width: 767px)").matches;
/** Safari, and every browser on iOS and iPadOS (all of them are WebKit there): its compositor
 *  needs a few things done its own way (motion/dusk.ts). */
export const isWebKit = () => {
  const ua = navigator.userAgent;
  const ios =
    /iP(hone|ad|od)/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios || (/Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua));
};

// The brand's one curve (--ease-out in the app, cubic-bezier(0.16, 1, 0.3, 1)), its in-out
// sibling for curtains, and a gentler in-out for the page gliding between stages (a soft start,
// a long settle: the brand curve's leap read as a jump of the whole screen). Every tween on the
// site uses one of these names.
CustomEase.create("moduo", "M0,0 C0.16,1 0.3,1 1,1");
CustomEase.create("moduo-inout", "M0,0 C0.7,0 0.2,1 1,1");
CustomEase.create("moduo-glide", "M0,0 C0.45,0 0.15,1 1,1");

export const ease = {
  out: "moduo",
  inOut: "moduo-inout",
  glide: "moduo-glide",
  none: "none",
} as const;
