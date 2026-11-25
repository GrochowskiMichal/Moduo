// Renders the home hero's stills with the scene's own shader (lib/first-light.ts), in Chromium on
// the GPU: the clip's first frame (public/hero/osaka-office.webp, from scripts/first-light-video.ts)
// with the glass stroke standing on its desk and the spectrum out over it, at rest, once per
// placement (PLACES), into
// public/hero/first-light-{wide,narrow}.webp. The page shows them under reduced motion, without
// WebGL, and while the live scene loads.
// Run from this folder after changing the scene or the photograph:  bun scripts/first-light-poster.ts
// Needs cwebp (brew install webp). For a new clip, run scripts/first-light-video.ts and update PHOTO
// (its size, the sun, the desk's back edge) first.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import {
  DEPTH,
  FAN,
  fromPhoto,
  MAIN,
  MARK_BOX,
  PHOTO,
  PLACES,
  sunAt,
  VERT,
} from "../src/lib/first-light";

const out = path.resolve("public/hero");
const photo = `data:image/webp;base64,${fs.readFileSync(path.join(out, `${PHOTO.file}.webp`)).toString("base64")}`;

const page = (name: keyof typeof PLACES) => {
  const place = PLACES[name];
  // The canvas is the photo: CSS px = photo px.
  const k = place.w / MARK_BOX.w;
  const ox = place.x - MARK_BOX.x * k;
  const oy = place.y - MARK_BOX.y * k;
  const now = sunAt(0);
  const sun = fromPhoto(place, now.x, now.y);
  const desk = fromPhoto(place, 0, PHOTO.desk)[1];
  const stop = fromPhoto(place, 0, place.stop)[1];
  return `<!doctype html>
<canvas id="c" width="${PHOTO.w}" height="${PHOTO.h}"></canvas>
<script type="module">
const c = document.getElementById("c");
const gl = c.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: true });
const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o);
  if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, ${JSON.stringify(VERT)}));
gl.attachShader(p, sh(gl.FRAGMENT_SHADER, ${JSON.stringify(MAIN)})); gl.bindAttribLocation(p, 0, "aPos"); gl.linkProgram(p);
gl.useProgram(p);
const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
const img = new Image(); img.src = ${JSON.stringify(photo)}; await img.decode();
const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
const u = (n) => gl.getUniformLocation(p, n);
gl.uniform2f(u("uRes"), ${PHOTO.w}, ${PHOTO.h}); gl.uniform1f(u("uScale"), 1);
gl.uniform3f(u("uMark"), ${ox}, ${oy}, ${k}); gl.uniform1f(u("uTime"), 12);
gl.uniform1i(u("uPhoto"), 0); gl.uniform3f(u("uPlace"), ${place.x}, ${place.y}, ${k});
gl.uniform2f(u("uSun"), ${sun[0]}, ${sun[1]}); gl.uniform1f(u("uDesk"), ${desk});
gl.uniform1f(u("uPower"), ${now.power}); gl.uniform2f(u("uDepth"), ${DEPTH.dir[0] * DEPTH.folded}, ${DEPTH.dir[1] * DEPTH.folded});
gl.uniform1f(u("uTurn"), 0); gl.uniform2f(u("uFanDir"), ${FAN.dir[0]}, ${FAN.dir[1]}); gl.uniform1f(u("uStop"), ${stop}); gl.uniform1f(u("uExpo"), 1); gl.uniform1f(u("uPart"), 0);
gl.uniform1f(u("uReach"), 1); gl.uniform1f(u("uOut"), 0); gl.uniform1f(u("uPaper"), 0);
gl.uniform1f(u("uPoster"), 1);
gl.viewport(0, 0, ${PHOTO.w}, ${PHOTO.h}); gl.drawArrays(gl.TRIANGLES, 0, 3);
window.png = c.toDataURL("image/png");
</script>`;
};

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
for (const name of Object.keys(PLACES) as (keyof typeof PLACES)[]) {
  const tab = await browser.newPage();
  tab.on("pageerror", (e) => console.error(e.message));
  await tab.setContent(page(name));
  const url = await tab
    .waitForFunction(() => (window as unknown as { png?: string }).png, null, { timeout: 60000 })
    .then((v) => v.jsonValue());
  const png = path.join(out, `first-light-${name}.png`);
  fs.writeFileSync(png, Buffer.from(String(url).split(",")[1], "base64"));
  const webp = path.join(out, `first-light-${name}.webp`);
  execFileSync("cwebp", ["-quiet", "-q", "80", "-m", "6", "-sharp_yuv", png, "-o", webp]);
  fs.rmSync(png);
  console.log(`first-light-${name}.webp ${(fs.statSync(webp).size / 1024).toFixed(0)} KB`);
  await tab.close();
}
await browser.close();
