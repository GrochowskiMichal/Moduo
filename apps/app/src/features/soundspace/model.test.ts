// Soundspace — the scene model: saved config round-trips and survives junk,
// places map to direction and distance, and edits respect the voice cap.

import { describe, expect, it } from "@rstest/core";

import { GENERATORS, TRIM } from "./audio/generators";
import { MAX_VOICES, MIXES, POINT_SOUND_IDS, POINT_SOUNDS } from "./catalog";
import {
  addPointSound,
  directionName,
  EMPTY_SCENE,
  formatMeters,
  freeSpot,
  fromStageXY,
  metersFor,
  R_MIN,
  removeVoice,
  restoreVoice,
  sceneFromConfig,
  sceneFromMix,
  sceneToConfig,
  setBinaural,
  toStageXY,
  updateVoice,
  voiceCount,
  wrapAngle,
} from "./model";

describe("saved config", () => {
  it("round-trips a scene", () => {
    const scene = setBinaural(addPointSound(addPointSound(EMPTY_SCENE, "fire"), "birds"), "alpha");
    const back = sceneFromConfig(sceneToConfig(scene));
    expect(back.voices.map((v) => v.id)).toEqual(["fire", "birds"]);
    expect(back.binaural?.id).toBe("alpha");
    expect(back.voices[1].wander).toBe(true);
  });

  it("reads an empty or broken config as an empty space", () => {
    expect(sceneFromConfig({})).toEqual(EMPTY_SCENE);
    expect(sceneFromConfig({ soundspace: "nope" })).toEqual(EMPTY_SCENE);
  });

  it("drops unknown sounds and duplicates, and clamps values", () => {
    const scene = sceneFromConfig({
      soundspace: {
        voices: [
          { id: "fire", angle: 540, radius: 9, volume: -1 },
          { id: "fire", angle: 0 },
          { id: "dubstep" },
          null,
        ],
        binaural: { id: "delta" },
        master: 3,
      },
    });
    expect(scene.voices).toHaveLength(1);
    expect(scene.voices[0]).toMatchObject({
      id: "fire",
      angle: -180,
      radius: 1,
      volume: 0,
      on: true,
    });
    expect(scene.binaural).toBeNull();
    expect(scene.master).toBe(1);
  });

  it("never loads more than the voice cap", () => {
    const voices = POINT_SOUND_IDS.map((id) => ({ id, angle: 0, radius: 0.8, volume: 0.5 }));
    const scene = sceneFromConfig({ soundspace: { voices, binaural: { id: "beta" } } });
    expect(voiceCount(scene)).toBe(MAX_VOICES);
    expect(scene.binaural?.id).toBe("beta");
  });
});

describe("geometry", () => {
  it("names directions clockwise from the front", () => {
    expect(directionName(0)).toBe("Front");
    expect(directionName(90)).toBe("Right");
    expect(directionName(-90)).toBe("Left");
    expect(directionName(180)).toBe("Behind");
    expect(directionName(-135)).toBe("Back-left");
  });

  it("maps the stage edge to the farthest distance and the inner ring to the nearest", () => {
    expect(metersFor(R_MIN)).toBeCloseTo(0.3);
    expect(metersFor(1)).toBeCloseTo(8);
    expect(formatMeters(0.42)).toBe("42 cm");
    expect(formatMeters(3.14)).toBe("3.1 m");
  });

  it("converts stage points both ways", () => {
    const p = toStageXY(90, 0.5, 100);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(0);
    const back = fromStageXY(p.x, p.y, 100);
    expect(back.angle).toBeCloseTo(90);
    expect(back.radius).toBeCloseTo(0.5);
    // Never inside the head, never past the edge.
    expect(fromStageXY(1, 1, 100).radius).toBe(R_MIN);
    expect(fromStageXY(0, -500, 100).radius).toBe(1);
  });

  it("wraps angles into −180…180", () => {
    expect(wrapAngle(190)).toBe(-170);
    expect(wrapAngle(-190)).toBe(170);
    expect(wrapAngle(360)).toBe(0);
  });
});

describe("scene edits", () => {
  it("adds each sound once and steps new ones away from occupied spots", () => {
    const one = addPointSound(EMPTY_SCENE, "white");
    expect(addPointSound(one, "white")).toBe(one);
    const spot = freeSpot("pink", one.voices);
    expect(Math.abs(wrapAngle(spot.angle - one.voices[0].angle))).toBeGreaterThanOrEqual(26);
  });

  it("stops at the voice cap, binaural included", () => {
    let s = setBinaural(EMPTY_SCENE, "theta");
    for (const id of POINT_SOUND_IDS) s = addPointSound(s, id);
    expect(voiceCount(s)).toBe(MAX_VOICES);
    // Swapping the beat is still allowed when full.
    expect(setBinaural(s, "gamma").binaural?.id).toBe("gamma");
  });

  it("clamps an update and restores a removed voice in place", () => {
    const s = addPointSound(addPointSound(addPointSound(EMPTY_SCENE, "fire"), "rainfall"), "keys");
    const moved = updateVoice(s, "rainfall", { radius: 0.1, volume: 2 });
    expect(moved.voices[1]).toMatchObject({ radius: R_MIN, volume: 1 });
    const removed = removeVoice(moved, "rainfall");
    const back = restoreVoice(removed, moved.voices[1], 1);
    expect(back.voices.map((v) => v.id)).toEqual(["fire", "rainfall", "keys"]);
  });

  it("builds every mix within the cap", () => {
    for (const m of MIXES) {
      const s = sceneFromMix(m.id, 0.5);
      expect(s.mixName).toBe(m.name);
      expect(voiceCount(s)).toBeLessThanOrEqual(MAX_VOICES);
      expect(s.master).toBe(0.5);
    }
  });
});

describe("catalog ↔ engine", () => {
  it("has a generator and a loudness trim for every sound", () => {
    expect(Object.keys(GENERATORS).sort()).toEqual([...POINT_SOUND_IDS].sort());
    expect(Object.keys(TRIM).sort()).toEqual([...POINT_SOUND_IDS].sort());
    expect(POINT_SOUNDS.map((s) => s.id).sort()).toEqual([...POINT_SOUND_IDS].sort());
  });
});
