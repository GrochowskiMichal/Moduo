# Moduo brand system: brief and plan

> **Status:** planned 2026-10-08 in a grilling session with Maciej (designer, sole decision-maker on brand). Every rule here traces to a numbered decision in [DECISIONS.md](./DECISIONS.md); the numbers in brackets, like (18), point there. **Open:** none. **In progress:** Maciej is redrawing the mark and wordmark masters (BRAND-0); everything downstream is generated from them, so it can be built now and re-exported later.
>
> **Authority.** This file governs everything outside the app (landing, emails, social, press, store listings, decks) and, inside the app, only the logo, the app icon, how assistants are named, and the voice (3). The app UI stays under [docs/DESIGN_SYSTEM.md](../../docs/DESIGN_SYSTEM.md), [docs/DESIGN_RULES.md](../../docs/DESIGN_RULES.md) and [src/styles/tokens.css](../../src/styles/tokens.css). Values live in `tokens.css`; this file names them and says where they may appear. If this file and the token file disagree on a value, the token file wins and this file gets fixed.

---

## 0. The brand in five lines

1. **The product is the brand.** Moduo's brand is the app's own system at a louder volume: black, white, Geist, the mark. Nothing the app doesn't have: no brand hue, no second typeface, no illustration style (4).
2. **Black is home.** Light is an equal-quality second expression, used where the reader's environment decides (39).
3. **No hues.** Hue accents (pink included) are a personal setting inside the app, never the brand. There is no AI colour (40, 41).
4. **Things arrive, they don't perform.** One exception: the mark revealing itself out of nothing (53, 54).
5. **Plain, calm, direct** (59).

---

## 1. Scope and audience (1–5)

- **Readers:** Maciej, Mike, and coding agents. Written as rules an agent can follow without asking; a rendered brand page for humans comes after the masters exist (1, 2, BRAND-6).
- **Form:** this brief + [DECISIONS.md](./DECISIONS.md). Not Figma-first (2).
- **One brand.** Sub-products are named in plain text, "Moduo Meet", "Moduo booking pages", a future local-first "lite". None gets its own mark or colour (5).

---

## 2. Name (6–10)

| Context | Write | Never |
| --- | --- | --- |
| Sentences, titles, legal, email subjects, store listings | **Moduo** | MODUO, ModuO, Moduo App, Moduo AI |
| Inside the logo only | **moduo** (lowercase, as drawn) | typed lowercase "moduo" as a stand-in for the logo |
| Describing a surface | "the Moduo desktop app", "Moduo on the web" | "the Moduo App" as a name |

- **The name story is not an official brand story** (8). "mod + duo, sharing the d" stays on the landing's footer plate as landing content. It is not repeated in the press kit, About, or the app.
- **Handles:** `moduo_app` everywhere renaming is possible; display name "Moduo" (10). X today is `@Moduo_App` (same handle, X ignores case; change the display casing only).
- **Pronunciation (9):** **"mo + duo", stress on "du"**, said however your language says "duo".
  - English: *mo-DOO-oh*. Polish: "moduo" read naturally (Polish penultimate stress lands on *du*); your "moduou" is the same sound. "modziuou" is the British/Japanese way of saying *duo* (*dyoo*) and is also right.
  - Japanese: **モデュオ** (mo-dyu-o), reusing the loanword デュオ (*duo*). The katakana spelling is a brand asset (business cards, a Japanese store listing) since the founders move to Japan before release.
  - Don't correct people who say *MOJ-oo-oh* (as in "module"). Never use it in our own videos.

---

## 3. The mark (11–17)

### Meaning (12)
Three identical pieces interlock into one shape that reads as an **m**. The empty windows where the pieces overlap are the point: **overlap is connection**. Modules meet, and where they meet, something opens up. Used in the press kit only; never explained in app chrome.

### Construction rules for the master (11, BRAND-0)
The mark is being redrawn by Maciej. The redraw should keep the construction that makes both the mark and the reveal animation (§10) work:

