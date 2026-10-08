# App icons

Two macOS icon pipelines, both driven from vector sources in `source/`.

## macOS 26 Tahoe — Liquid Glass (primary)

- **Source:** `source/Moduo.icon/` — an Icon Composer bundle (`icon.json` manifest
  + `Assets/` SVG layers). The mark layer is generated from the brand master
  (see below); edit the manifest's `fill` / `groups` to change the glass look.
- **Build:** `bun run icon:liquid` (→ `scripts/icons/build-liquid-icon.ts`) runs
  Apple's `actool` to compile it into `src-tauri/icons/Assets.car`.
- **Wiring:** `bundle.resources` in `src-tauri/tauri.conf.json` ships `Assets.car`
  into `Contents/Resources/`; `src-tauri/Info.plist` sets `CFBundleIconName=Moduo`.
  macOS 26 then renders the layered glass icon (light / dark / clear / tinted,
  system squircle + specular).
- **Requires full Xcode** (`actool` is not in the Command Line Tools). The
  compiled `Assets.car` is committed, so builds on machines without Xcode (or on
  Linux/Windows) still succeed using the existing artifact.

## macOS 25 and earlier — legacy `.icns` (fallback)

- **Source:** `source/macos-icon-1024.svg` (bakes its own squircle — correct for
  pre-26 systems, which do not mask).
- **Build:** `bun scripts/icons/build-macos-icon.ts` → `src-tauri/icons/icon.icns`
  + the cross-platform PNG fallbacks.
- Tauri sets `CFBundleIconFile` to this automatically; macOS 26 prefers the
  `CFBundleIconName` glass icon when both are present.

## The mark in these sources is generated

`source/macos-icon-1024.svg` and `source/Moduo.icon/Assets/moduo-mark.svg` are
written by `bun run brand:export` from `brand/masters/mark.svg` (see
`brand/README.md`); don't edit them by hand. The mark's 1000-unit box sits at
`translate(12 12)` in the 1024 canvas, so it spans ~70% of the width, as in the
shipped icon. Placement lives in `scripts/brand/compose.ts`. After a re-export,
run `bun scripts/icons/build-macos-icon.ts` and `bun run icon:liquid`.
