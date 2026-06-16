# App icons

Two macOS icon pipelines, both driven from vector sources in `source/`.

## macOS 26 Tahoe — Liquid Glass (primary)

- **Source:** `source/Moduo.icon/` — an Icon Composer bundle (`icon.json` manifest
  + `Assets/` SVG layers). Hand-authorable; no GUI required. Edit the layers or
  the manifest's `fill` / `groups` to change the look.
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

## Changing the logo scale

The mark sits at ~70% of canvas width, centred (matches the legacy icon). To
resize, edit the `translate(...)` / `viewBox` in
`source/Moduo.icon/Assets/moduo-mark.svg`, then re-run `bun run icon:liquid`.
