# brand/

Moduo's logo files. The rules for using them are in [.design/brand/BRAND_BRIEF.md](../.design/brand/BRAND_BRIEF.md); the decisions behind them are in [.design/brand/DECISIONS.md](../.design/brand/DECISIONS.md).

## masters/ (hand-drawn, Maciej only)

| File | What | Box |
| --- | --- | --- |
| `mark.svg` | The mark | 1000 × 1000, artwork centred. This box *is* the icon and favicon geometry, so keep it square. |
| `mark-small.svg` | Small-size mark for ≤ 24 px (opened windows). **Not drawn yet**; until it exists, small sizes use `mark.svg`. | Same 1000 box |
| `wordmark.svg` | The drawn lowercase "moduo" | Tight to the letters |
| `lockup.svg` | Mark + wordmark, horizontal. Spacing is a design decision, so this is a master too. | Tight to the artwork |

**Agents never edit these.** Today's files are *provisional*: the shipped artwork copied in as-is (BRAND-1). Maciej is redrawing them (BRAND-0).

**What a master must be** (`bun run brand:export` refuses anything else and says why): an `<svg>` with a `viewBox` and one or more filled `<path>`s. No transforms, groups with clip paths, masks, strokes, live text, gradients, images or CSS. The fill colour doesn't matter; every export recolours it. When exporting from a design tool:
- Flatten the artwork and outline any strokes and text.
- Turn off "Clip content" on the frame.
- Export the mark, wordmark and lockup together whenever any one of them changes, so the mark inside the lockup stays the same drawing.

## exports/ (generated, committed)

Run `bun run brand:export` after any master changes. It is deterministic: running it twice changes nothing.

| Folder | Contents |
| --- | --- |
| `svg/` | `mark`, `lockup`, `wordmark` × `paper` (on black), `ink` (on white), `current` (`currentColor`, for code) |
| `png/` | The same in paper and ink at @1x/@2x/@3x on transparent (mark 128 px, lockup 320 px, wordmark 240 px wide at @1x), plus `app-icon-1024.png` |
| `favicon/prod/` | Black tile, paper mark: `favicon.svg`, `favicon.ico` (16/32/48), `favicon-32x32.png`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` (full square; iOS rounds it) |
| `favicon/staging/` | The same, inverted (white tile, black mark) |
| `avatar/` | Social and email-sender avatar: paper mark at 55% of the width on Canvas black, `avatar.svg` + `avatar-1024.png` |
| `og/` | Share-image base, 1200 × 630, lockup top-left |
| `email/` | Email header logos (see below) |

## Where the exports ship (written by the same command)

| Destination | What |
| --- | --- |
| `public/` | Favicons and touch icons. `public/` serves both the web app and the landing (the landing build copies the web build). |
| `public/email/` | `lockup-{light,dark}@2x.png` (192 px wide) and `mark-{light,dark}@2x.png` (72 px), served at `app.moduo.app/email/…`. "light" = Ink artwork for light emails; "dark" = Paper for dark mode. |
| `src/components/ui/moduo-mark-path.ts` | The path `ModuoMark` renders |
| `scripts/icons/source/` | macOS icon sources. After a mark change, also run `bun scripts/icons/build-macos-icon.ts` and `bun run icon:liquid` (needs full Xcode). |

`scripts/brand/brand.test.ts` (part of `bun run verify`) fails if those consumers no longer match the masters. Colours come from `scripts/brand/palette.ts`, which mirrors `src/styles/tokens.css` and is tested against it.