1. **One stroke shape, used three times.** Three identical slanted strokes with vertical sides and diagonal top/bottom edges.
2. **Equal spacing.** The side strokes sit exactly one offset left and right of the middle one, horizontally.
3. **Windows are exact overlaps.** Visible shape = (left ∪ right) XOR middle. Left and right never touch each other.
4. **Centred** in its square.

**What the current file measures (2026-10-08 audit of `src/components/ui/moduo-mark.tsx`, 1000-unit box):**

| Check | Result |
| --- | --- |
| Stroke widths | 331.51 / 331.51 / 331.51: equal ✓ |
| Offsets between strokes | 194.24 / 194.24: equal ✓ |
| Centring | x 140–860, y 227–773, centred on 500/500 ✓ |
| Windows = exact overlaps | yes ✓ (the XOR reconstruction lands on the real mark) |
| Diagonal angle | **44.9°**, not 45° (top and bottom edges both). Probably meant 45. |
| Rounded corners | **The two corners inside each window are smaller** (≈ 12 × 29 units) than the same corner on the outside of the strokes (≈ 20 × 47). So the three strokes are not identical copies. If that's deliberate (smaller radii read better inside a small window), the reveal needs a tiny corner morph near the end; if not, rebuild from one stroke. |

### Small master (13)
At 16px the two windows close up. Maciej draws a **small master** (`mark-small.svg`, opened windows, slightly thinner strokes). It is **only for marks displayed under 24 px** (13): browser-tab favicons (16 CSS px, including the 32 px file made for 2× screens), the 13 px email footer badge, and `<ModuoMark small />` wherever a mark is drawn under 24 px (today: the 14 px "Scheduled with Moduo" badge). Everything 24 px and up keeps the standard mark: the app's 32 px marks, Windows icons at 32/48 px, and touch and home-screen icons. Until the small master exists, the standard mark is used everywhere.

### Colour and containers (14, 15)
- Paper (`#fafafa`) on black, Ink on white, `currentColor` in the app. Never a hue, gradient, outline, shadow or glow.
- **Tile** (rounded square behind the mark) only for the app icon, favicon and avatars. Everywhere else the mark stands free.

### Mark or lockup (17)
- **Mark alone** is the everyday signature: app top-left, app icon, sign-in, onboarding, paywall, avatars, favicon, the booking-page badge.
- **Lockup** is for first contact: landing nav, email header, OG image, decks, press.

### Not reused (16)
The landing footer's wireframe extruded mark ("Depth 14") is a **landing one-off**. Do not reuse it anywhere, including press.

---

## 4. Wordmark (18–19)

- **The wordmark is A, the drawn letters** (18), shown in the session's comparison widget. Today's source is `brand/masters/wordmark.svg`, a provisional copy of the shipped artwork; Maciej is redrawing it. The Geist-typed "moduo" in the landing nav, the email set and `og.png` is a stand-in and gets replaced by the artwork.
- Always **lowercase**, always **outlined artwork**, never retyped in any font.
- **Wordmark alone** only where the mark is already large nearby: the landing footer plate and press layouts (19). Default is the lockup.

---

## 5. Lockups, clear space, sizes, misuse (20–26)

### Lockups (20, 21)
- **Horizontal** (mark left, wordmark right) is the only lockup produced. A **stacked** lockup (mark above wordmark) is defined but not produced until a real use appears.
- **Proportions come from the master lockup file**, not from per-surface CSS. They replace the three ad-hoc versions in use today (landing nav: mark 30px + text 19/600; email set: mark 18–20px + text 15–16/600; landing brief: mark 20px + "Moduo" 14/500). If the redrawn master changes them, the master wins.
- Current master, in units of mark height **H**: gap mark → wordmark ≈ **0.36 H**; wordmark x-height ≈ **0.44 H**; ascender (the d) ≈ **0.62 H**; lockup width ≈ **4.4 H**. The wordmark's x-height sits slightly below the mark's centre, as drawn. Don't re-align it.

