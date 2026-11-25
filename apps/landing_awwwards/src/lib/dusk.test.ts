// The hero's measure and its camera. The chapters must tile the scroll exactly, the keyframe
// blend must hold a composed frame for most of each chapter, and a framed rect must land centred
// in the plate at the scale the plate allows.
import { describe, expect, it } from "@rstest/core";

import {
  allPose,
  blendAt,
  chapterAt,
  chapterLanding,
  chapterRest,
  CHAPTERS,
  chapterStart,
  dayAt,
  framePose,
  MOVE,
  restPose,
  sunAt,
  union,
} from "./dusk";

describe("chapterAt", () => {
  it("tiles the scroll into CHAPTERS equal parts, the last holding to the end", () => {
    expect(chapterAt(0)).toEqual({ i: 0, t: 0 });
    expect(chapterAt(0.999999).i).toBe(CHAPTERS - 1);
    expect(chapterAt(1)).toEqual({ i: CHAPTERS - 1, t: 1 });
    expect(chapterAt(1.4)).toEqual({ i: CHAPTERS - 1, t: 1 });
    expect(chapterAt(-1)).toEqual({ i: 0, t: 0 });
    for (let i = 0; i < CHAPTERS; i++) {
      const start = chapterAt(chapterStart(i));
      expect(start.i).toBe(i);
      expect(start.t).toBeCloseTo(0, 9);
      expect(chapterAt(chapterLanding(i)).i).toBe(i);
    }
  });
});

describe("chapterRest", () => {
  const ats = [0, 1, 2, 3, 3.5, 4, 5, 6].map((c) => c / CHAPTERS);
  it("rests the first chapter at the top", () => {
    expect(chapterRest(0, ats)).toBe(0);
  });
  it("rests every chapter inside itself, after its last glide has landed", () => {
    for (let i = 1; i < CHAPTERS; i++) {
      const p = chapterRest(i, ats);
      expect(chapterAt(p).i).toBe(i);
      const last = Math.max(...ats.filter((a) => chapterAt(a).i === i));
      expect(blendAt(p, ats).t).toBe(1);
      expect(p).toBeGreaterThan(last);
    }
  });
  it("waits for a second glide inside a chapter", () => {
    expect(chapterRest(3, ats)).toBeGreaterThan((3.5 + MOVE) / CHAPTERS);
    expect(chapterRest(3, ats)).toBeLessThan(chapterStart(4));
  });
  it("steps in order, one chapter at a time", () => {
    const rests = Array.from({ length: CHAPTERS }, (_, i) => chapterRest(i, ats));
    for (let i = 1; i < CHAPTERS; i++) expect(rests[i]).toBeGreaterThan(rests[i - 1]);
  });
});

describe("blendAt", () => {
  const ats = Array.from({ length: CHAPTERS }, (_, i) => chapterStart(i));
  it("rests on the first keyframe before any move", () => {
    expect(blendAt(0, ats)).toEqual({ k: 0, t: 1 });
    expect(blendAt(0.01, ats)).toEqual({ k: 0, t: 1 });
  });
  it("moves over MOVE of a chapter and then holds", () => {
    const at = chapterStart(2);
    const span = MOVE / CHAPTERS;
    expect(blendAt(at, ats)).toEqual({ k: 2, t: 0 });
    expect(blendAt(at + span / 2, ats).t).toBeCloseTo(0.5, 9);
    expect(blendAt(at + span, ats)).toEqual({ k: 2, t: 1 });
    expect(blendAt(chapterStart(3) - 1e-6, ats)).toEqual({ k: 2, t: 1 });
  });
  it("takes sub-keyframes inside a chapter", () => {
    const withSub = [0, 0.3, 0.36, 0.6];
    expect(blendAt(0.35, withSub).k).toBe(1);
    expect(blendAt(0.36, withSub)).toEqual({ k: 2, t: 0 });
    expect(blendAt(0.6, withSub).k).toBe(3);
  });
});

describe("poses", () => {
  const plate = { w: 800, h: 700 };
  const win = { left: 48, top: 70, w: 1024, h: 560 };
  it("rests with the window's height filling the plate from where it stands", () => {
    const p = restPose(plate, win, { rx: 7, ry: -14 });
    expect(p.s * win.h + win.top).toBeCloseTo(plate.h * 1.06, 6);
    expect(p).toMatchObject({ x: 0, y: 0, rx: 7, ry: -14 });
  });
  it("never shrinks the window at rest", () => {
    expect(restPose({ w: 800, h: 300 }, win, { rx: 0, ry: 0 }).s).toBe(1);
  });
  it("shows the whole window within a margin, centred a little above the middle", () => {
    const p = allPose(plate, win);
    const m = plate.w * 0.04;
    const w = win.w * p.s;
    const h = win.h * p.s;
    expect(Math.min(plate.w - w, plate.h - h)).toBeCloseTo(2 * m, 6);
    expect(win.left + p.x + w / 2).toBeCloseTo(plate.w / 2, 6);
    expect(win.top + p.y + h / 2).toBeCloseTo(plate.h * 0.4, 6);
    expect(p.rx).toBe(0);
    expect(p.ry).toBe(0);
  });
  it("frames a rect centred in the plate, no closer than the cap", () => {
    const r = { x: 100, y: 120, w: 300, h: 200 };
    const p = framePose(r, plate, win);
    expect(p.s).toBeCloseTo(2.1, 9);
    const cx = win.left + p.x + (r.x + r.w / 2) * p.s;
    const cy = win.top + p.y + (r.y + r.h / 2) * p.s;
    expect(cx).toBeCloseTo(plate.w / 2, 6);
    expect(cy).toBeCloseTo(plate.h / 2, 6);
  });
  it("frames a wide rect to the plate's width within the margin", () => {
    const r = { x: 0, y: 0, w: 1000, h: 100 };
    const p = framePose(r, plate, win);
    const m = Math.max(16, plate.w * 0.07);
    expect(r.w * p.s).toBeCloseTo(plate.w - 2 * m, 6);
  });
  it("unions rects", () => {
    expect(
      union([
        { x: 10, y: 10, w: 10, h: 10 },
        { x: 15, y: 5, w: 20, h: 10 },
      ]),
    ).toEqual({
      x: 10,
      y: 5,
      w: 25,
      h: 15,
    });
  });
});

describe("the light", () => {
  it("runs from night to sunrise, slowly at first", () => {
    expect(dayAt(0)).toBe(0);
    expect(dayAt(1)).toBeCloseTo(1, 9);
    expect(dayAt(0.25)).toBeLessThan(0.25);
    expect(dayAt(0.75)).toBeGreaterThan(0.75);
  });
  it("lights the rim only once the sky has warmed", () => {
    expect(sunAt(0.3)).toBe(0);
    expect(sunAt(0.55)).toBe(0);
    expect(sunAt(1)).toBe(1);
    expect(sunAt(0.8)).toBeGreaterThan(0);
    expect(sunAt(0.8)).toBeLessThan(1);
  });
});
