/**
 * Runs `bun lint` from the canary build pinned in `.bun-lint-version`.
 *
 * `bun lint` ships only in canary builds, and setup-bun can pin a release but
 * not one canary build, so the repo stays on stable Bun (`.bun-version`) and
 * this script fetches the pinned canary from npm, where a published version
 * never changes. The tarball is checked against npm's sha512 and cached under
 * ~/.cache/moduo/bun-lint, so only the first run downloads (~25 MB).
 *
 * Usage: bun scripts/bun-lint.ts [bun lint flags…]   (bun run lint:js runs it)
 * Drop it for plain `bun lint` once a stable Bun ships the linter.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const version = fs.readFileSync(path.join(root, ".bun-lint-version"), "utf8").trim();

const PLATFORMS: Record<string, string> = {
  "darwin-arm64": "darwin-aarch64",
  "darwin-x64": "darwin-x64",
  "linux-x64": "linux-x64",
  "linux-arm64": "linux-aarch64",
};
const platform = PLATFORMS[`${process.platform}-${process.arch}`];
if (!platform) {
  console.error(`bun-lint: no Bun canary build for ${process.platform}-${process.arch}`);
  process.exit(1);
}

const cache = path.join(
  process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
  "moduo",
  "bun-lint",
  `${version}-${platform}`,
);
const bin = path.join(cache, "bun");

if (!fs.existsSync(bin)) await download();

const lint = Bun.spawn([bin, "lint", ...process.argv.slice(2)], {
  cwd: root,
  stdio: ["inherit", "inherit", "inherit"],
});
process.exit(await lint.exited);

async function download() {
  const name = `@oven/bun-${platform}`;
  const meta = await fetch(
    `https://registry.npmjs.org/${name.replace("/", "%2f")}/${version}`,
  ).then((r) => {
    if (!r.ok) throw new Error(`bun-lint: ${name}@${version} is not on npm (${r.status})`);
    return r.json() as Promise<{ dist: { tarball: string; integrity: string } }>;
  });
  const tgz = Buffer.from(await (await fetch(meta.dist.tarball)).arrayBuffer());
  const integrity = `sha512-${createHash("sha512").update(tgz).digest("base64")}`;
  if (integrity !== meta.dist.integrity) {
    throw new Error(`bun-lint: ${name}@${version} does not match npm's checksum`);
  }

  // Unpack next to the cache and rename into place, so two runs at once never
  // see half a binary.
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  const tmp = fs.mkdtempSync(`${cache}.tmp-`);
  const archive = path.join(tmp, "bun.tgz");
  fs.writeFileSync(archive, tgz);
  const tar = Bun.spawnSync(["tar", "-xzf", archive, "-C", tmp, "package/bin/bun"]);
  if (tar.exitCode !== 0) throw new Error(`bun-lint: could not unpack ${archive}`);
  fs.chmodSync(path.join(tmp, "package/bin/bun"), 0o755);
  fs.mkdirSync(cache, { recursive: true });
  fs.renameSync(path.join(tmp, "package/bin/bun"), bin);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.error(`bun-lint: fetched Bun ${version} (${platform}) into ${cache}`);
}
