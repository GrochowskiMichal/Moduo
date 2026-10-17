#!/usr/bin/env bash
set -euo pipefail

# Run from the repo root (bun run build:desktop:signed:*); the Tauri CLI runs from apps/desktop.
cd "$(git rev-parse --show-toplevel)"

if [[ -f ".env.local" ]]; then
  set -a
  source ".env.local"
  set +a
fi

MODE="${1:-debug}"
IDENTITY="${APPLE_SIGNING_IDENTITY:-}"

if [[ -z "${IDENTITY}" ]]; then
  IDENTITY_LIST="$(security find-identity -v -p codesigning)"
  IDENTITY="$(sed -n 's/.*\"\(Apple Development:.*\)\".*/\1/p' <<< "${IDENTITY_LIST}" | head -n 1)"
fi

if [[ -z "${IDENTITY}" ]]; then
  echo "No Apple Development signing identity found in keychain."
  echo "Install an Apple Development certificate in Keychain Access and try again."
  exit 1
fi

echo "Using Apple signing identity: ${IDENTITY}"

export APPLE_SIGNING_IDENTITY="${IDENTITY}"
cd apps/desktop
if [[ "${MODE}" == "release" ]]; then
  node ../../node_modules/@tauri-apps/cli/tauri.js build --bundles app
else
  node ../../node_modules/@tauri-apps/cli/tauri.js build --debug --bundles app
fi