### Clear space (22)
- Lockup: **one "o" height** of empty space on every side.
- Mark alone: **a quarter of the mark's height** on every side.

### Minimum sizes (23)
| Asset | Screen | Print |
| --- | --- | --- |
| Lockup | 72px wide (mark ≈ 16px inside it) | 20mm wide |
| Mark | 16px; **small master** at ≤24px | 5mm |

### Backgrounds (24)
Canvas black, Reading black, white, or a neutral. On photography only over a calm dark area. **Never on a hue** (no pink, violet or blue fields).

### Misuse (25)
Never: stretch · rotate · mirror · recolour to a hue · gradient · drop shadow or glow · outline (the landing wireframe is the one-off exception, 16) · retype the wordmark in any font · rearrange or re-space the lockup · put the mark in a circle (tiles are rounded squares and only where §3 allows) · glue a tagline into the lockup · place emoji or AI sparkle beside it.

### Co-branding (26)
Moduo lockup, a 1px hairline divider, the partner logo at equal optical height. No "×". Used for MCP partners, Product Hunt and similar.

---

## 6. App icon, favicon, avatars (27–35)

| Asset | Spec |
| --- | --- |
| **App icon** (27, 29) | White mark on a near-black tile. One icon for everyone; it never follows the user's accent. macOS 26 Liquid Glass bundle (`scripts/icons/source/Moduo.icon`) keeps Apple's automatic fill; light/dark/clear/tinted already look right (28). Re-check them only when the mark master changes. Pre-26 `.icns` and Windows/Linux PNGs come from the same source. |
| **Favicon** (30) | The same black tile (rounded, mark in paper) on the landing and the web app. Kept opaque so it reads in light and dark tab bars. Small master at 16/32px once drawn. |
| **Staging favicon** (31) | Inverted: white tile, black mark, so staging tabs are recognisable. |
| **Default profile picture** (32) | **Initials on a neutral circle**, never the Moduo mark. Today it's an Expo template placeholder (`assets/icon.png`); BRAND-2 replaces it. |
| **Sender avatar** for hello@moduo.app (33) | Paper mark on a Canvas-black square, mark at **~55%** of the width so it survives every client's circle crop. v1 via the Google Workspace profile + Gravatar for that address; BIMI (needs a paid certificate) later, if ever. |
| **Social avatars** (34) | Same file family as the sender avatar, one master square. Personal accounts keep personal photos. |
| **Social banners** (35) | Canvas black, small lockup, the brand line (§11). No product screenshots until the app UI is final. |

---

## 7. Colour (36–41)

The brand palette is the app's neutral system. No brand hue (36).

| Name | Value | Token | Use |
| --- | --- | --- | --- |
| **Canvas black** | `#000000` · `oklch(0 0 0)` | `--background` (dark) | Brand home: landing, OG, social, banners, decks |
| **Reading black** | `oklch(0.2 0 0)` ≈ `#161616` | (marketing pages only) | Long reading on dark: legal pages, manifesto, dark-mode emails (37) |
| **Icon black** | `#0a0a0a` | (icon pipeline) | App icon tile only; the OS adds its own gradient on top |
| **Paper** | `#fafafa` · `oklch(0.985 0 0)` | `--neutral-50` / `--foreground` | Type and the mark on black (38) |
| **White** | `#ffffff` | `--card` (light) | Light pages and emails |
| **Ink** | `oklch(0.16 0 0)` ≈ `#0d0d0d` | (marketing light) | Type and the mark on white |
| **Neutral ramp** | `--neutral-100…975` | `tokens.css` §2 | Secondary text, hairlines, surfaces |

**Rules**
- **Light** is an equal-quality secondary expression: same mark, same type, Ink on White (39).
- **Pink is not a brand colour, not the default accent and not an AI colour** (40). It stays only as one ordinary choice among the eight Settings accents and the eight tag colours, exactly like violet or teal.
- **Hues, status colours and theme shades** never appear as marketing chrome. They show up only *inside product screenshots*, and screenshots always show the default look: black shade, mono accent (41).
- Print/CMYK is defined when print happens.

