// The hero's geometry outside the shader: the mark's box, its place on the photo's desk, the
// cover layout that puts it on screen, and where the spectrum falls. The page moves the mark's box
// to where cover() says and lights the app's window where fanAt says, so all of it must agree with
// what the shader draws.
import { describe, expect, it } from "@rstest/core";

import {
  cover,
  DEPTH,
  FAN,
  fanAt,
  fromPhoto,
  MARK_BOX,
  PHOTO,
  PLACES,
  SUN_TRACK,
  sunAt,
  toPhoto,
  WINDOWS,
} from "./first-light";
import { MARK_X, STROKE, windowCenter } from "./stroke";

describe("first light", () => {
  it("frames the mark's artwork: three strokes one offset apart", () => {
    expect(MARK_BOX.x).toBeCloseTo(STROKE.x0 - STROKE.offset, 2);
    expect(MARK_BOX.x + MARK_BOX.w).toBeCloseTo(STROKE.x0 + STROKE.offset + STROKE.w, 2);
    expect(MARK_BOX.y).toBe(STROKE.top);
  });

  it("puts each window where two neighbors overlap", () => {
    WINDOWS.forEach((quad, k) => {
      const xs = quad.map(([x]) => x);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      // windowCenter works in chain units (stroke 0's left edge at 0); the box starts at its x.
      expect(cx).toBeCloseTo(windowCenter(MARK_X, k)!.x + MARK_BOX.x, 0);
    });
  });

  it("stands the glass on the photo's desk, its foot in front of the back edge", () => {
    for (const place of Object.values(PLACES)) {
      const [, foot] = toPhoto(place, FAN.apex[0], STROKE.bottom);
      expect(foot).toBeGreaterThan(PHOTO.desk);
      expect(foot).toBeLessThan(PHOTO.h);
      const [l] = toPhoto(place, MARK_BOX.x, 0);
      const [r] = toPhoto(place, MARK_BOX.x + MARK_BOX.w, 0);
      expect(l).toBeGreaterThan(0);
      expect(r).toBeLessThan(PHOTO.w);
    }
  });

  it("converts between photo pixels and mark units both ways", () => {
    const place = PLACES.wide;
    const [x, y] = toPhoto(place, 500, 500);
    const [u, v] = fromPhoto(place, x, y);
    expect(u).toBeCloseTo(500, 6);
    expect(v).toBeCloseTo(500, 6);
  });

  it("lays the photo out like object-fit: cover, the mark's box on it", () => {
    // A laptop: the photo is wider than the screen's shape, so its height fills the screen.
    const fit = cover(1440, 900, PLACES.wide);
    expect(PHOTO.h * fit.s).toBeCloseTo(900, 6);
    expect(PHOTO.w * fit.s).toBeGreaterThanOrEqual(1440);
    expect(fit.ox).toBeCloseTo((1440 - PHOTO.w * fit.s) / 2, 6);
    expect(fit.box.x).toBeCloseTo(fit.ox + PLACES.wide.x * fit.s, 6);
    expect(fit.box.h / fit.box.w).toBeCloseTo(MARK_BOX.h / MARK_BOX.w, 6);
    // The glass stands right of the words' half of the screen, inside it.
    expect(fit.box.x).toBeGreaterThan(720);
    expect(fit.box.x + fit.box.w).toBeLessThan(1440);
    // A phone shows the right part of the photo, with the glass in it.
    const phone = cover(390, 844, PLACES.narrow);
    expect(phone.box.x).toBeGreaterThan(0);
    expect(phone.box.x + phone.box.w).toBeLessThan(390);
  });

  it("puts the sun up and to the left of the glass, above its left side, on the laptop", () => {
    const [sx, sy] = fromPhoto(PLACES.wide, PHOTO.sun[0], PHOTO.sun[1]);
    expect(sy).toBeLessThan(MARK_BOX.y);
    expect(sx).toBeGreaterThan(MARK_BOX.x - 100);
    expect(sx).toBeLessThan(STROKE.x0);
  });

  it("aims the spectrum at the mockup: down and to the left on a laptop, widening", () => {
    const near = fanAt(FAN.apex[1] + 100);
    const far = fanAt(FAN.apex[1] + 300);
    const mid = (f: { red: number; violet: number }) => (f.red + f.violet) / 2;
    // down and to the left, near the stroke's own 45°
    expect(FAN.apex[0] - mid(far)).toBeGreaterThan(220);
    expect(FAN.apex[0] - mid(far)).toBeLessThan(340);
    expect(Math.abs(far.red - far.violet)).toBeGreaterThan(Math.abs(near.red - near.violet) * 2.5);
    // aimed elsewhere (a phone's mockup, straight below), it goes there
    const down = fanAt(FAN.apex[1] + 300, 0, [0, 1]);
    expect(mid(down)).toBeCloseTo(FAN.apex[0], 0);
  });

  it("turns the spectrum with the pointer", () => {
    const y = FAN.apex[1] + 300;
    expect(fanAt(y, 0.1).red).not.toBeCloseTo(fanAt(y).red, 0);
  });

  it("follows the clip's sun, looping, between its samples", () => {
    const n = SUN_TRACK.power.length;
    const loop = n / SUN_TRACK.fps;
    expect(sunAt(0).power).toBeCloseTo(SUN_TRACK.power[0], 6);
    expect(sunAt(loop).power).toBeCloseTo(SUN_TRACK.power[0], 6);
    const half = sunAt(0.05);
    expect(half.power).toBeCloseTo((SUN_TRACK.power[0] + SUN_TRACK.power[1]) / 2, 6);
    // the sun stays near where PHOTO says it is, and shines about as strongly as on average
    for (let t = 0; t < loop; t += 0.7) {
      const s = sunAt(t);
      expect(Math.abs(s.x - PHOTO.sun[0])).toBeLessThan(30);
      expect(Math.abs(s.y - PHOTO.sun[1])).toBeLessThan(30);
      expect(s.power).toBeGreaterThanOrEqual(0.8);
      expect(s.power).toBeLessThanOrEqual(1.2);
    }
  });

  it("turns the glass's face to the left, toward the mockup, the mark deeper than the stroke", () => {
    expect(DEPTH.open).toBeGreaterThan(DEPTH.folded);
    expect(DEPTH.dir[0]).toBeGreaterThan(0);
    expect(DEPTH.dir[1]).toBeLessThan(0);
    expect(Math.hypot(...DEPTH.dir)).toBeCloseTo(1, 1);
  });
});
