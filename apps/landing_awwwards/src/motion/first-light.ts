// The home hero's picture, "First light" (lib/first-light.ts holds the scene and its shaders,
// components/home/Scene.astro the markup). One driver for the room, the glass and the light:
//
//   intro (a first visit)  the room comes out of the dark with the mark standing on the desk, the
//                          sun behind its right stroke and white light through its windows; the
//                          mark folds into one stroke (its sides slide in behind the middle), the
//                          sun comes out from behind it, and the light the stroke now splits runs
//                          out of its foot over the desk onto the app's window, whose frame takes
//                          the colors in. Later visits fade in on the folded stroke.
//   at rest                the spectrum shimmers and dust turns in it, the sun breathes, the
//                          city's lights flicker; the pointer turns the camera a hair.
//   scroll (HERO_LEAD)     the hero holds (motion/interlock.ts) while the stroke opens into the
//                          mark, the rainbow gives way to white light through the windows, the
//                          room goes dark and the stone fills with light to Paper; the scene's
//                          canvas then takes the mark over on the same pixels.
//
// Raw WebGL, one program and one texture: the clip's current frame (public/hero/osaka-office.webm,
// or .mp4 where VP9 doesn't play; 720p on phones; its first frame if the clip can't play), uploaded
// as it plays. The glass follows the clip's sun (sunAt). A software renderer, a lost context, no
// WebGL or reduced motion leave the still (the first frame with the glass in it, components/home/
// Scene.astro). The frame's layout and the mark's box, the spectrum's aim at Home, the scroll's
// beats, the intro's look and the pointer are motion/light-frame.ts; this file draws the picture.
import { gsap } from "gsap";

import { onPage, prefersReducedMotion } from "../engine";
import {
  DEPTH,
  fromPhoto,
  GLASS_TURN,
  MAIN,
  MARK_BOX,
  NARROW,
  PHOTO,
  PLACES,
  sunAt,
  VERT,
} from "../lib/first-light";
import { createFrame, createLook, createPointer, type MountCtx, smooth } from "./light-frame";

export function startFirstLight() {
  onPage(({ firstLoad }) => {
    const hero = document.querySelector<HTMLElement>("[data-light]");
    if (!hero || prefersReducedMotion()) return;
    const intro = firstLoad && !!(window as Window & { __mIntro?: boolean }).__mIntro;
    return mount({ hero, playIntro: intro });
  });
}