---

## 8. Assistants: no AI colour (40, 42–46)

**There is no AI dot and no AI colour** (40a). The "pink AI disc" was never a designed feature. It began as a pink circle in Maciej's first-draft screenshot (May 2026). An agent read it as an AI button and made pink the default accent; the button existed in code for about two days, and the idea then survived only by being copied between docs. The full history is in [DECISIONS.md](./DECISIONS.md) #40.

- **When an assistant changes something,** activity and history show the assistant's name in the normal neutral style ("Claude changed the due date"), like any person. No special colour, badge, glow or icon treatment (42–45, superseded).
- **The connected-assistants list in Settings** uses the same neutral list styling as any other integration.
- **Words** (46): "your assistant", or name the tool (Claude, ChatGPT, Cursor). Never "Moduo AI".
- **Marketing:** AI is a trust message ("bring your own AI; Moduo never trains on your data"), never a visual theme.

---

## 9. Typography (47–52)

- **Geist is the only face**, brand included (47). Hierarchy comes from size and weight. No display face; revisit only if a print or editorial need appears.
- **Weights:** 400 / 500 / 600. **300** only for large quiet display lines (≥ 22px) in marketing and email; never in the app. **Never 700** (48).
- **Pilat Extended leaves Settings → Font** (49). It doesn't ship, so most people silently got Inter. The picker and the other faces stay; anyone who had picked Pilat lands on Geist.
- **Geist Mono:** codes, shortcuts, IDs only. Never headlines (50).
- **Tracking** (51): hero −0.035em · section titles −0.02em · small lockup-style or heading text −0.015em · body 0 · eyebrows +0.04em uppercase 11px.
- **Marketing scale:** as in `landing-agents-readme.md` (hero `clamp(36px, 7.2vw, 88px)`/600, section 36/600, body 18/400, manifesto 22/400). Product frames inside marketing use the app's 14px scale.
- **Numbers:** tabular figures for times, dates, prices and codes.
- **Email** (52): Geist where the reader has it installed, system sans elsewhere. The logo is an image, so the brand survives either way. *(Amended 2026-10-08, Maciej: emails don't load Geist from Google Fonts, because that sends every reader's IP address to Google; see docs/decisions/product.md, TX-1.)*

---

## 10. Motion (53–58)

### Principle (53)
**Things arrive, they don't perform.** The app's fade + micro-blur signature, durations from the motion tokens (≤ 320ms), no bounce, sparkle or glow, and reduced motion always honoured. The logo reveal is the one sanctioned exception.

### The reveal: the mark appears out of nothing (54)
The mark's own rule is that overlapping parts cancel. So:

1. **Start:** all three strokes sit in the same place. Under the mark's rule, visible = (left ∪ right) XOR middle = middle XOR middle = **nothing**. The screen is empty.
2. **Reveal:** the two side strokes slide out horizontally, left and right, from under the middle one. Slivers appear on both sides while the overlaps stay empty, so the mark grows out of nothing.
3. **Rest:** the sides stop one offset out (194.24 units in the 1000 box) and the mark is complete. Then stillness.

