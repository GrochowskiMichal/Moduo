// Small helpers shared by the lab scripts: arguments, files, numbers.
import fs from "node:fs";
import path from "node:path";

export function parseArgs(argv, valued) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const [key, inline] = a.slice(2).split("=", 2);
    if (inline !== undefined) out[key] = inline;
    else if (valued.includes(key)) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

export const list = (v) =>
  v === undefined || v === true
    ? null
    : String(v)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

export function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function writeJson(file, data) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function writeText(file, text) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
}

export const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

export const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "x";

export const pad = (n, w = 2) => String(n).padStart(w, "0");

export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

export const round = (n, d = 1) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

export const median = (v) => percentile(v, 50);

export function runId(label) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${stamp}-${slug(label || "run")}`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function log(...a) {
  process.stderr.write(`${a.join(" ")}\n`);
}

/** Seeded PRNG (mulberry32) so ablations and samples repeat run to run. */
export function rng(seed = 7) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const rel = (root, p) => path.relative(root, p).split(path.sep).join("/");
