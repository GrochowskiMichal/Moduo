// The widget's scene and every edit to it. An edit draws at once, plays at
// once (if this widget owns the playing space) and saves to the widget's
// config after a short pause; a drag saves only when it ends. Adding the first
// sound starts playback (it is a click, so the browser allows sound).

import { useEffect, useRef, useState } from "react";

import { undoToast } from "@/lib/undo-toast";

import type { WidgetComponentProps } from "../../dashboard/registry/types";
import { binauralBeat, type BinauralId, pointSound, type PointSoundId } from "../catalog";
import {
  addPointSound,
  type BinauralLayer,
  EMPTY_SCENE,
  isFull,
  removeVoice,
  restoreVoice,
  type Scene,
  sceneFromConfig,
  sceneFromMix,
  sceneToConfig,
  setBinaural,
  updateBinaural,
  updateVoice,
  type Voice,
  voiceCount,
} from "../model";
import {
  getSoundspaceSnapshot,
  pauseSoundspace,
  playSoundspace,
  setSoundspaceSolo,
  syncSoundspace,
  useSoundspacePlayback,
} from "../store";
import type { Selection } from "./stage";

const SAVE_DELAY_MS = 600;

type Save = "soon" | "later";

export function useSoundspaceScene({
  widget,
  canWrite,
  updateConfig,
}: Pick<WidgetComponentProps, "widget" | "canWrite" | "updateConfig">) {
  const playback = useSoundspacePlayback();
  const owns = playback.ownerId === widget.id;
  const playing = owns && playback.playing;
  const solo = owns ? playback.solo : null;

  // If this widget's space is the one playing, that copy is the freshest.
  const [scene, setScene] = useState<Scene>(() => {
    const live = getSoundspaceSnapshot();
    return live.ownerId === widget.id && live.scene ? live.scene : sceneFromConfig(widget.config);
  });
  const sceneRef = useRef(scene);
  const [selected, setSelected] = useState<Selection>(null);
  const [moved, setMoved] = useState(false);

  // Saving: the latest updateConfig rides a ref so the debounce never restarts.
  const updateRef = useRef(updateConfig);
  const canWriteRef = useRef(canWrite);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<Scene | null>(null);
  useEffect(() => {
    updateRef.current = updateConfig;
    canWriteRef.current = canWrite;
  }, [updateConfig, canWrite]);

  const flush = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const s = pendingSave.current;
    pendingSave.current = null;
    if (s && canWriteRef.current) updateRef.current(sceneToConfig(s));
  };
  // Leaving Home mid-debounce still saves.
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const s = pendingSave.current;
      if (s && canWriteRef.current) updateRef.current(sceneToConfig(s));
    },
    [],
  );

  const commit = (next: Scene, save: Save = "soon") => {
    sceneRef.current = next;
    setScene(next);
    syncSoundspace(widget.id, next);
    pendingSave.current = next;
    if (save === "soon") {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, SAVE_DELAY_MS);
    }
  };

  const startIfQuiet = (next: Scene) => {
    if (!playing && voiceCount(next) > 0) playSoundspace(widget.id, next);
  };

  const actions = {
    /** Returns false when the sound is already there (its card opens instead). */
    addPoint(id: PointSoundId): boolean {
      const cur = sceneRef.current;
      if (cur.voices.some((v) => v.id === id)) {
        setSelected(id);
        return false;
      }
      const next = addPointSound(cur, id);
      if (next !== cur) {
        commit(next);
        startIfQuiet(next);
      }
      return true;
    },
    setBinaural(id: BinauralId) {
      const cur = sceneRef.current;
      const next = setBinaural(cur, id);
      if (next === cur) return;
      commit(next);
      startIfQuiet(next);
    },
    patchVoice(id: PointSoundId, patch: Partial<Voice>, save: Save = "soon") {
      commit(updateVoice(sceneRef.current, id, patch), save);
    },
    move(id: PointSoundId, angle: number, radius: number, done: boolean) {
      commit(updateVoice(sceneRef.current, id, { angle, radius }), done ? "soon" : "later");
      if (done) setMoved(true);
    },
    stepVolume(id: PointSoundId, delta: number) {
      const v = sceneRef.current.voices.find((x) => x.id === id);
      if (v) commit(updateVoice(sceneRef.current, id, { volume: v.volume + delta }));
    },
    patchBinaural(patch: Partial<BinauralLayer>) {
      commit(updateBinaural(sceneRef.current, patch));
    },
    setMaster(master: number) {
      commit({ ...sceneRef.current, master });
    },
    removePoint(id: PointSoundId) {
      const cur = sceneRef.current;
      const index = cur.voices.findIndex((v) => v.id === id);
      const voice = cur.voices[index];
      if (!voice) return;
      setSelected((s) => (s === id ? null : s));
      commit(removeVoice(cur, id));
      undoToast(`${pointSound(id).name} removed`, {
        onUndo: () => commit(restoreVoice(sceneRef.current, voice, index)),
      });
    },
    removeBinaural() {
      const layer = sceneRef.current.binaural;
      if (!layer) return;
      setSelected((s) => (s === "binaural" ? null : s));
      commit({ ...sceneRef.current, binaural: null });
      undoToast(`${binauralBeat(layer.id).name} removed`, {
        onUndo: () => {
          const now = sceneRef.current;
          if (!now.binaural && !isFull(now)) commit({ ...now, binaural: layer });
        },
      });
    },
    loadMix(mixId: string) {
      const next = sceneFromMix(mixId, sceneRef.current.master);
      setSelected(null);
      commit(next);
      playSoundspace(widget.id, next);
    },
    clearAll() {
      const prev = sceneRef.current;
      setSelected(null);
      commit({ ...EMPTY_SCENE, master: prev.master });
      undoToast("Space cleared", { onUndo: () => commit(prev) });
    },
    togglePlay() {
      if (playing) pauseSoundspace();
      else playSoundspace(widget.id, sceneRef.current);
    },
    solo(id: PointSoundId, on: boolean) {
      if (!owns) playSoundspace(widget.id, sceneRef.current);
      setSoundspaceSolo(widget.id, on ? id : null);
    },
  };

  return { scene, playing, solo, selected, setSelected, moved, actions };
}

export type SoundspaceActions = ReturnType<typeof useSoundspaceScene>["actions"];
