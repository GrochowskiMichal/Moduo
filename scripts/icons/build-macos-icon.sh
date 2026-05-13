#!/usr/bin/env bash
#
# Build src-tauri/icons/icon.icns from scripts/icons/source/macos-icon-1024.svg.
#
# Renders the source SVG to PNGs at every size macOS expects in an .iconset
# bundle, then packages them into a single .icns file via iconutil. Run from
# the repo root:
#
#   bash scripts/icons/build-macos-icon.sh
#
# Uses only macOS-built-in tools: qlmanage for SVG → PNG, sips for resize,
# iconutil for the .icns bundle. No additional packages required.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_SVG="$REPO_ROOT/scripts/icons/source/macos-icon-1024.svg"
OUT_ICNS="$REPO_ROOT/src-tauri/icons/icon.icns"
WORK_DIR="$(mktemp -d -t moduo-icon)"
ICONSET_DIR="$WORK_DIR/icon.iconset"

if [[ ! -f "$SRC_SVG" ]]; then
  echo "source not found: $SRC_SVG" >&2
  exit 1
fi

mkdir -p "$ICONSET_DIR"

echo "→ rendering 1024×1024 master from SVG"
qlmanage -t -s 1024 -o "$WORK_DIR" "$SRC_SVG" > /dev/null 2>&1
MASTER="$WORK_DIR/$(basename "$SRC_SVG").png"
if [[ ! -f "$MASTER" ]]; then
  echo "qlmanage failed to produce a thumbnail" >&2
  exit 1
fi

# Apple's iconset name convention: icon_<size>x<size>.png and the @2x
# variants. iconutil packages these into icon.icns.
declare -a SIZES=(16 32 64 128 256 512 1024)

for size in "${SIZES[@]}"; do
  target="$ICONSET_DIR/icon_${size}x${size}.png"
  echo "→ writing ${size}×${size}"
  sips -s format png -z "$size" "$size" "$MASTER" --out "$target" > /dev/null
done

# @2x variants: same pixel size as the next tier up, but named for the
# logical (point) size. e.g. icon_512x512@2x.png is the 1024px raster shown
# at the 512pt slot.
declare -a TWOX_PAIRS=("16:32" "32:64" "128:256" "256:512" "512:1024")
for pair in "${TWOX_PAIRS[@]}"; do
  point="${pair%%:*}"
  pixel="${pair##*:}"
  target="$ICONSET_DIR/icon_${point}x${point}@2x.png"
  echo "→ writing ${point}×${point}@2x (= ${pixel}px)"
  sips -s format png -z "$pixel" "$pixel" "$MASTER" --out "$target" > /dev/null
done

echo "→ packaging icon.icns"
iconutil -c icns "$ICONSET_DIR" -o "$OUT_ICNS"

rm -rf "$WORK_DIR"

echo "✓ wrote $OUT_ICNS"
file "$OUT_ICNS"