- **Timing:** ≈ 800ms, ease-out (`--ease-out`, the app's drift-in curve). Tuned in BRAND-3.
- **Reduced motion:** no slide; the finished mark fades in with `--motion-fade`.
- **Prototype:** built in the 2026-10-08 session. The XOR reconstruction matches the real mark everywhere except the window corners (§3 audit), which the redrawn master should settle.
- **Grammar for later:** "overlap cancels, separation reveals" is the brand's motion idea for future animated symbols (loaders and others; none designed yet). **The logo itself never loops.**

### Where it plays (55)
- Once per app launch, while the session loads. It replaces today's static mark + "Loading…" on sign-in.
- The first frame of videos and demos.
- On the landing, once, on a first visit: the nav lockup reveals itself with the hero's entrance (BRAND-4). A first visit means arriving from outside the site; nothing is stored for it.
- Never on route changes, never as a looping spinner.

### The rest (56–58)
- The footer plate's construction-draw animation is landing and press only (56).
- No brand sound; the focus chime stays a product sound (57).
- Demo videos run at real speed with a visible cursor, no zoom-punch transitions, and the reveal at the start only (58).

---

## 11. Voice and tone (59–65)

### Voice (59, 60)
**Plain, calm, direct.** Short declarative sentences, second person, concrete nouns. The manifesto is the reference.
- **"We"** is the two of you; **"you"** is the reader. The UI never says "I".
- Personal notes (welcome, waitlist invite, founder access, build updates) are signed **"Maciej & Mike"** while it's the two of you.
- **Humour** is dry and rare, and never appears in errors, billing or deletion. No exclamation marks. No emoji (63).
- **Competitors:** name the category ("five apps", "a duct-taped stack"), not the company. Named competitors only on honest comparison and import pages (62).

### Lines (61)
| Role | Line | Where |
| --- | --- | --- |
| **Brand line** (permanent) | **One window for the whole working life.** | Bios, press, social banners, store subtitle, footer, boilerplate |
| **Campaign line** (rotatable) | **Fire ten apps. Keep the work.** | Landing hero, OG image, ads |
| Dropped | ~~The last productivity app you'll ever set up.~~ | It's an overclaim; remove it from the landing footer |

### Boilerplate (75)
- **One line:** Moduo is a lightweight workspace that links email, tasks, notes, calendar, contacts and chat in one window.
- **Paragraph:** Moduo is a lightweight workspace for people who run their own work. Email, tasks, notes, calendar, contacts and chat live in one window and link to each other, so an email can become a task tied to the client it came from. There's nothing to set up: no databases, no templates. Bring your own AI assistant; Moduo never trains on your data. Made by Maciej and Mike.
- **No location** in brand copy (the founders are moving to Japan before release). Legal footers keep the registered company address, which is a legal requirement, not brand copy.
- **Module order** wherever modules are listed: email, tasks, notes, calendar, contacts, chat.

### Words (64)
- **Never:** seamless, supercharge, unlock, empower, AI-powered, revolutionary, game-changer, simply, just, easy, please, successfully.
- **Never the Anytype-trap words:** graph, database, object type, relations. Say **linked**.
- **UI copy** follows DESIGN_RULES R8: sentence case, verb-first buttons, errors say what happened and what to do, empty states invite.

### Spelling (65)
**American English** everywhere (color, organize). Fixes the landing's "colour/colours".

### Example cast (71)
One recurring cast of believable small-studio work, used in every screenshot, frame, email sample and video. Never lorem ipsum, never real customer data.

| Person / thing | Role |
| --- | --- |
| Anna Carter | Client; the email that becomes a task |
| Maya Brooks | Designer, owns the logo files |
| Jamie Ross | Teammate (chat, shared calendar) |
| Tom Becker | Guest booking a call (`tom@becker.studio`) |
| Sam Lee, Priya Nair | Extra meeting guests |
| Northwind Studio | The example workspace |
| Print shop | The vendor |

The email set's host "Anna Kowalska" becomes **Anna Carter**.

---

## 12. Imagery and illustration (67–70)

- **The product is the only picture** (67): real UI or HTML-drawn product frames. No stock photography, 3D blobs, abstract waves, mesh gradients or AI-generated imagery. (`assets/image.jpg`, an abstract light-wave stock image, is the exact anti-pattern and gets deleted.)
- **People** (68): only real people with consent, meaning the founders' photos on About and the manifesto (`landing/assets/makers/`).
- **Illustration** (69): none in v1. If ever needed: single-weight line drawings built on the mark's diagonal geometry, in foreground and muted grey only.
- **Diagrams** (70): hairlines and small dots in Paper and grey, like the link lines in `og.png`. No colour coding beyond module icons.
- **Icons:** Phosphor line icons, single colour, same set as the app.

---

## 13. Applications (66, 72–74)

### OG and share images (72)
Today's `landing/assets/og.png` becomes the template: Canvas black, lockup top-left, the line in Geist 600, optional product frame on the right, faint grid. One per page (home, manifesto, privacy, terms, press, booking pages). The typed lockup in it is swapped for the artwork once BRAND-1 exports exist.

### Booking badge (73)
One phrase, **"Scheduled with Moduo"** + the mark. The booking page already says this. The email set's "Booked with Moduo" footer changes to match.

### Email (74): what the email plan must change
The email plan is [specs/transactional-email.md](../../specs/transactional-email.md) (ratified, built as TX-1…; the visual reference is `.design/transactional-email/email-set.html`). It already expects "the brand session may replace the mark; only the PNGs change". These four deltas go into it before or during TX-1:
1. **Logo (spec T6, the "Look" line, AC1, AC5).** The header is **one lockup image** of the master lockup (brand decision 18: the drawn wordmark is never retyped): `public/email/lockup-{light,dark}@2x.png` on an exact 192 × 44 canvas (96 × 22 displayed, artwork left-aligned and vertically centred), Ink on light, Paper on dark where the client supports it. The footer badge uses `mark-{light,dark}@2x.png` on 26 × 26 (13 displayed). Generated by `brand:export` (BRAND-1) on the canvases TX-1's `assets.ts` fixes. **No halo (74a):** the logo follows the reader's light or dark mode. The email shows the Ink file in light mode and the Paper file in dark mode. Phone mail apps that darken emails on their own without saying so (Gmail's app especially) can't be detected and keep the light-mode logo.
2. **Dark canvas:** Reading black `oklch(0.2 0 0)`. This matches the spec's "off-black from the legal pages"; the email-set mock uses 0.19.
3. **Badge copy:** "Booked with Moduo" → **"Scheduled with Moduo"** (brand decision 73), matching the booking page.
4. **Example cast:** host "Anna Kowalska" → "Anna Carter" in mocks and test fixtures.

Already compatible: light-first, mono, Geist with system fallback, weight 300 only at ≥22px, sentence case, "Maciej & Mike" sign-off, no emoji, the off-black dark canvas.

### Press kit (66): build now, don't wait for release
A page at **moduo.app/press** (the landing footer's "Press kit · Soon" link) plus one zip:
- Logo pack: mark, lockup, wordmark. SVG and PNG, Paper and Ink, on transparent.
- App icon (1024 PNG).
- Boilerplate (one line + paragraph), the brand line, pronunciation, katakana モデュオ.
- Founders: names, photos.
- Usage rules on one page: clear space, minimum sizes, misuse.
- Contact: hello@moduo.app.
- **Screenshots: later**, once the app UI is final (no real-UI replicas until then).

---

## 14. Where everything lives (decided)

```
.design/brand/
  BRAND_BRIEF.md        this file: the rules
  DECISIONS.md          numbered decisions from the grilling session
brand/
  README.md             what's here, how to re-export, who may edit
  masters/              hand-drawn sources. Maciej only. Agents never edit.
    mark.svg            the mark (1000×1000, construction per §3)
    mark-small.svg      small master for ≤24px (when drawn)
    wordmark.svg        the drawn wordmark
    lockup.svg          horizontal lockup (spacing is a design act, so it's a master too)
  exports/              generated by `bun run brand:export`, committed
    svg/                mark, lockup, wordmark × paper / ink / currentColor
    png/                same × @1x/@2x/@3x on transparent; 1024 app icon
    avatar/             1024 square: paper mark at 55% on Canvas black
    favicon/            prod (black tile) + staging (inverted) sets
    og/                 OG template base
    email/              email header logos (also copied to public/email/)
```

Built in BRAND-1 (2026-10-08). The details live in [brand/README.md](../../brand/README.md).

**Consumers** (the export script writes these, so nothing is hand-copied):

| Destination | What |
| --- | --- |
| `src/components/ui/moduo-mark-path.ts` | The paths `ModuoMark` renders, generated from `mark.svg` (and `mark-small.svg` for `<ModuoMark small />`, marks drawn ≤ 24 px) |
| `public/` | Favicons and touch icons for **both** the web app and the landing (the landing build copies the web build, so the landing needs no copies of its own) |
| `public/email/` | Email lockup (192 × 44 canvas) and footer-badge mark (26 × 26) PNGs, light and dark @2x: the exact canvases the email kit's `assets.ts` (TX-1) expects |
| `landing/assets/brand/` | Press kit files (BRAND-5) |
| `scripts/icons/source/` | App-icon layer (`Moduo.icon/Assets/moduo-mark.svg`) and `macos-icon-1024.svg`; then `bun scripts/icons/build-macos-icon.ts` + `bun run icon:liquid` |

A test in `bun run verify` (`scripts/brand/brand.test.ts`) fails if these consumers drift from the masters. Everything displayed under 24 px (browser-tab favicons, the email footer badge, `<ModuoMark small />`) switches to `mark-small.svg` automatically once that master exists.

**Deleted** (76). In BRAND-1: `assets/moduo_logo_white.svg`, `moduo_sign_white.svg`, `logo_d-w.png`, `moduo_favicon.png`, the Expo leftovers `adaptive-icon.png`, `splash-icon.png`, `favicon.png`, and `image.jpg` (§12). `assets/icon.png` goes in BRAND-2, together with the initials avatar that replaces its last use (the default profile picture). Git history keeps them.

---

## 15. Ownership (77, 79)

- **Maciej decides every brand question** (79): mark, wordmark, colour, type, motion, voice, name. Nothing needs Mike's sign-off; he's informed.
- **Agents never edit `brand/masters/`.** They regenerate exports and wire consumers. A request to "tweak the logo" from anyone but Maciej is a question back, not an edit.
- Changing a rule: edit this file and add a dated line to [DECISIONS.md](./DECISIONS.md), then change the surfaces.

---

## 16. Build plan

Plan only. Each block is built later with `/s2` (78). Landing work ships as PRs into `prod-landing`, not through `maciej`.

| Block | What | Depends on | Who |
| --- | --- | --- | --- |
| **BRAND-0** | Redraw the masters: mark (§3 construction, 45°, decide the window-corner radius), wordmark A, lockup spacing, small master. | n/a | **Maciej** |
| **BRAND-1** | Asset pipeline: `brand/` tree, copy today's files in as provisional masters, `bun run brand:export`, every export in §14, consumers wired, old files deleted. **Unblocks the email build's logo.** Re-run after BRAND-0. | n/a (re-run after BRAND-0) | agent |
| **BRAND-2** | App touch-points: initials as default avatar; Pilat out of the font picker (Pilat users → Geist); unused Equity Sans + Nunito fonts no longer loaded at boot (their CSS classes are dead); staging favicon. | BRAND-1 | agent |
| **BRAND-3** | The reveal: one component, played once per launch while the session loads, reduced-motion fade; video-intro export (MP4/GIF). | BRAND-1 (better after BRAND-0) | agent |
| **BRAND-4** | Landing alignment (PR into `prod-landing`): lockup artwork in nav/footer/OG; footer line → brand line; American spelling; drop the unused `--ai` pink variable (the accent demo keeps pink as one of eight options); reveal on first visit; `landing-agents-readme.md` updated to this brief. | BRAND-1 | agent |
| **BRAND-5** | Press kit page + zip (§13); social avatars and banners exported. | BRAND-1 | agent |
| **BRAND-6** | Rendered brand page (the visual brandbook for humans) generated from this brief. | BRAND-0 | agent |

**Re-export rule:** when a master changes, re-run `brand:export`, rebuild the icon (`icon:liquid`), check the four Liquid Glass modes, and re-check the landing footer plate. It is hand-drawn on the wordmark's geometry, so a changed wordmark means a changed plate.