/** The picture: the clip, the glass and the light, drawn by lib/first-light.ts's shader. */
function mount({ hero, playIntro }: MountCtx): (() => void) | void {
  // The canvas stands in its own sticky layer behind the hero (Scene.astro), so the room holds
  // still through the hero's lead (motion/interlock.ts holds the words and Home with it).
  const canvas = document.querySelector<HTMLCanvasElement>("[data-light-gl]");
  const layer = canvas?.closest<HTMLElement>("[data-light-layer]");
  if (!canvas || !layer) return;
  const box = hero.querySelector<HTMLElement>("[data-light-mark]")!;
  const scene = document.querySelector<HTMLElement>("[data-scene]");
  const hwin = hero.querySelector<HTMLElement>("[data-hwin]");
  const video = layer.querySelector<HTMLVideoElement>("[data-light-video]");
  const narrow = matchMedia(NARROW);

  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance",
    failIfMajorPerformanceCaveat: true,
  });
  // A software renderer draws the scene on the processor: it gets a softer canvas and no idle
  // frames (only the intro, the pointer and the scroll redraw it).
  const info = gl?.getExtension("WEBGL_debug_renderer_info");
  const renderer = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  const soft = /swiftshader|llvmpipe|software|basic render/i.test(renderer);
  // The mark's box goes where the glass stands on the frame's desk, whatever draws the room: the
  // scene below grows the mark from it.
  const F = createFrame({
    hero,
    layer,
    canvas,
    box,
    hwin,
    scene,
    places: PLACES,
    quality: soft ? 0.5 : 1.5,
  });
  const { L, S, scrolled } = F;
  // The still: the first frame with the glass in it, no clip, no canvas.
  const still = () => {
    layer.classList.remove("is-live");
    layer.classList.add("is-still");
    video?.pause();
    video?.removeAttribute("src");
    F.placeBox();
    addEventListener("resize", F.placeBox);
    return () => {
      removeEventListener("resize", F.placeBox);
      layer.classList.remove("is-still");
      F.kill();
    };
  };
  if (!gl) return still();

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) || "shader");
    return s;
  };
  const names = [
    "uRes",
    "uScale",
    "uMark",
    "uTime",
    "uPhoto",
    "uPlace",
    "uSun",
    "uPower",
    "uDepth",
    "uDesk",
    "uTurn",
    "uFanDir",
    "uStop",
    "uExpo",
    "uPart",
    "uReach",
    "uOut",
    "uPaper",
    "uPoster",
  ];
  let U: Record<string, WebGLUniformLocation | null>;
  const prog = gl.createProgram()!;
  try {
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, MAIN));
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(prog) || "link");
    U = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(prog, n)]));
  } catch (e) {
    console.warn("first light:", e);
    return still();
  }
  gl.useProgram(prog);
  // One triangle over the whole screen.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  // The clip's frame, read as a texture.
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
  gl.uniform1i(U.uPhoto, 0);
  gl.uniform1f(U.uPoster, 0);

  // The unfolding plays on a first visit, on a GPU; a software renderer fades in on the end.
  const { look, intro } = createLook(!soft && playIntro);
  const P = createPointer();
  const { ptr } = P;

  let ready = false;
  // Playing: the clip's frames feed the texture, and the sun is the clip's.
  let playing = false;
  let frameAt = -1;
  const draw = (time: number) => {
    const part = Math.max(look.part, scrolled.eased);
    const out = scrolled.out;
    const now = sunAt(playing && video ? video.currentTime : 0);
    if (playing && video && video.readyState >= 2) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      frameAt = video.currentTime;
    }
    const place = S.place;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uScale, L.scale);
    gl.uniform3f(U.uMark, L.ox, L.oy, L.k);
    gl.uniform1f(U.uTime, time);
    gl.uniform3f(U.uPlace, place.x, place.y, place.w / MARK_BOX.w);
    const sun = fromPhoto(place, now.x, now.y);
    gl.uniform2f(U.uSun, sun[0], sun[1]);
    gl.uniform1f(U.uPower, now.power);
    // The glass's depth: deeper open; its direction turns a hair with the pointer and breathes
    // at rest, and the pointer's height stretches it a little, so its volume reads as you move.
    const depth =
      (DEPTH.folded + (DEPTH.open - DEPTH.folded) * part) * (1 + ptr.y * GLASS_TURN.depth);
    const ta = (ptr.x * GLASS_TURN.pointer + Math.sin(time * 0.09) * GLASS_TURN.idle) * (1 - out);
    const tc = Math.cos(ta);
    const ts = Math.sin(ta);
    gl.uniform2f(
      U.uDepth,
      (DEPTH.dir[0] * tc - DEPTH.dir[1] * ts) * depth,
      (DEPTH.dir[0] * ts + DEPTH.dir[1] * tc) * depth,
    );
    gl.uniform1f(U.uDesk, fromPhoto(place, 0, PHOTO.desk)[1]);
    gl.uniform1f(U.uTurn, P.turnAt(time, out));
    gl.uniform2f(U.uFanDir, S.fanDir[0], S.fanDir[1]);
    gl.uniform1f(U.uStop, S.stop);
    gl.uniform1f(U.uExpo, look.expo);
    gl.uniform1f(U.uPart, part);
    gl.uniform1f(U.uReach, look.reach);
    gl.uniform1f(U.uOut, out);
    gl.uniform1f(U.uPaper, scrolled.paper);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // The frame takes the colors in while the stroke splits them (they draw together as the
    // mark opens, as in the shader).
    const split = 1 - smooth(0.2, 0.85, part);
    F.shine(look.reach * split * (1 - out), P.turnAt(time, out));
  };

  // ── The clock: the GSAP ticker, paused off screen, at half rate once nothing is changing ──
  let visible = true;
  const io = new IntersectionObserver((es) => (visible = es[0].isIntersecting), { threshold: 0 });
  io.observe(hero);
  let frame = 0;
  let drawn = -1;
  let slow = 0;
  const tick = (time: number, dt: number) => {
    // The clip runs only while the room can be seen.
    if (video && playing) {
      const show = visible && scrolled.out < 1 && !document.hidden;
      if (show && video.paused) void video.play().catch(() => {});
      else if (!show && !video.paused) video.pause();
    }
    if (!ready || !visible || document.hidden) return;
    const moving = P.settle();
    F.settle(dt);
    // Once the light is out and the hero has handed the mark over, the frame is black: draw it
    // once and rest.
    const key = scrolled.open * 4 + scrolled.out * 2 + scrolled.paper;
    if (scrolled.out >= 1 && scrolled.paper <= 0 && drawn === key) return;
    const busy =
      intro.isActive() ||
      (playing && !!video && video.currentTime !== frameAt) ||
      moving ||
      scrolled.eased !== scrolled.open ||
      key !== drawn;
    frame++;
    if (!busy && (soft || playing || frame % 2 === 1)) return;
    draw(time);
    drawn = key;
    // Frames that keep running long (a weak GPU at a dense screen): drop the sharpness once.
    if (S.quality > 1 && !soft) {
      slow = dt > 26 ? slow + 1 : Math.max(0, slow - 1);
      if (slow > 24) {
        S.quality = 1;
        F.measure();
      }
    }
  };

  let undo: (() => void) | null = null;
  const lost = (e: Event) => {
    e.preventDefault();
    gsap.ticker.remove(tick);
    undo = still();
  };
  canvas.addEventListener("webglcontextlost", lost);
  const resize = () => F.measure();
  addEventListener("resize", resize);
  gsap.ticker.add(tick);
  F.measure();
  void document.fonts?.ready.then(F.measure);

  // Nothing shows until the room has arrived: the clip's first frame, or (if it can't play, as
  // in Low Power Mode) the first frame as an image. Then it comes out of the dark.
  let gone = false;
  const begin = () => {
    if (gone || ready) return;
    ready = true;
    F.measure();
    draw(gsap.ticker.time);
    layer.classList.add("is-live");
    intro.play();
  };
  const fallback = () => {
    if (gone || playing) return;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (gone || playing) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      begin();
    };
    img.onerror = () => {
      if (!gone && !ready) undo = still();
    };
    img.src = `/hero/${PHOTO.file}.webp`;
  };
  const onPlaying = () => {
    if (gone) return;
    playing = true;
    begin();
  };
  if (video && !soft) {
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.addEventListener("playing", onPlaying, { once: true });
    video.addEventListener("error", fallback, { once: true });
    const vp9 = video.canPlayType('video/webm; codecs="vp9"') !== "";
    video.src = `/hero/${PHOTO.file}${narrow.matches ? "-720" : ""}.${vp9 ? "webm" : "mp4"}`;
    void video.play().catch(fallback);
  } else fallback();

  return () => {
    gone = true;
    intro.kill();
    io.disconnect();
    gsap.ticker.remove(tick);
    P.kill();
    removeEventListener("resize", resize);
    canvas.removeEventListener("webglcontextlost", lost);
    video?.removeEventListener("playing", onPlaying);
    video?.removeEventListener("error", fallback);
    video?.pause();
    video?.removeAttribute("src");
    undo?.();
    layer.classList.remove("is-live", "is-still");
    F.kill();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
}
