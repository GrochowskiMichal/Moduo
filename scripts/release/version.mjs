/**
 * The desktop release version (_desktop-release.yml), from the committed VERSION
 * file. The web deploys read VERSION directly (app-staging.yml, app-preview.yml
 * add `-rc`; deploy-prod.yml ships it as is), so the channels line up:
 *
 *   production web (deploy-prod.yml)         → 1.1.0
 *   staging and preview web                  → 1.1.0-rc
 *   production desktop                       → 1.1.0
 *   staging desktop                          → 1.1.0-rc.<run number>
 *
 * The desktop updater only offers a version higher than the installed one
 * (semver, so 1.1.0-rc.5 > 1.0.41 and 1.1.0 > 1.1.0-rc.5). A production
 * release therefore needs a VERSION bump; `assert-newer` fails the release
 * before any build minutes are spent when it doesn't have one.
 *
 * CLI (used by the workflow):
 *   node scripts/release/version.mjs desktop <staging|production> <run-number>
 *   node scripts/release/version.mjs assert-newer <candidate> <published|"">
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** The base version from VERSION (`1.1.0`); throws on anything else. */
export function readBaseVersion(file = path.join(root, "VERSION")) {
  const base = fs.readFileSync(file, "utf8").trim();
  if (!/^\d+\.\d+\.\d+$/.test(base)) {
    throw new Error(`VERSION must be MAJOR.MINOR.PATCH, got "${base}"`);
  }
  return base;
}

/** The desktop version for a release channel. */
export function desktopVersion(base, channel, runNumber) {
  if (channel === "production") return base;
  if (channel !== "staging") throw new Error(`Unknown channel "${channel}"`);
  if (!/^\d+$/.test(String(runNumber ?? ""))) {
    throw new Error(`Staging needs a numeric run number, got "${runNumber}"`);
  }
  return `${base}-rc.${runNumber}`;
}

/** Semver order: negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a, b) {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  if (!pa || !pb) throw new Error(`Not a semver version: "${pa ? b : a}"`);
  for (let i = 1; i <= 3; i += 1) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d;
  }
  // A pre-release sorts before its release (1.1.0-rc.9 < 1.1.0).
  if (!pa[4] || !pb[4]) return (pa[4] ? -1 : 0) - (pb[4] ? -1 : 0);
  const xa = pa[4].split(".");
  const xb = pb[4].split(".");
  for (let i = 0; i < Math.max(xa.length, xb.length); i += 1) {
    if (xa[i] === undefined) return -1;
    if (xb[i] === undefined) return 1;
    const na = /^\d+$/.test(xa[i]);
    const nb = /^\d+$/.test(xb[i]);
    if (na && nb) {
      const d = Number(xa[i]) - Number(xb[i]);
      if (d !== 0) return d;
    } else if (na !== nb) {
      return na ? -1 : 1;
    } else if (xa[i] !== xb[i]) {
      return xa[i] < xb[i] ? -1 : 1;
    }
  }
  return 0;
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === "desktop") {
    const [channel, runNumber] = args;
    console.log(desktopVersion(readBaseVersion(), channel, runNumber));
    return 0;
  }
  if (command === "assert-newer") {
    const [candidate, published] = args;
    if (!published) {
      console.log(`No published version; ${candidate} is the first.`);
      return 0;
    }
    if (compareVersions(candidate, published) > 0) {
      console.log(`${candidate} > ${published}: installed apps will update.`);
      return 0;
    }
    console.error(
      `::error::${candidate} is not newer than the published ${published}, so installed apps would never update. Bump VERSION and run again.`,
    );
    return 1;
  }
  console.error(
    "usage: version.mjs desktop <channel> <run> | assert-newer <candidate> <published>",
  );
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
