# Manual test checklist — BRAND-1 brand asset pipeline

> Generated 2026-10-08 · branch `t/maciej/brand-1-asset-pipeline` · **Live-verified:** partial. On a local web build: the sign-in mark renders from the generated path, and `/favicon.svg`, `/favicon.ico`, `/favicon-32x32.png`, `/apple-touch-icon.png`, `/icon-192.png` and all four `/email/*@2x.png` are served (200). The regenerated `favicon.svg` and both macOS icon sources render pixel-identical to the old ones.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Logo in the app (nothing should look different)
- [ ] **Do:** open the app signed out → **Expect:** the sign-in card shows the same mark as before, crisp, in the foreground colour _(web / desktop)_
- [ ] **Do:** sign in → **Expect:** the top-left mark next to the workspace name looks unchanged _(both)_
- [ ] **Do:** switch Settings → Appearance → Theme to Light and back → **Expect:** the mark follows the text colour (dark on light, light on dark) _(both)_
- [ ] **Do:** open a public booking page (`/book/...`) → **Expect:** the footer reads "Scheduled with Moduo" with a small mark that looks as before _(web)_

## Favicons
- [ ] **Do:** open the web app and the landing in a browser tab → **Expect:** the tab icon is the black rounded tile with the white mark, unchanged _(web)_
- [ ] **Do:** add the web app to an iPhone home screen (or check `/apple-touch-icon.png`) → **Expect:** black square, white mark _(web)_

## The pipeline
- [ ] **Do:** run `bun run brand:export` → **Expect:** it lists the files it wrote; `git status` shows no changes (deterministic) _(dev)_
- [ ] **Do:** open `brand/exports/` → **Expect:** svg / png / favicon (prod + staging) / avatar / og / email folders, as described in `brand/README.md` _(dev)_
- [ ] **Do:** open `public/email/lockup-light@2x.png` and `lockup-dark@2x.png` → **Expect:** 192 × 44, transparent, dark and light lockup respectively; `mark-*@2x.png` are 26 × 26 _(dev)_

## Edge cases
- [ ] **Do:** export a master from Figma with "Clip content" off and drop it into `brand/masters/` (on a scratch branch) → **Expect:** `brand:export` accepts it; with a stroke, live text or a clip path it refuses and says why _(dev)_
- [ ] **Do:** edit a master without re-exporting, run `bun run verify` → **Expect:** the brand drift test fails and tells you to run `bun run brand:export` _(dev)_

## Known gaps / not-yet-testable
- The small master (`mark-small.svg`) doesn't exist yet (BRAND-0). The switch for marks displayed under 24 px is unit-tested with a fixture and was spot-checked with a stand-in drawing, but not with the real artwork.
- The native desktop icons (`src-tauri/icons/`) weren't rebuilt, because the mark didn't change. After BRAND-0, run `bun scripts/icons/build-macos-icon.ts` and `bun run icon:liquid` (needs full Xcode).
- Email logos in real mail clients are TX-1's to verify (light/dark swap; Gmail's app keeps the light-mode logo by design, decision 74a).
